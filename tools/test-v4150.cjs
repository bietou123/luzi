#!/usr/bin/env node
/** CDP 验证 v4.15.0：首页今日收益速览（今日记账才显示） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'' }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const card = () => ev(`(() => { const el = document.querySelector('.today-income'); if (!el) return null; return { cls: el.className, date: el.querySelector('.tdi-date').textContent, nums: Array.from(el.querySelectorAll('.tdi-num')).map(n => n.textContent), lbs: Array.from(el.querySelectorAll('.tdi-lb')).map(n => n.textContent) }; })()`);

  // 场景 1：无今日记录 → 无卡
  await seed({ records: [ { id:1, routeId:'d001', title:'昨天', amount:100, type:'in', date:'2026-08-09' } ] });
  await sleep(2000);
  const c1 = await card();
  console.log('1昨日有今日无:', JSON.stringify(c1));

  // 场景 2：今日 in 80 + out 30 → 卡 +¥80/-¥30/+¥50
  await seed({ records: [
    { id:1, routeId:'d001', title:'a', amount:80, type:'in', date:'2026-08-10' },
    { id:2, routeId:'d001', title:'b', amount:30, type:'out', date:'2026-08-10' }
  ] });
  await sleep(2000);
  const c2 = await card();
  console.log('2今入支:', JSON.stringify(c2));

  // 场景 3：今日 out 50 无 in → neg 净赚 -¥50
  await seed({ records: [ { id:1, routeId:'d001', title:'c', amount:50, type:'out', date:'2026-08-10' } ] });
  await sleep(2000);
  const c3 = await card();
  console.log('3今日只支出:', JSON.stringify(c3));

  const pass = c1 === null
    && c2 && c2.cls.includes('pos') && c2.date === '8月10日' && c2.nums[0] === '+¥80' && c2.nums[1] === '-¥30' && c2.nums[2] === '+¥50' && c2.lbs[2] === '今日净赚'
    && c3 && c3.cls.includes('neg') && c3.nums[0] === '+¥0' && c3.nums[1] === '-¥50' && c3.nums[2] === '-¥50';
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
