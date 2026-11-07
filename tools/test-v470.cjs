#!/usr/bin/env node
/** CDP 验证 v4.7.0：执行×收入关联（有收入执行日平均/无收入引导/空态不显示） */
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
const ds = (offset) => { const d = new Date('2026-08-10'); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
(async () => {
  const list = await getJSON('/json'); const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl); await cdp.send('Runtime.enable'); await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r.result.value; };
  const state = async () => await ev(`JSON.parse(localStorage.getItem('luzi_app_v1'))`);
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[] }, ${JSON.stringify(extra||{})}))); return 'ok'; })()`);
  const goMine = async () => { await ev(`location.hash='mine'; location.reload(); 'ok'`); await sleep(2000); };

  // 场景 1：执行2天都记账 → 平均每天赚
  await seed({ reviews: { [ds(1)]: 'done', [ds(2)]: 'done' }, records: [ { id:1, routeId:'d001', title:'a', amount:300, type:'in', date: ds(1) }, { id:2, routeId:'d001', title:'b', amount:100, type:'in', date: ds(2) } ] });
  await goMine();
  const income = await ev(`(() => { const el = document.querySelector('.rs-income'); return el ? { txt: el.textContent, hint: el.classList.contains('hint') } : null; })()`);
  console.log('1有收入:', JSON.stringify(income));

  // 场景 2：执行但没记账 → 引导
  await seed({ reviews: { [ds(1)]: 'done', [ds(2)]: 'done' }, records: [ { id:1, routeId:'d001', title:'a', amount:50, type:'out', date: ds(1) } ] });
  await goMine();
  const hint = await ev(`(() => { const el = document.querySelector('.rs-income'); return el ? { txt: el.textContent, hint: el.classList.contains('hint') } : null; })()`);
  console.log('2无收入引导:', JSON.stringify(hint));

  // 场景 3：部分执行日有收入 → 只算有收入的
  await seed({ reviews: { [ds(1)]: 'done', [ds(2)]: 'done', [ds(3)]: 'done' }, records: [ { id:1, routeId:'d001', title:'a', amount:300, type:'in', date: ds(1) }, { id:2, routeId:'d001', title:'b', amount:100, type:'in', date: ds(2) } ] });
  await goMine();
  const partial = await ev(`(() => { const el = document.querySelector('.rs-income'); return el ? el.textContent : null; })()`);
  console.log('3部分:', JSON.stringify(partial));

  // 场景 4：空 reviews → 无卡
  await seed({});
  await goMine();
  const none = await ev(`(() => { const el = document.querySelector('.rs-income'); const card = document.querySelector('.review-stats'); return { income: !!el, card: !!card }; })()`);
  console.log('4空态:', JSON.stringify(none));

  const pass = income && income.txt.includes('平均每天赚') && income.txt.includes('¥200') && income.hint === false
    && hint && hint.txt.includes('还没有收入记录') && hint.hint === true
    && partial && partial.includes('平均每天赚') && partial.includes('¥200')
    && none && none.income === false && none.card === false;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
