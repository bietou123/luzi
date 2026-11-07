#!/usr/bin/env node
/** CDP 验证 v2.6.0：全年坚持热力图（GitHub 风格） */
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

  // ①种子：今天=签到+执行done+收100；昨天=签到+partial+收50；前天=miss；上周=done(无签到)；30天前=仅签到
  await ev(`(function(){
    function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
    var now=new Date();
    var d0=new Date(), d1=new Date(now.getTime()-86400000), d2=new Date(now.getTime()-2*86400000), dLast=new Date(now.getTime()-7*86400000), d30=new Date(now.getTime()-30*86400000);
    var checkin={}, reviews={}, records=[];
    checkin[fmt(d0)]=1; reviews[fmt(d0)]='done'; records.push({date:fmt(d0),type:'in',amount:100,routeId:'d002',note:''});
    checkin[fmt(d1)]=1; reviews[fmt(d1)]='partial'; records.push({date:fmt(d1),type:'in',amount:50,routeId:'d002',note:''});
    reviews[fmt(d2)]='miss';
    reviews[fmt(dLast)]='done';
    checkin[fmt(d30)]=1;
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:checkin, lastCheckin:fmt(d0), streak:3, coins:0, liked:{}, checks:{}, records:records, reviews:reviews, badges:{}, activeBadge:'', streakRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] }));
    return 'ok';
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(900);

  const r1 = await ev(`(() => {
    const hm = document.querySelector('.heatmap');
    if (!hm) return { exists:false };
    const head = (hm.querySelector('.hm-head')||{}).textContent || '';
    const stats = (hm.querySelector('.hm-stats')||{}).textContent || '';
    const cells = hm.querySelectorAll('.hm-cell').length;
    const empties = hm.querySelectorAll('.hm-cell.empty').length;
    const gold = hm.querySelectorAll('.hm-cell.s-gold').length;
    const soft = hm.querySelectorAll('.hm-cell.s-soft').length;
    const green = hm.querySelectorAll('.hm-cell.s-green').length;
    const miss = hm.querySelectorAll('.hm-cell.s-miss').length;
    const today = hm.querySelectorAll('.hm-cell.today').length;
    const todayTitle = (hm.querySelector('.hm-cell.today')||{}).getAttribute('title') || '';
    const legend = (hm.querySelector('.hm-legend')||{}).textContent || '';
    return { exists:true, head, stats, cells, empties, gold, soft, green, miss, today, todayTitle, legend };
  })()`);
  const nowD = new Date();
  const y0 = new Date(nowD.getFullYear(), 0, 1);
  const firstDow = (y0.getDay() + 6) % 7;
  const totalDays = Math.floor((nowD - y0) / 86400000) + 1;
  const expCells = firstDow + totalDays + (7 - ((firstDow + totalDays) % 7)) % 7;
  console.log('①热力图:', JSON.stringify(r1), `expCells=${expCells} firstDow=${firstDow} totalDays=${totalDays}`);
  const ok1 = r1.exists
    && r1.head.includes(String(nowD.getFullYear())) && r1.head.includes('坚持热力图')
    && r1.cells === expCells
    && r1.gold === 1 && r1.soft === 2 && r1.green === 1 && r1.miss === 1
    && r1.today === 1
    && r1.todayTitle.includes('已签到') && r1.todayTitle.includes('执行了') && r1.todayTitle.includes('¥100')
    && r1.stats.includes('签到 3') && r1.stats.includes('执行 3') && r1.stats.includes('¥150')
    && r1.legend.includes('无') && r1.legend.includes('签到') && r1.legend.includes('执行');

  // ②空态：无任何数据 → 我的页无热力图
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
  const r2 = await ev(`(() => { const hm = document.querySelector('.heatmap'); return { heatExists: !!hm }; })()`);
  console.log('②空态无热力图:', JSON.stringify(r2));

  const pass = ok1 && r2.heatExists === false;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
