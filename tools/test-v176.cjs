#!/usr/bin/env node
/** CDP 验证 v1.7.6：成就详情弹窗 */
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
  // 种子：今天签到 1 天 → 解锁「迈出第一步」，其余未解锁
  const today = new Date();
  const tst = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
  await ev(`(() => { localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{'${tst}':1}, coins:0 })); return 'ok'; })()`);
  await ev(`location.hash='mine'; location.reload(); 'ok'`);
  await sleep(2500);

  const grid = await ev(`(() => {
    const items = [...document.querySelectorAll('[data-ach]')];
    return { count: items.length, names: items.map(i => i.querySelector('.as-name').textContent.trim()) };
  })()`);
  console.log('①成就网格:', JSON.stringify(grid));

  // 点已解锁成就（迈出第一步 index 0）
  await ev(`document.querySelector('[data-ach="0"]').click(); 'ok'`);
  await sleep(300);
  const gotSheet = await ev(`(() => ({
    sheet: !!document.querySelector('.ach-sheet'),
    name: (document.querySelector('.ach-name')||{}).textContent ? document.querySelector('.ach-name').textContent.trim() : '',
    desc: (document.querySelector('.ach-desc')||{}).textContent ? document.querySelector('.ach-desc').textContent.trim() : '',
    got: (document.querySelector('.ach-got')||{}).textContent ? document.querySelector('.ach-got').textContent.trim() : '',
    hasProgress: !!document.querySelector('.ach-progress')
  }))()`);
  console.log('②已解锁成就:', JSON.stringify(gotSheet));

  // 关闭弹窗
  await ev(`document.querySelector('[data-close]').click(); 'ok'`);
  await sleep(250);
  const closed = await ev(`!!document.querySelector('.ach-sheet')`);
  console.log('③关闭:', closed);

  // 点未解锁成就（路子收藏家 index 5）
  await ev(`document.querySelector('[data-ach="5"]').click(); 'ok'`);
  await sleep(300);
  const lockSheet = await ev(`(() => ({
    sheet: !!document.querySelector('.ach-sheet'),
    name: (document.querySelector('.ach-name')||{}).textContent ? document.querySelector('.ach-name').textContent.trim() : '',
    big: (document.querySelector('.ach-big')||{}).textContent ? document.querySelector('.ach-big').textContent.trim() : '',
    progress: (document.querySelector('.ap-label')||{}).textContent ? document.querySelector('.ap-label').textContent.trim() : '',
    hasGot: !!document.querySelector('.ach-got')
  }))()`);
  console.log('④未解锁成就:', JSON.stringify(lockSheet));

  const pass = grid.count === 10 && grid.names.length === 10 && gotSheet.sheet === true && gotSheet.name === '迈出第一步' && gotSheet.got.includes('已解锁') && gotSheet.hasProgress === false && closed === false && lockSheet.sheet === true && lockSheet.name === '路子收藏家' && lockSheet.big === '🔒' && lockSheet.progress === '0/5 · 0%' && lockSheet.hasGot === false;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
