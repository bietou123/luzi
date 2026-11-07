#!/usr/bin/env node
/** CDP 验证 v4.32.0：新手路线图 7 步全解锁奖励（+100 金币 + 全屏庆祝 + 防重） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const celInfo = () => ev(`(() => { const c = document.querySelector('.exec-cel'); if (!c) return null; return { title: (c.querySelector('.ec-title')||{}).textContent, coins: (c.querySelector('.ec-coins')||{}).textContent }; })()`);
  const rmLog = () => ev(`(() => { try { const cl = JSON.parse(localStorage.getItem('luzi_app_v1')).coinLog; return { n: cl.filter(x => x.note === '新手路线图全部解锁').length, notes: cl.map(x => x.note) }; } catch { return { n: -1, notes: [] }; } })()`);
  const rw = () => ev(`(() => { try { return JSON.parse(localStorage.getItem('luzi_app_v1')).roadmapRewarded; } catch { return null; } })()`);

  const ALL7 = { d002: 1, d003: 1, s002: 1, c010: 1, d004: 1, l001: 1, f002: 1 };
  const SIX = { d002: 1, d003: 1, s002: 1, c010: 1, d004: 1, l001: 1 };

  // 预热
  await seed({});
  await sleep(4000);

  // 场景 1：空态 → 无庆祝、未发奖、roadmapRewarded false
  await seed({});
  await sleep(2500);
  const c1 = { cel: await celInfo(), log: await rmLog(), rw: await rw() };
  console.log('1空态:', JSON.stringify(c1));

  // 场景 2：7 条路线全解锁 → 首页触发庆祝 +100 · roadmapRewarded=true
  await seed({ liked: ALL7 });
  await sleep(3000);
  const c2 = { cel: await celInfo(), log: await rmLog(), rw: await rw() };
  console.log('2全解锁:', JSON.stringify(c2));

  // 场景 3：reload 防重 → 无庆祝、不新增发奖
  await ev(`location.reload()`);
  await sleep(3000);
  const c3 = { cel: await celInfo(), log: await rmLog(), rw: await rw() };
  console.log('3防重:', JSON.stringify(c3));

  // 场景 4：6 条解锁 → 不弹、未发奖
  await seed({ liked: SIX });
  await sleep(2500);
  const c4 = { cel: await celInfo(), log: await rmLog(), rw: await rw() };
  console.log('4六条:', JSON.stringify(c4));

  const pass = c1.cel === null && c1.log.n === 0 && c1.rw === false
    && c2.cel && c2.cel.title.includes('新手路线图全部解锁') && c2.cel.coins.includes('+100') && c2.log.n === 1 && c2.rw === true
    && c3.cel === null && c3.log.n === 1 && c3.rw === true
    && c4.cel === null && c4.log.n === 0 && c4.rw === false;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
