#!/usr/bin/env node
/** CDP 验证 v4.11.0：周目标闭环（本周收入 vs 周目标，达标发 150 金币每周一次） */
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
const now = new Date();
const dow = (now.getDay() + 6) % 7;
const mon = new Date(now); mon.setDate(now.getDate() - dow);
const ds = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const monday = ds(mon);
(async () => {
  const list = await getJSON('/json'); const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl); await cdp.send('Runtime.enable'); await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r.result.value; };
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'' }, ${JSON.stringify(extra||{})}))); location.hash='mine'; location.reload(); return 'ok'; })()`);
  const wg = () => ev(`(() => { const el = document.querySelector('.week-goal'); if (!el) return null; return { done: el.classList.contains('done'), txt: el.textContent.replace(/\\s+/g,' ').trim(), fill: el.querySelector('.wg-fill') ? el.querySelector('.wg-fill').style.width : null }; })()`);
  const wgLog = () => ev(`(() => { const s = JSON.parse(localStorage.getItem('luzi_app_v1')); return (s.coinLog || []).filter(l => l.note.includes('本周目标达成')).map(l => l.amt); })()`);

  // 场景 1：本周只记 10 支出 → 未达标（还差），周目标卡显示
  await seed({ records: [ { id:1, routeId:'d001', title:'a', amount:10, type:'out', date: monday } ] });
  await sleep(2000);
  const w1 = await wg();
  const g1 = await wgLog();
  console.log('1未达标:', JSON.stringify({ w1, g1 }));

  // 场景 2：本周 +300 收入（> 周目标 230）→ 达标发 150
  await seed({ records: [ { id:1, routeId:'d001', title:'a', amount:300, type:'in', date: monday } ] });
  await sleep(2000);
  const w2 = await wg();
  const g2 = await wgLog();
  console.log('2达标:', JSON.stringify({ w2, g2 }));

  // 场景 3：reload 防重（weekGoalCelebrated 已设）→ 不再发
  await ev(`location.reload(); 'ok'`); await sleep(2000);
  const g3 = await wgLog();
  console.log('3防重:', JSON.stringify({ g3 }));

  const pass = w1 && w1.done === false && w1.txt.includes('还差') && w1.fill === '0%' && g1.length === 0
    && w2 && w2.done === true && w2.txt.includes('已达成') && w2.fill === '100%'
    && g2.length === 1 && g2[0] === 150
    && g3.length === 1;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
