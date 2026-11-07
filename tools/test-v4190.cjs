#!/usr/bin/env node
/** CDP 验证 v4.19.0：首页连续执行里程碑进度条（与签到里程碑条对称的双引擎） */
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
  const mile = () => ev(`(() => { const el = document.querySelector('.streak-ms.exec'); if (!el) return null; return { cls: el.className, top: el.querySelector('.ms-top') ? el.querySelector('.ms-top').textContent.replace(/\\s+/g,' ').trim() : null, fill: el.querySelector('.ms-fill') ? el.querySelector('.ms-fill').style.width : null, text: el.textContent.replace(/\\s+/g,' ').trim() }; })()`);
  const mkReviews = (n) => { const o = {}; const e = new Date('2026-08-10T00:00:00'); for (let i = 0; i < n; i++) { const d = new Date(e); d.setDate(d.getDate() - i); o[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`] = 'done'; } return o; };

  // 场景 1：无 done → 无条
  await seed({});
  await sleep(2000);
  const m1 = await mile();
  console.log('1空:', JSON.stringify(m1));

  // 场景 2：今天 done → streak 1 → 距 7 天 +60 · 14%
  await seed({ reviews: mkReviews(1) });
  await sleep(2000);
  const m2 = await mile();
  console.log('2执行1:', JSON.stringify(m2));

  // 场景 3：连续 6 天 done → 距 7 天 86%
  await seed({ reviews: mkReviews(6) });
  await sleep(2000);
  const m3 = await mile();
  console.log('3执行6:', JSON.stringify(m3));

  // 场景 4：连续 60 天 → 全解锁 done 态
  await seed({ reviews: mkReviews(60) });
  await sleep(2000);
  const m4 = await mile();
  console.log('4执行60:', JSON.stringify(m4));

  const pass = m1 === null
    && m2 && m2.top.includes('连续执行 1 天') && m2.top.includes('距 7 天') && m2.top.includes('+60') && m2.fill === '14%' && m2.cls.includes('exec') && !m2.cls.includes('done')
    && m3 && m3.top.includes('连续执行 6 天') && m3.top.includes('距 7 天') && m3.fill === '86%'
    && m4 && m4.cls.includes('done') && m4.text.includes('全部连续执行里程碑已解锁');
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
