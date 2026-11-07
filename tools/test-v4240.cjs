#!/usr/bin/env node
/** CDP 验证 v4.24.0：连续执行里程碑全屏庆祝弹窗（7/30/60 天 → 弹窗 + 金币，防重只弹一次） */
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
  const ds = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  // 昨天起连续 n 天 done（不含今天）
  const mkRev = (n) => { const o = {}; for (let i = 1; i <= n; i++) o[ds(-i)] = 'done'; return o; };
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const reload = () => ev(`(function(){ location.reload(); return 'ok'; })()`);
  const clickDone = async () => { const btn = await ev(`document.querySelector('[data-review="done"]') ? document.querySelector('[data-review="done"]').click() : 'NOBTN'`); return btn; };
  const celInfo = () => ev(`(() => { const c = document.querySelector('.exec-cel'); if (!c) return null; const card = c.querySelector('.ec-card'); return { title: (card.querySelector('.ec-title')||{}).textContent, coins: (card.querySelector('.ec-coins')||{}).textContent, hasBtn: !!card.querySelector('[data-close]') }; })()`);
  const closeCel = () => ev(`document.querySelector('.exec-cel') && document.querySelector('.ec-btn') ? document.querySelector('.ec-btn').click() : null`);

  // 场景 1：空 reviews → 点 done → streak=1 无里程碑 → 无弹窗
  await seed({ reviews: {} });
  await sleep(2400);
  await clickDone();
  await sleep(1100);
  const c1 = await celInfo();
  console.log('1空reviews:', JSON.stringify(c1));

  // 场景 2：连续 6 天 → 点 done → 7 天里程碑 → 弹窗 60 金币 → 关闭
  await seed({ reviews: mkRev(6), execStreakRewards: [] });
  await sleep(2400);
  await clickDone();
  await sleep(1100);
  const c2 = await celInfo();
  console.log('2七天里程碑:', JSON.stringify(c2));
  await closeCel();
  await sleep(300);
  const c2closed = await celInfo();
  console.log('2关闭后:', JSON.stringify(c2closed));

  // 场景 3：连续 29 天 → 点 done → 30 天里程碑 → 弹窗 150 金币
  await seed({ reviews: mkRev(29), execStreakRewards: [] });
  await sleep(2400);
  await clickDone();
  await sleep(1100);
  const c3 = await celInfo();
  console.log('3三十天里程碑:', JSON.stringify(c3));
  await closeCel();

  // 场景 4：承接场景2 状态（execStreakRewards=[7]，今天已 done）→ reload → 重选→再点 done → 防重不弹
  await reload();
  await sleep(2400);
  await ev(`document.querySelector('[data-review-repick]') ? document.querySelector('[data-review-repick]').click() : null`);
  await sleep(400);
  await clickDone();
  await sleep(1100);
  const c4 = await celInfo();
  console.log('4防重:', JSON.stringify(c4));

  // 场景 5：连续 4 天 → 点 done → streak=5 未达里程碑 → 无弹窗
  await seed({ reviews: mkRev(4), execStreakRewards: [] });
  await sleep(2400);
  await clickDone();
  await sleep(1100);
  const c5 = await celInfo();
  console.log('5未达里程碑:', JSON.stringify(c5));

  const pass = c1 === null
    && c2 && c2.title && c2.title.includes('7') && c2.coins.includes('60') && c2.hasBtn
    && c2closed === null
    && c3 && c3.title && c3.title.includes('30') && c3.coins.includes('150')
    && c4 === null && c5 === null;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
