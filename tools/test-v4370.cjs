#!/usr/bin/env node
/** CDP 验证 v4.37.0：攒钱节奏预测（按当前速度还需 N 天 / 空记录鼓励 / 已达标无预测） */
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
  const pace = () => ev(`(() => { const p=document.querySelector('.sg-pace'); if(!p) return null; return { text: p.textContent.replace(/\\s+/g,' ').trim(), warn: p.classList.contains('warn') }; })()`);

  // 预热
  await seed({});
  await sleep(4000);

  // 场景 1：无目标 → 设置态，无 pace
  await seed({});
  await sleep(2500);
  const p1 = await pace();
  const set1 = await ev(`(() => { const s=document.querySelector('.sg-set'); return s ? s.textContent : null; })()`);
  console.log('1无目标:', JSON.stringify({ pace: p1, set: set1 }));
  const ok1 = p1 === null && set1 === '设置';

  // 场景 2：有节奏 → 3 天各 +100 → 日均净攒 ¥100，还需 7 天
  const T = await devD(0); const Y = await devD(-1); const Y2 = await devD(-2);
  await seed({ saveGoal: 1000, saveGoalCelebrated: false, records: [{ routeId: 'd001', type: 'in', date: T, amount: 100 }, { routeId: 'd001', type: 'in', date: Y, amount: 100 }, { routeId: 'd001', type: 'in', date: Y2, amount: 100 }] });
  await sleep(2500);
  const p2 = await pace();
  console.log('2有节奏:', JSON.stringify({ pace: p2 }));
  const ok2 = p2 && !p2.warn && p2.text.includes('还需 7 天') && p2.text.includes('日均净攒 ¥100');

  // 场景 3：空记录 → warn「还没攒下钱」
  await seed({ saveGoal: 1000, saveGoalCelebrated: false });
  await sleep(2500);
  const p3 = await pace();
  console.log('3空记录:', JSON.stringify({ pace: p3 }));
  const ok3 = p3 && p3.warn && p3.text.includes('还没攒下钱');

  // 场景 4：已达标 → 无 pace
  await seed({ saveGoal: 1000, saveGoalCelebrated: true, records: [{ routeId: 'd001', type: 'in', date: T, amount: 1100 }] });
  await sleep(2500);
  const p4 = await pace();
  const done4 = await ev(`(() => { const g=document.querySelector('.save-goal'); return g && g.classList.contains('done'); })()`);
  console.log('4达标:', JSON.stringify({ pace: p4, done: done4 }));
  const ok4 = p4 === null && done4 === true;

  const pass = ok1 && ok2 && ok3 && ok4;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
