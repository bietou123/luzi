#!/usr/bin/env node
/** CDP 验证 v4.25.0：金币等级升级全屏庆祝弹窗（跨级弹窗 + 防重 + 未跨级不弹 + 最高级） */
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
  const reload = () => ev(`(function(){ location.reload(); return 'ok'; })()`);
  const clickDone = async () => { const btn = await ev(`document.querySelector('[data-review="done"]') ? document.querySelector('[data-review="done"]').click() : 'NOBTN'`); return btn; };
  const luInfo = () => ev(`(() => { const c = document.querySelector('.lvl-up'); if (!c) return null; const card = c.querySelector('.lu-card'); return { name: (card.querySelector('.lu-name')||{}).textContent, coins: (card.querySelector('.lu-coins')||{}).textContent, next: (card.querySelector('.lu-next')||{}).textContent, hasBtn: !!card.querySelector('[data-close]'), icon: (card.querySelector('.lu-icon')||{}).textContent }; })()`);
  const closeLu = () => ev(`document.querySelector('.lvl-up') && document.querySelector('.lu-btn') ? document.querySelector('.lu-btn').click() : null`);

  // 场景 1：coins=95(学徒已庆祝 levelIdx:1) → 点 done +10 → 跨 100 → 弹「搞钱新手」
  await seed({ coins: 95, levelIdx: 1, reviews: {} });
  await sleep(2400);
  await clickDone();
  await sleep(1200);
  const c1 = await luInfo();
  console.log('1跨100级:', JSON.stringify(c1));
  await closeLu();
  await sleep(300);
  const c1closed = await luInfo();
  console.log('1关闭后:', JSON.stringify(c1closed));

  // 场景 2：承接场景1 state（levelIdx=2, 今天已 done, reviewRewarded 有今天）→ reload → repick→再 done → 防重不弹
  await reload();
  await sleep(2400);
  await ev(`document.querySelector('[data-review-repick]') ? document.querySelector('[data-review-repick]').click() : null`);
  await sleep(400);
  await clickDone();
  await sleep(1200);
  const c2 = await luInfo();
  console.log('2防重:', JSON.stringify(c2));

  // 场景 3：coins=300(稳步上手中 idx3) → 点 done +10 → 310 <800 未跨级 → 无弹窗
  await seed({ coins: 300, levelIdx: 3, reviews: {} });
  await sleep(2400);
  await clickDone();
  await sleep(1200);
  const c3 = await luInfo();
  console.log('3未跨级:', JSON.stringify(c3));

  // 场景 4：coins=4995(达人 idx5) → 点 done +10 → 5005 跨 5000 → 弹「搞钱宗师」最高级
  await seed({ coins: 4995, levelIdx: 5, reviews: {} });
  await sleep(2400);
  await clickDone();
  await sleep(1200);
  const c4 = await luInfo();
  console.log('4跨5000级:', JSON.stringify(c4));
  await closeLu();

  // 场景 5：coins=6000(宗师已庆祝 levelIdx:6) → 点 done +10 → 6010 最高级不跨 → 无弹窗
  await seed({ coins: 6000, levelIdx: 6, reviews: {} });
  await sleep(2400);
  await clickDone();
  await sleep(1200);
  const c5 = await luInfo();
  console.log('5最高级:', JSON.stringify(c5));

  const pass = c1 && c1.name === '搞钱新手' && c1.icon === '🎯' && c1.coins.includes('105') && c1.next.includes('195') && c1.hasBtn
    && c1closed === null && c2 === null && c3 === null
    && c4 && c4.name === '搞钱宗师' && c4.icon === '🐉' && c4.coins.replace(/,/g,'').includes('5005') && c4.next.includes('最高')
    && c5 === null;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
