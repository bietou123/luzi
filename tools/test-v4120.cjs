#!/usr/bin/env node
/** CDP 验证 v4.12.0：最近的奖励聚合条（多奖励渠道里取进度最接近的一个） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'' }, ${JSON.stringify(extra||{})}))); location.hash='mine'; location.reload(); return 'ok'; })()`);
  const nr = () => ev(`(() => { const el = document.querySelector('.next-reward'); if (!el) return null; return { line: el.querySelector('.nr-line') ? el.querySelector('.nr-line').textContent.replace(/\\s+/g,' ').trim() : null, fill: el.querySelector('.nr-fill') ? el.querySelector('.nr-fill').style.width : null }; })()`);

  // 场景 1：空态 → 无卡（月/周目标 income=0 不作为候选）
  await seed({});
  await sleep(2000);
  const n1 = await nr();
  console.log('1空态:', JSON.stringify(n1));

  // 场景 2：签到 streak 5 → 距 7 天 71%「再坚持 2 天 +50」
  await seed({ streak: 5, checkin: { '2026-08-09': 1, '2026-08-08': 1, '2026-08-07': 1, '2026-08-06': 1, '2026-08-05': 1 } });
  await sleep(2000);
  const n2 = await nr();
  console.log('2签到5:', JSON.stringify(n2));

  // 场景 3：净赚 80（收入里程碑 100 pct80%）+ streak 0 → 「累计净赚还差 ¥20 +20」
  await seed({ records: [ { id:1, routeId:'d001', title:'a', amount:80, type:'in', date:'2026-08-09' } ] });
  await sleep(2000);
  const n3 = await nr();
  console.log('3净赚80:', JSON.stringify(n3));

  // 场景 4：streak 6（签7 pct86%）+ 净赚 50（收入100 pct50%）→ 取签到 86%
  await seed({ streak: 6, checkin: { '2026-08-09': 1, '2026-08-08': 1, '2026-08-07': 1, '2026-08-06': 1, '2026-08-05': 1, '2026-08-04': 1 }, records: [ { id:1, routeId:'d001', title:'a', amount:50, type:'in', date:'2026-08-09' } ] });
  await sleep(2000);
  const n4 = await nr();
  console.log('4多渠道:', JSON.stringify(n4));

  const pass = n1 === null
    && n2 && n2.line.includes('连续签到再坚持 2 天') && n2.line.includes('+50') && n2.fill === '71%'
    && n3 && n3.line.includes('累计净赚还差') && n3.line.includes('¥20') && n3.line.includes('+20') && n3.fill === '80%'
    && n4 && n4.line.includes('连续签到再坚持 1 天') && n4.line.includes('+50') && n4.fill === '86%';
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
