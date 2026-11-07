#!/usr/bin/env node
/** CDP 验证 v2.5.0：本周战报（本周 vs 上周 + 7天格子） */
'use strict';
const net = require('node:net'); const http = require('node:http'); const crypto = require('node:crypto');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b))); }).on('error', rej); });
function connect(wsUrl) {
  const u = new URL(wsUrl); const sock = net.connect(Number(u.port), u.hostname);
  const handlers = new Map(); let id = 0, buf = Buffer.alloc(0), open = false;
  const ready = new Promise((resolve) => {
    sock.on('connect', () => sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); if (!open) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; buf = buf.subarray(i + 4); open = true; resolve(); } for (;;) { if (buf.length < 2) return; const l0 = buf[1] & 0x7f; let off = 2, len = l0; if (l0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (l0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; } if (buf.length < off + len) return; const s = buf.subarray(off, off + len).toString('utf8'); buf = buf.subarray(off + len); let m; try { m = JSON.parse(s); } catch { continue; } if (m.id && handlers.has(m.id)) { handlers.get(m.id)(m); handlers.delete(m.id); } } });
  });
  const frame = (text) => { const d = Buffer.from(text, 'utf8'); const mask = crypto.randomBytes(4); let h; if (d.length < 126) h = Buffer.from([0x81, 0x80 | d.length]); else if (d.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xfe; h.writeUInt16BE(d.length, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0xff; h.writeBigUInt64BE(BigInt(d.length), 2); } const m2 = Buffer.from(d); for (let i = 0; i < m2.length; i++) m2[i] ^= mask[i % 4]; return Buffer.concat([h, mask, m2]); };
  const send = (method, params = {}) => ready.then(() => new Promise((resolve, reject) => { const mid = ++id; handlers.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result))); sock.write(frame(JSON.stringify({ id: mid, method, params }))); }));
  return { send, close: () => sock.destroy() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const list = await getJSON('/json'); const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl); await cdp.send('Runtime.enable'); await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r.result.value; };

  // ①种子：本周一~三（<=今天）各塞 签到+复盘(one/partial/miss)+收入(100/50/200)；上周一二各签到+收入(300/100)
  await ev(`(function(){
    function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
    var now=new Date();
    var dow=(now.getDay()+6)%7; // 0=Mon
    var mon=new Date(now.getTime()-dow*86400000);
    var checkin={}, reviews={}, records=[];
    var amounts=[100,50,200], rvs=['done','partial','miss'];
    var seedDays=Math.min(3,dow+1);
    var thisWeekIncome=0;
    for(var i=0;i<seedDays;i++){
      var d=new Date(mon.getTime()+i*86400000);
      var ds=fmt(d);
      checkin[ds]=1;
      reviews[ds]=rvs[i];
      records.push({date:ds,type:'in',amount:amounts[i],routeId:'d002',note:''});
      thisWeekIncome+=amounts[i];
    }
    var lmon=new Date(mon.getTime()-7*86400000);
    var ld1=fmt(lmon), ld2=fmt(new Date(lmon.getTime()+86400000));
    checkin[ld1]=1; checkin[ld2]=1;
    records.push({date:ld1,type:'in',amount:300,routeId:'s002',note:''});
    records.push({date:ld2,type:'in',amount:100,routeId:'s002',note:''});
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:checkin, lastCheckin:fmt(new Date(mon.getTime()+(seedDays-1)*86400000)), streak:seedDays, coins:0, liked:{}, checks:{}, records:records, reviews:reviews, badges:{}, activeBadge:'', streakRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] }));
    localStorage.setItem('luzi_seed_week_income', String(thisWeekIncome));
    return { seedDays:seedDays, income:thisWeekIncome };
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(900);

  // ① 断言：战报卡、本周收入=种子期望、对比方向、7天格子、圆点、today/future
  const seed = await ev(`JSON.parse(localStorage.getItem('luzi_seed_week_income'))`);
  const dow = await ev(`(new Date().getDay()+6)%7`);
  const seedDays = Math.min(3, dow + 1);
  const prevIncome = 400;
  const expDelta = Math.round((seed - prevIncome) / prevIncome * 100);
  const r1 = await ev(`(() => {
    const wr = document.querySelector('.week-report');
    if (!wr) return { exists:false };
    const income = (wr.querySelector('.wr-cell.main .wr-n')||{}).textContent || '';
    const delta = (wr.querySelector('.wr-delta')||{}).textContent || '';
    const days = wr.querySelectorAll('.wr-day').length;
    const future = wr.querySelectorAll('.wr-day.future').length;
    const today = wr.querySelectorAll('.wr-day.today').length;
    const mids = Array.from(wr.querySelectorAll('.wd-mid')).map(e => e.className.replace('wd-mid','').trim());
    const head = (wr.querySelector('.wr-head')||{}).textContent || '';
    const checkCells = Array.from(wr.querySelectorAll('.wr-day')).filter(e => e.classList.contains('ck')).length;
    return { exists:true, income, delta, days, future, today, mids, head, checkCells };
  })()`);
  console.log('①本周战报:', JSON.stringify(r1), `seed=${seed} seedDays=${seedDays} expDelta=${expDelta}`);
  const ok1 = r1.exists
    && r1.income === '¥' + seed
    && r1.delta.trim() === '↘ ' + Math.abs(expDelta) + '%'
    && r1.days === 7
    && r1.future === (7 - seedDays)
    && r1.today === 1
    && r1.head.includes('本周战报')
    && r1.checkCells === seedDays; // 本周格子内已签天数（上周不在本周格子）
  // 圆点：周一 done、周二 partial、周三 miss（当天已到才断言；今天=周一时只验 done）
  let midOk = true;
  if (seedDays >= 1 && r1.mids[0] !== 'done') midOk = false;
  if (seedDays >= 2 && r1.mids[1] !== 'partial') midOk = false;
  if (seedDays >= 3 && r1.mids[2] !== 'miss') midOk = false;
  console.log('①b 圆点正确:', midOk, JSON.stringify(r1.mids));

  // ②空态：无 records/reviews/checkin → 我的页无战报卡
  await ev(`(function(){
    var now=new Date();
    function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, lastCheckin:'', streak:0, coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] }));
    return 'ok';
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2000);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const r2 = await ev(`(() => { const wr = document.querySelector('.week-report'); const earn = document.querySelector('.earn-board'); return { weekExists: !!wr, earnEmpty: (earn&&earn.textContent||'').includes('从「今日路子」开始') }; })()`);
  console.log('②空态无战报卡:', JSON.stringify(r2));

  const pass = ok1 && midOk && r2.weekExists === false && r2.earnEmpty === true;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
