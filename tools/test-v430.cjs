#!/usr/bin/env node
/** CDP 验证 v4.3.0：连续执行里程碑奖励（7/30 天发金币 + 执行战绩下一里程碑提示 + 防重） */
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
const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
(async () => {
  const list = await getJSON('/json'); const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl); await cdp.send('Runtime.enable'); await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r.result.value; };
  const click = async (sel) => await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'notfound'; el.click(); return 'ok'; })()`);
  const coins = async () => await ev(`JSON.parse(localStorage.getItem('luzi_app_v1')).coins`);
  const streakArr = async () => await ev(`JSON.parse(localStorage.getItem('luzi_app_v1')).execStreakRewards||[]`);

  const seed = async (days) => {
    const reviews = {};
    for (let i = 1; i <= days; i++) {
      const d = new Date('2026-08-10'); d.setDate(d.getDate() - i);
      reviews[dstr(d)] = 'done';
    }
    await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[], reviews:${JSON.stringify(reviews)}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], firstInCelebrated:false, execStreakRewards:[] })); return 'ok'; })()`);
  };
  const goMine = async () => { await ev(`location.hash='mine'; 'ok'`); await sleep(700); };
  const stats = async () => await ev(`(() => { const rs=document.querySelector('.review-stats'); if(!rs) return null; return { streak:(rs.querySelectorAll('.rs-num')[2]||{}).textContent, next:(rs.querySelector('.rs-next')||{}).textContent||null }; })()`);

  // ===== 场景 A：6 天连续 → 点 done → 连续 7 天 +60 =====
  await seed(6);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  const baseA = await coins();
  await click('[data-review="done"]');
  await sleep(700);
  const afterA = await coins();
  const arrA = await streakArr();
  console.log('A(6→7):', JSON.stringify({ baseA, afterA, arrA }));
  await goMine();
  const stA = await stats();
  console.log('A战绩:', JSON.stringify(stA));

  // ===== reload 防重 =====
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  const reloadA = await coins();
  const arrR = await streakArr();
  console.log('Areload:', JSON.stringify({ reloadA, arrR }));

  // ===== 场景 B：29 天连续 → done → 连续 30 天 +150 =====
  await seed(29);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  const baseB = await coins();
  await click('[data-review="done"]');
  await sleep(700);
  const afterB = await coins();
  const arrB = await streakArr();
  console.log('B(29→30):', JSON.stringify({ baseB, afterB, arrB }));
  await goMine();
  const stB = await stats();
  console.log('B战绩:', JSON.stringify(stB));

  const pass = (afterA - baseA) === 70
    && JSON.stringify(arrA) === '[7]'
    && stA && stA.streak && stA.streak.includes('7') && !!stA.next && stA.next.includes('30 天') && stA.next.includes('+150')
    && reloadA === afterA && JSON.stringify(arrR) === '[7]'
    && (afterB - baseB) === 160
    && JSON.stringify(arrB) === '[30]'
    && stB && stB.streak && stB.streak.includes('30') && !!stB.next && stB.next.includes('60 天') && stB.next.includes('+300');
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
