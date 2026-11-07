#!/usr/bin/env node
/** CDP 验证 v4.33.0：首页今日赚钱目标（需赚/已赚/还差 + 今日达标绿框） */
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
  const hgToday = () => ev(`(() => { const c = document.querySelector('.hg-today'); if (!c) return null; return { cls: c.className, text: c.textContent.replace(/\\s+/g,' ').trim() }; })()`);
  // 设备端期望值：income=本月已赚(不含今日已传), todayIn=今日已赚
  const expect = (income, todayIn) => ev(`(() => {
    const goal = 1000; const now = new Date();
    const dim = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    const dl = dim - now.getDate() + 1;
    const perDay = Math.ceil((goal - ${income}) / dl);
    return { perDay, remain: Math.max(0, perDay - ${todayIn}), ok: ${todayIn} >= perDay };
  })()`);
  const devToday = () => ev(`(() => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
  const firstOfMonth = () => ev(`(() => { const d = new Date(); d.setDate(1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01'; })()`);

  // 预热
  await seed({});
  await sleep(4000);
  const T = await devToday(); const F = await firstOfMonth();

  // 场景 1：月未达标 + 今日无收入 → 需赚/已赚0/还差
  await seed({});
  await sleep(2500);
  const e1 = await expect(0, 0);
  const h1 = await hgToday();
  const c1 = { h: h1, e: e1 };
  console.log('1空态今日:', JSON.stringify(c1));
  const p1 = h1 && !h1.cls.includes('done') && h1.text.includes('今日需赚') && h1.text.includes('· 已赚 ¥0') && h1.text.includes('还差 ¥' + e1.perDay);

  // 场景 2：今日收入 50 >= perDay → 今日达标绿框
  await seed({ records: [{ type: 'in', date: T, amount: 50 }] });
  await sleep(2500);
  const e2 = await expect(50, 50);
  const h2 = await hgToday();
  const c2 = { h: h2, e: e2 };
  console.log('2今日达标:', JSON.stringify(c2));
  const p2 = h2 && h2.cls.includes('done') && h2.text.includes('今日达标 ✅');

  // 场景 3：月达标 → 无 hg-today
  await seed({ records: [{ type: 'in', date: F, amount: 1100 }] });
  await sleep(2500);
  const h3 = await hgToday();
  const c3 = { h: h3 };
  console.log('3月达标:', JSON.stringify(c3));
  const p3 = h3 === null;

  // 场景 4：今日收入 2 < perDay → 还差 ¥(perDay-2)
  await seed({ records: [{ type: 'in', date: F, amount: 900 }, { type: 'in', date: T, amount: 2 }] });
  await sleep(2500);
  const e4 = await expect(902, 2);
  const h4 = await hgToday();
  const c4 = { h: h4, e: e4 };
  console.log('4今日还差:', JSON.stringify(c4));
  const p4 = h4 && !h4.cls.includes('done') && h4.text.includes('还差 ¥' + e4.remain);

  const pass = p1 && p2 && p3 && p4;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
