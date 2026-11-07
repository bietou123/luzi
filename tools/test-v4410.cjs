#!/usr/bin/env node
/** CDP 验证 v4.41.0：周目标自定义（周战报✏️按钮/弹窗4预设/保存生效/不重置庆祝防刷奖） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[100,500,1000], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000, challenges:{}, challengeRewarded:[], saveGoal:0, saveGoalCelebrated:false }, ${JSON.stringify(extra||{})}))); location.hash='mine'; location.reload(); return 'ok'; })()`);
  const devD = (off) => ev(`(() => { const d=new Date(); d.setDate(d.getDate()+${off}); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);

  // 预热
  await seed({});
  await sleep(4000);

  // 场景 1：空 records → 无周战报无按钮
  const w1 = await ev(`(() => { const w=document.querySelector('.week-report'); return !!w; })()`);
  console.log('1空态:', JSON.stringify({ week: w1 }));
  const ok1 = w1 === false;

  // 场景 2：本周有记录 → 周战报出现，默认目标 ¥230（月1000/4.35），有 ✏️ 按钮
  const T = await devD(0);
  await seed({ records: [{ routeId: 'd001', type: 'in', date: T, amount: 50 }] });
  await sleep(2500);
  const w2 = await ev(`(() => { const w=document.querySelector('.week-report'); if(!w) return null; const line=w.querySelector('.wg-line') ? w.querySelector('.wg-line').textContent.replace(/\\s+/g,' ').trim() : ''; const btn=w.querySelector('[data-week-goal-set]'); return { line, hasBtn: !!btn }; })()`);
  console.log('2周战报:', JSON.stringify(w2));
  const ok2 = w2 && w2.hasBtn === true && w2.line.includes('¥230');

  // 场景 3：点 ✏️ → 弹窗「📅 本周目标」+ 4 预设 + 点 200 chip → input=200 → 保存
  await ev(`(() => { document.querySelector('[data-week-goal-set]').click(); })()`);
  await sleep(800);
  const w3 = await ev(`(() => { const m=document.querySelector('.modal-mask'); if(!m) return null; const h=m.querySelector('h3') ? m.querySelector('h3').textContent : null; const chips=[...m.querySelectorAll('.sg-chip')]; const input=m.querySelector('#week-goal-amount'); return { h, chips: chips.length, chipVals: chips.map(c=>c.dataset.wgVal||c.dataset.sgVal) }; })()`);
  console.log('3弹窗:', JSON.stringify(w3));
  const ok3 = w3 && w3.h && w3.h.includes('本周目标') && w3.chips === 4;
  await ev(`(() => { const m=document.querySelector('.modal-mask'); [...m.querySelectorAll('.sg-chip')].find(c=>c.dataset.wgVal==='200').click(); const input=m.querySelector('#week-goal-amount'); const save=m.querySelector('[data-wg-save]'); return { inputVal: input.value, click: (save.click(), 'saved') }; })()`);
  await sleep(1000);
  const w4 = await ev(`(() => { const st=JSON.parse(localStorage.getItem('luzi_app_v1')); const w=document.querySelector('.week-report'); const line=w && w.querySelector('.wg-line') ? w.querySelector('.wg-line').textContent.replace(/\\s+/g,' ').trim() : null; return { weekGoal: st.weekGoal, line }; })()`);
  console.log('4保存:', JSON.stringify(w4));
  const ok4 = w4 && w4.weekGoal === 200 && w4.line && w4.line.includes('¥200');

  // 场景 5：改目标不重置 weekGoalCelebrated（防改低重复领奖）
  await ev(`(() => { localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('luzi_app_v1')), { weekGoal: 0 }))); })()`);
  await ev(`(() => { const now=new Date(); const dow=(now.getDay()+6)%7; const mon=new Date(now); mon.setDate(now.getDate()-dow); const ds=mon.getFullYear()+'-'+String(mon.getMonth()+1).padStart(2,'0')+'-'+String(mon.getDate()).padStart(2,'0'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('luzi_app_v1')), { weekGoalCelebrated: ds }))); })()`);
  await ev(`(() => { location.reload(); return 'ok'; })()`);
  await sleep(3000);
  const w5 = await ev(`(() => { const st=JSON.parse(localStorage.getItem('luzi_app_v1')); const before=st.weekGoalCelebrated; const wkKey=(() => { const now=new Date(); const dow=(now.getDay()+6)%7; const mon=new Date(now); mon.setDate(now.getDate()-dow); return mon.getFullYear()+'-'+String(mon.getMonth()+1).padStart(2,'0')+'-'+String(mon.getDate()).padStart(2,'0'); })(); return { before, isThisWeek: before===wkKey }; })()`);
  console.log('5已庆祝:', JSON.stringify(w5));
  const ok5 = w5 && w5.before && w5.isThisWeek === true;

  const pass = ok1 && ok2 && ok3 && ok4 && ok5;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
