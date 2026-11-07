#!/usr/bin/env node
/** CDP 验证 v4.27.0：收入里程碑全屏庆祝弹窗（净赚100/5000 弹窗 + 跨多档只弹最高 + 防重 + 未达不弹） */
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
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const mkRec = (amount, type) => ({ id: 'r' + Math.random().toString(36).slice(2,8), routeId: 'd002', date: todayStr, type: type || 'in', amount, note: '测试', ts: Date.now() });
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const celInfo = () => ev(`(() => { const c = document.querySelector('.exec-cel'); if (!c) return null; const card = c.querySelector('.ec-card'); return { icon: (card.querySelector('.ec-icon')||{}).textContent, title: (card.querySelector('.ec-title')||{}).textContent, coins: (card.querySelector('.ec-coins')||{}).textContent, sub: (card.querySelector('.ec-sub')||{}).textContent, hasBtn: !!card.querySelector('[data-close]') }; })()`);

  // 预热：首次冷启动页面加载慢，先空跑一次让 WebView 完全就绪
  await seed({ records: [] });
  await sleep(4000);

  // 场景 1：净赚 100 → 收入里程碑 → 庆祝 +20
  await seed({ records: [mkRec(100)] });
  await sleep(3000);
  const c1 = await celInfo();
  console.log('1净赚100:', JSON.stringify(c1));
  await ev(`document.querySelector('.exec-cel') && document.querySelector('.ec-btn') ? document.querySelector('.ec-btn').click() : null`);
  await sleep(300);
  const c1closed = await celInfo();
  console.log('1关闭后:', JSON.stringify(c1closed));

  // 场景 2：净赚 6000 → 一次跨 4 档 → 只弹最高 5000 +300
  await seed({ records: [mkRec(6000)] });
  await sleep(2600);
  const c2 = await celInfo();
  console.log('2净赚6000:', JSON.stringify(c2));

  // 场景 3：净赚 100 但 earnRewards=[100] → 防重不弹
  await seed({ records: [mkRec(100)], earnRewards: [100] });
  await sleep(2600);
  const c3 = await celInfo();
  console.log('3防重:', JSON.stringify(c3));

  // 场景 4：净赚 80 → 未达 → 无庆祝
  await seed({ records: [mkRec(80)] });
  await sleep(2600);
  const c4 = await celInfo();
  console.log('4未达:', JSON.stringify(c4));

  const pass = c1 && c1.icon === '💰' && c1.title.includes('累计净赚') && c1.title.includes('100') && c1.coins.includes('20') && c1.sub.includes('攒出来') && c1.hasBtn
    && c1closed === null
    && c2 && c2.title.includes('5,000') && c2.coins.includes('300')
    && c3 === null && c4 === null;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
