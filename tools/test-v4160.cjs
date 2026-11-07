#!/usr/bin/env node
/** CDP 验证 v4.16.0：首页昨日回顾（昨日数据才显示，留存钩子） */
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
  const card = () => ev(`(() => { const el = document.querySelector('.yesterday-review'); if (!el) return null; return { head: el.querySelector('.yr-head').textContent.replace(/\\s+/g,' ').trim(), nums: Array.from(el.querySelectorAll('.yr-num')).map(n => n.textContent), txts: Array.from(el.querySelectorAll('.yr-txt')).map(n => n.textContent), lbs: Array.from(el.querySelectorAll('.yr-lb')).map(n => n.textContent), tip: el.querySelector('.yr-tip').textContent }; })()`);

  // 场景 1：无昨日数据 → 无卡
  await seed({});
  await sleep(2000);
  const c1 = await card();
  console.log('1无昨日:', JSON.stringify(c1));

  // 场景 2：昨日 in200 out50 + done + 打卡3
  await seed({
    records: [
      { id:1, routeId:'d001', title:'a', amount:200, type:'in', date:'2026-08-09' },
      { id:2, routeId:'d001', title:'b', amount:50, type:'out', date:'2026-08-09' }
    ],
    reviews: { '2026-08-09': 'done' },
    checks: { 'd001::2026-08-09': { 0:true, 1:true, 2:true } }
  });
  await sleep(2000);
  const c2 = await card();
  console.log('2昨日赚150:', JSON.stringify(c2));

  // 场景 3：昨日 miss 无记账
  await seed({ reviews: { '2026-08-09': 'miss' } });
  await sleep(2000);
  const c3 = await card();
  console.log('3昨日miss:', JSON.stringify(c3));

  // 场景 4：昨日只支出 30
  await seed({ records: [ { id:1, routeId:'d001', title:'c', amount:30, type:'out', date:'2026-08-09' } ] });
  await sleep(2000);
  const c4 = await card();
  console.log('4昨日支出:', JSON.stringify(c4));

  const pass = c1 === null
    && c2 && c2.head.includes('昨日回顾 · 8月9日') && c2.nums[0] === '+¥150' && c2.nums[1] === '3' && c2.txts[0] === '执行了 ✅' && c2.lbs[2] === '昨日打卡' && c2.tip.includes('昨天净赚 ¥150，今天继续冲！')
    && c3 && c3.nums[0] === '+¥0' && c3.nums[1] === '0' && c3.txts[0] === '没执行 ❌' && c3.tip.includes('昨天没记收入')
    && c4 && c4.nums[0] === '-¥30' && c4.tip.includes('昨天支出 ¥30，今天多赚点回来');
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
