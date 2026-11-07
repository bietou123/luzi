#!/usr/bin/env node
/** CDP 验证 v4.31.0：连续三步走闭环里程碑（7/30/60 天 + 80/200/400 金币 + 庆祝 + 防重 + ts-streak 显示） */
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
  // 设备日期可能与宿主机不同，日期必须在设备端生成
  const devDates = await ev(`(function(){ const out = []; const d = new Date(); for (let i = 0; i < 8; i++) { out.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')); d.setDate(d.getDate()-1); } return out; })()`);
  const D = devDates; // D[0]=今天, D[1]=昨天 ...
  const T = D[0];
  const mkRec = (date, amount) => ({ id: 'r' + Math.random().toString(36).slice(2,8), routeId: 'd002', date, type: 'in', amount, note: '测试', ts: Date.now() });
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const celInfo = () => ev(`(() => { const c = document.querySelector('.exec-cel'); if (!c) return null; return { title: (c.querySelector('.ec-title')||{}).textContent, coins: (c.querySelector('.ec-coins')||{}).textContent }; })()`);
  const logs = () => ev(`(() => { try { const cl = JSON.parse(localStorage.getItem('luzi_app_v1')).coinLog; return { steps: cl.filter(x => x.note === '今日三步走完成').length, mile: cl.filter(x => x.note && x.note.includes('连续闭环') && x.note.includes('里程碑')).length, notes: cl.map(x => x.note) }; } catch { return { steps: -1, mile: -1, notes: [] }; } })()`);
  const ssr = () => ev(`(() => { try { return JSON.parse(localStorage.getItem('luzi_app_v1')).stepsStreakRewards || []; } catch { return []; } })()`);
  const tsStreak = () => ev(`(() => { const c = document.querySelector('.ts-streak'); return c ? c.textContent : null; })()`);

  // 预热
  await seed({});
  await sleep(4000);

  // 场景 1：空态 → 无庆祝、无里程碑、无 ts-streak
  await seed({});
  await sleep(1200);
  const c1 = { cel: await celInfo(), logs: await logs(), ssr: await ssr(), streak: await tsStreak() };
  console.log('1空态:', JSON.stringify(c1));

  // 场景 2：今天+昨天（2 天连续）三步完成 → +50 三步走 · ts-streak 2 天 · 无里程碑
  const d2 = [D[0], D[1]];
  await seed({ checkin: Object.fromEntries(d2.map(ds => [ds, 1])), records: d2.map((ds, i) => mkRec(ds, 30)), reviews: Object.fromEntries(d2.map(ds => [ds, 'done'])) });
  await sleep(1400);
  const c2 = { cel: await celInfo(), logs: await logs(), ssr: await ssr(), streak: await tsStreak() };
  console.log('2两天:', JSON.stringify(c2));

  // 场景 3：7 天连续 → 里程碑「连续闭环 7 天！」+80 · ssr=[7] · ts-streak 7 天（只弹里程碑）
  const d7 = D.slice(0, 7);
  await seed({ checkin: Object.fromEntries(d7.map(ds => [ds, 1])), records: d7.map((ds, i) => mkRec(ds, 30)), reviews: Object.fromEntries(d7.map(ds => [ds, 'done'])) });
  await sleep(3200);
  const c3 = { cel: await celInfo(), logs: await logs(), ssr: await ssr(), streak: await tsStreak() };
  console.log('3七天:', JSON.stringify(c3));

  // 场景 4：reload 防重 → 无庆祝、不新增发奖、ssr 仍 [7]
  await ev(`location.reload()`);
  await sleep(3200);
  const c4 = { cel: await celInfo(), logs: await logs(), ssr: await ssr(), streak: await tsStreak() };
  console.log('4防重:', JSON.stringify(c4));

  // 场景 5：只今天完成（昨天未完成）→ streak=1 无里程碑 · ts-streak 1 天
  await seed({ checkin: { [T]: 1 }, records: [mkRec(T, 30)], reviews: { [T]: 'done' } });
  await sleep(1400);
  const c5 = { cel: await celInfo(), logs: await logs(), ssr: await ssr(), streak: await tsStreak() };
  console.log('5一天:', JSON.stringify(c5));

  // 场景 6：今天未完成 → 无 ts-streak、无庆祝
  await seed({});
  await sleep(1200);
  const c6 = { cel: await celInfo(), logs: await logs(), ssr: await ssr(), streak: await tsStreak() };
  console.log('6未完成:', JSON.stringify(c6));

  const pass =
    c1.cel === null && c1.logs.steps === 0 && c1.logs.mile === 0 && c1.streak === null
    && c2.cel && c2.cel.title.includes('今日三步走完成') && c2.logs.steps === 1 && c2.logs.mile === 0 && c2.ssr.length === 0 && c2.streak && c2.streak.includes('2')
    && c3.cel && c3.cel.title.includes('连续闭环') && c3.cel.title.includes('7') && c3.cel.coins.includes('+80')
    && c3.logs.steps === 1 && c3.logs.mile === 1 && c3.ssr.includes(7) && c3.streak && c3.streak.includes('7')
    && c4.cel === null && c4.logs.steps === 1 && c4.logs.mile === 1 && c4.ssr.includes(7) && c4.streak && c4.streak.includes('7')
    && c5.cel && c5.cel.title.includes('今日三步走完成') && c5.logs.steps === 1 && c5.logs.mile === 0 && c5.ssr.length === 0 && c5.streak && c5.streak.includes('1')
    && c6.cel === null && c6.streak === null && c6.logs.steps === 0;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
