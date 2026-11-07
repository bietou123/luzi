#!/usr/bin/env node
/** CDP 验证 v1.9.0 连续性：连续 3 天 done → 执行力MAX 解锁 */
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
  const click = async (sel) => { const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'notfound'; el.click(); return 'ok'; })()`); return r; };

  // 种子：前天/昨天 done，今天未复盘
  await ev(`(() => {
    var d = new Date();
    function fmt(x) { var p = function(n){ return n < 10 ? '0' + n : String(n); }; return x.getFullYear() + '-' + p(x.getMonth()+1) + '-' + p(x.getDate()); }
    var yest = fmt(new Date(d.getTime() - 86400000));
    var dayB4 = fmt(new Date(d.getTime() - 2*86400000));
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:0, liked:{}, checks:{}, records:[], reviews: (function(o){ o[yest] = 'done'; o[dayB4] = 'done'; return o; })({}) }));
    return { yest: yest, dayB4: dayB4 };
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);

  // 点「做了」
  await click('[data-review="done"]');
  await sleep(1100);
  // 关记账弹窗
  await click('.modal-mask [data-close]').catch(() => {});
  await sleep(300);

  // 我的页
  await ev(`location.hash='mine'; location.reload(); 'ok'`);
  await sleep(2200);
  const mine = await ev(`(() => {
    const st = document.querySelector('.review-stats');
    const nums = st ? [...st.querySelectorAll('.rs-num')].map(n => n.textContent.trim()) : [];
    const items = [...document.querySelectorAll('.as-item')];
    const exec = items.find(i => i.querySelector('.as-name').textContent === '执行力MAX');
    return { nums, execLocked: exec ? exec.classList.contains('locked') : null };
  })()`);
  console.log('连续3天验证:', JSON.stringify(mine));

  const pass = mine.nums.join(',') === '3天,100%,3天' && mine.execLocked === false;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
