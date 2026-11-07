#!/usr/bin/env node
/** CDP 验证 v4.22.0：我的页信息层级优化——金币入口（coin-rank）前置到总资产后 */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const goMine = () => ev(`(function(){ location.hash='mine'; return 'ok'; })()`);
  const tops = () => ev(`(() => { const g = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1; }; return { ms: g('.money-summary'), cr: g('.coin-rank'), nr: g('.next-reward'), goal: g('.goal-card'), first: g('.first-in') }; })()`);

  // 场景 1：空态——coin-rank 紧跟 money-summary，无崩溃
  await seed({});
  await sleep(2200);
  await goMine();
  await sleep(1200);
  const t1 = await tops();
  console.log('1空态位置:', JSON.stringify(t1));

  // 场景 2：有数据——coin-rank < next-reward < goal-card；金币入口功能可用
  await seed({ records: [{ id:'r1', date: todayStr, type:'in', amount:100, note:'测试', ts:Date.now() }], checkin: { [todayStr]: 1 }, streak: 1, lastCheckin: todayStr, coins: 250 });
  await sleep(2200);
  await goMine();
  await sleep(1200);
  const t2 = await tops();
  console.log('2有数据位置:', JSON.stringify(t2));
  // 点金币商城
  await ev(`document.querySelector('[data-coin-shop]').click()`);
  await sleep(700);
  const shop = await ev(`(() => { const s = document.querySelector('.modal-sheet'); return s ? s.textContent.replace(/\\s+/g,' ').trim().slice(0,60) : null; })()`);
  console.log('3商城弹窗:', JSON.stringify(shop));
  await ev(`document.querySelector('.modal-mask [data-close]').click()`);
  await sleep(400);
  // 点金币明细
  await ev(`document.querySelector('[data-coin-ledger]').click()`);
  await sleep(700);
  const led = await ev(`(() => { const s = document.querySelector('.modal-sheet'); return s ? s.textContent.replace(/\\s+/g,' ').trim().slice(0,60) : null; })()`);
  console.log('4明细弹窗:', JSON.stringify(led));
  await ev(`document.querySelector('.modal-mask [data-close]').click()`);
  await sleep(400);
  // 点金币盲盒
  await ev(`document.querySelector('[data-lucky-box]').click()`);
  await sleep(700);
  const luck = await ev(`(() => { const s = document.querySelector('.lucky-box, .modal-sheet'); return s ? s.textContent.replace(/\\s+/g,' ').trim().slice(0,60) : null; })()`);
  console.log('5盲盒弹窗:', JSON.stringify(luck));

  const pass = t1 && t1.cr > t1.ms && t1.goal > t1.cr && !t1.__err
    && t2 && t2.cr > t2.ms && t2.nr > t2.cr && t2.goal > t2.nr && !t2.__err
    && shop && shop.includes('金币商城') && led && led.includes('金币明细') && luck && (luck.includes('盲盒') || luck.includes('金币'));
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
