#!/usr/bin/env node
/** CDP 验证 v4.45.0：执行复盘·写下心得（done/partial 后写 60 字心得，保存可修改，打卡日历回看，repick 清空） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, reviewNotes:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[100,500,1000], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000, challenges:{}, challengeRewarded:[], saveGoal:0, saveGoalCelebrated:false }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const dsExpr = `(() => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`;

  // 预热
  await seed({});
  await sleep(4000);
  const today = await ev(dsExpr);

  // 场景 1：点「✅ 做了」→ 复盘卡 + 心得输入区出现
  await ev(`(() => { const b=document.querySelector('.today-review [data-review="done"]'); if(b) b.click(); return !!b; })()`);
  await sleep(900); // 等 450ms 记账弹窗
  await ev(`(() => { const m=document.querySelector('.modal-mask'); if(m && m.querySelector('[data-close]')) m.querySelector('[data-close]').click(); return 'ok'; })()`);
  await sleep(300);
  const r1 = await ev(`(() => { const n=document.querySelector('.rv-note'); return { hasInput: !!document.querySelector('[data-rv-note-input]'), hasSave: !!document.querySelector('[data-rv-note-save]'), note: !!n }; })()`);
  console.log('1输入区:', JSON.stringify(r1));
  const ok1 = r1.hasInput === true && r1.hasSave === true && r1.note === true;

  // 场景 2：填内容保存 → reviewNotes[today] 写入 + .rv-note.saved 显示
  await ev(`(() => { const t=document.querySelector('[data-rv-note-input]'); t.value='接到了第一单，赚了50'; document.querySelector('[data-rv-note-save]').click(); return 'ok'; })()`);
  await sleep(500);
  const r2 = await ev(`(() => { const s=JSON.parse(localStorage.getItem('luzi_app_v1')); const d=${JSON.stringify('')}||'x'; const saved=document.querySelector('.rv-note.saved'); return { stateNote: s.reviewNotes ? s.reviewNotes[${dsExpr}] : null, savedTxt: saved ? saved.querySelector('.rv-note-txt').textContent.trim() : null, hasEdit: !!document.querySelector('[data-rv-note-edit]') }; })()`);
  console.log('2保存:', JSON.stringify(r2));
  const ok2 = r2.stateNote === '接到了第一单，赚了50' && r2.savedTxt === '接到了第一单，赚了50' && r2.hasEdit === true;

  // 场景 3：点 ✎ 修改 → 回到编辑态（textarea 预填旧值）
  await ev(`(() => { const e=document.querySelector('[data-rv-note-edit]'); if(e) e.click(); return !!e; })()`);
  await sleep(300);
  const r3 = await ev(`(() => { const t=document.querySelector('[data-rv-note-input]'); return { hasInput: !!t, val: t ? t.value : null, hasSave: !!document.querySelector('[data-rv-note-save]') }; })()`);
  console.log('3修改:', JSON.stringify(r3));
  const ok3 = r3.hasInput === true && r3.val === '接到了第一单，赚了50' && r3.hasSave === true;

  // 场景 4：改内容再保存 → 更新
  await ev(`(() => { const t=document.querySelector('[data-rv-note-input]'); t.value='第二单也成了，坚持真有用'; document.querySelector('[data-rv-note-save]').click(); return 'ok'; })()`);
  await sleep(500);
  const r4 = await ev(`(() => { const s=JSON.parse(localStorage.getItem('luzi_app_v1')); return s.reviewNotes ? s.reviewNotes[${dsExpr}] : null; })()`);
  console.log('4更新:', JSON.stringify(r4));
  const ok4 = r4 === '第二单也成了，坚持真有用';

  // 场景 5：打卡日历弹窗显示心得
  await ev(`(() => { location.hash='track'; return 'ok'; })()`);
  await sleep(1500);
  await ev(`(() => { const c=document.querySelector('[data-cal-day="${today}"]'); if(c) c.click(); return !!c; })()`);
  await sleep(400);
  const r5 = await ev(`(() => { const s=document.querySelector('.day-sheet'); if(!s) return null; const rows=[...s.querySelectorAll('.dd-row')].map(x=>x.textContent.trim()); return { hasNote: rows.some(x=>x.includes('📝 心得')&&x.includes('第二单也成了')), all: rows }; })()`);
  console.log('5日历:', JSON.stringify(r5));
  const ok5 = r5 && r5.hasNote === true;

  // 关闭弹窗回首页，repick → 心得清空
  await ev(`(() => { const m=document.querySelector('.modal-mask'); if(m) m.remove(); location.hash='home'; return 'ok'; })()`);
  await sleep(1200);
  await ev(`(() => { const r=document.querySelector('[data-review-repick]'); if(r) r.click(); return !!r; })()`);
  await sleep(500);
  const r6 = await ev(`(() => { const s=JSON.parse(localStorage.getItem('luzi_app_v1')); return !s.reviewNotes || !s.reviewNotes[${dsExpr}]; })()`);
  console.log('6repick清:', JSON.stringify({ cleared: r6 }));
  const ok6 = r6 === true;

  const pass = ok1 && ok2 && ok3 && ok4 && ok5 && ok6;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
