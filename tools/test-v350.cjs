#!/usr/bin/env node
/** CDP 验证 v3.5.0：月目标倒推（剩余天数 + 每天需赚）首页与我的页 */
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
  const seed = async (incomeTotal) => await ev(`(function(){
    var d = new Date(); var p=function(n){return n<10?'0'+n:String(n);};
    var today = d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
    var records=[]; var rest=${incomeTotal};
    while(rest>0){ var amt=Math.min(300,rest); records.push({id:'r'+Math.random(),routeId:'',title:'测试收入',amount:amt,type:'in',note:'',date:today}); rest-=amt; }
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:records, reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], monthGoal:1000, goalCelebratedMonth:'' }));
    return 'ok';
  })()`);
  const homePace = async () => await ev(`(() => { const e = document.querySelector('.hg-pace'); return e ? e.textContent : null; })()`);
  const minePace = async () => await ev(`(() => { const e = document.querySelector('.goal-pace'); return e ? e.textContent : null; })()`);

  // 场景 A：income=600 → 还差400，daysLeft=22 → perDay=ceil(400/22)=19
  await seed(600);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  const aHome = await homePace();
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const aMine = await minePace();
  console.log('A(600):', JSON.stringify({ aHome, aMine }));

  // 场景 B：income=0 → 还差1000 → perDay=ceil(1000/22)=46
  await seed(0);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  const bHome = await homePace();
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const bMine = await minePace();
  console.log('B(0):', JSON.stringify({ bHome, bMine }));

  // 场景 C：income=1200 → 达标 → 无 pace
  await seed(1200);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  const cHome = await homePace();
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const cMine = await minePace();
  console.log('C(1200):', JSON.stringify({ cHome, cMine }));

  const pass = !!aHome && aHome.includes('剩 22 天') && aHome.includes('¥19')
    && !!aMine && aMine.includes('22 天') && aMine.includes('¥19')
    && !!bHome && bHome.includes('剩 22 天') && bHome.includes('¥46')
    && !!bMine && bMine.includes('¥46')
    && cHome === null && cMine === null;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
