#!/usr/bin/env node
/** CDP 验证 v4.30.0：今日三步走全完成奖励（+50 金币 + 全屏庆祝 + 防重 + 记账触发） */
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
  // 设备日期可能与宿主机不同，当天精确匹配必须用设备端 today
  const devToday = await ev(`(function(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
  const T = devToday;
  const mkRec = (amount) => ({ id: 'r' + Math.random().toString(36).slice(2,8), routeId: 'd002', date: T, type: 'in', amount, note: '测试', ts: Date.now() });
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const celInfo = () => ev(`(() => { const c = document.querySelector('.exec-cel'); if (!c) return null; return { title: (c.querySelector('.ec-title')||{}).textContent, coins: (c.querySelector('.ec-coins')||{}).textContent }; })()`);
  const stepsLog = () => ev(`(() => { try { return JSON.parse(localStorage.getItem('luzi_app_v1')).coinLog.filter(x => x.note === '今日三步走完成').length; } catch { return -1; } })()`);
  const tsRewarded = () => ev(`(() => { try { return JSON.parse(localStorage.getItem('luzi_app_v1')).todayStepsRewarded || ''; } catch { return ''; } })()`);
  const tsComplete = () => ev(`(() => { const c = document.querySelector('.today-steps'); return c ? c.classList.contains('all-done') : false; })()`);

  // 预热
  await seed({});
  await sleep(4000);

  // 场景 1：空态 → 无庆祝、无奖励、todayStepsRewarded 空
  await seed({});
  await sleep(1200);
  const c1cel = await celInfo();
  const c1log = await stepsLog();
  const c1rw = await tsRewarded();
  console.log('1空态:', JSON.stringify({ cel: c1cel, log: c1log, rw: c1rw }));

  // 场景 2：seed 三步全完成 → 首页渲染触发庆祝 +50 + todayStepsRewarded=T + all-done
  await seed({ checkin: { [T]: 1 }, records: [mkRec(30)], reviews: { [T]: 'done' } });
  await sleep(1400);
  const c2cel = await celInfo();
  const c2log = await stepsLog();
  const c2rw = await tsRewarded();
  const c2done = await tsComplete();
  console.log('2全完成:', JSON.stringify({ cel: c2cel, log: c2log, rw: c2rw, done: c2done }));

  // 场景 3：reload 防重 → 无庆祝、log 仍 1、rw 仍 T
  await ev(`location.reload()`);
  await sleep(1400);
  const c3cel = await celInfo();
  const c3log = await stepsLog();
  const c3rw = await tsRewarded();
  console.log('3防重:', JSON.stringify({ cel: c3cel, log: c3log, rw: c3rw }));

  // 场景 4：只签+执 → 无庆祝、无奖励
  await seed({ checkin: { [T]: 1 }, reviews: { [T]: 'done' } });
  await sleep(1200);
  const c4cel = await celInfo();
  const c4log = await stepsLog();
  console.log('4签+执:', JSON.stringify({ cel: c4cel, log: c4log }));

  // 场景 5：签+执后点记账步骤 → 记一笔 → 三步完成瞬间发奖 +50
  await ev(`document.querySelector('.ts-item[data-ts="book"]') ? document.querySelector('.ts-item[data-ts="book"]').click() : null`);
  await sleep(900);
  const sheetH3 = await ev(`(() => { const m = document.querySelector('.modal-sheet'); return m ? ((m.querySelector('h3')||{}).textContent || null) : null; })()`);
  const filled = await ev(`(function(){ const i = document.querySelector('#money-amount'); if (!i) return false; i.value = '50'; return true; })()`);
  await ev(`(function(){ const b = document.querySelector('[data-save]'); if (b) b.click(); return true; })()`);
  await sleep(1400);
  const c5cel = await celInfo();
  const c5log = await stepsLog();
  const c5rw = await tsRewarded();
  console.log('5记账触发:', JSON.stringify({ sheet: sheetH3, filled, cel: c5cel, log: c5log, rw: c5rw }));

  const pass = c1cel === null && c1log === 0 && c1rw === ''
    && c2cel && c2cel.title && c2cel.title.includes('今日三步走完成') && c2cel.coins && c2cel.coins.includes('+50') && c2log === 1 && c2rw === T && c2done
    && c3cel === null && c3log === 1 && c3rw === T
    && c4cel === null && c4log === 0
    && sheetH3 && sheetH3.includes('记一笔') && filled && c5cel && c5cel.title && c5cel.title.includes('今日三步走完成') && c5cel.coins && c5cel.coins.includes('+50') && c5log === 1 && c5rw === T;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
