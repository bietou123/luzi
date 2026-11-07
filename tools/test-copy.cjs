#!/usr/bin/env node
/** 通过 CDP 连接安卓 WebView，验证详情页分享/复制按钮与剪贴板 */
'use strict';
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b)));
  }).on('error', rej);
});

function connect(wsUrl) {
  const u = new URL(wsUrl);
  const sock = net.connect(Number(u.port), u.hostname);
  const handlers = new Map();
  let id = 0, buf = Buffer.alloc(0), open = false;
  const ready = new Promise((resolve) => {
    sock.on('connect', () => sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!open) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; buf = buf.subarray(i + 4); open = true; resolve(); }
      for (;;) {
        if (buf.length < 2) return;
        const l0 = buf[1] & 0x7f; let off = 2, len = l0;
        if (l0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (l0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const s = buf.subarray(off, off + len).toString('utf8'); buf = buf.subarray(off + len);
        let m; try { m = JSON.parse(s); } catch { continue; }
        if (m.id && handlers.has(m.id)) { handlers.get(m.id)(m); handlers.delete(m.id); }
      }
    });
  });
  const frame = (text) => {
    const d = Buffer.from(text, 'utf8'); const mask = crypto.randomBytes(4);
    let h;
    if (d.length < 126) h = Buffer.from([0x81, 0x80 | d.length]);
    else if (d.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xfe; h.writeUInt16BE(d.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0xff; h.writeBigUInt64BE(BigInt(d.length), 2); }
    const m2 = Buffer.from(d); for (let i = 0; i < m2.length; i++) m2[i] ^= mask[i % 4];
    return Buffer.concat([h, mask, m2]);
  };
  const send = (method, params = {}) => ready.then(() => new Promise((resolve, reject) => {
    const mid = ++id;
    handlers.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    sock.write(frame(JSON.stringify({ id: mid, method, params })));
  }));
  return { send, close: () => sock.destroy() };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await getJSON('/json');
  const page = list.find(x => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { err: r.exceptionDetails.text + ': ' + (r.exceptionDetails.exception?.description || '') };
    return { value: r.result.value };
  };

  // 1. 导航到一条路子的详情
  await ev(`location.hash = 'route/d001'`);
  await sleep(700);
  const hasBtns = await ev(`JSON.stringify({
    share: !!document.querySelector('[data-share]'),
    copyFirst: !!document.querySelector('[data-copy-first]'),
    copyList: !!document.querySelector('[data-copy-list]'),
    title: document.querySelector('.detail-title')?.textContent || ''
  })`);
  console.log('按钮存在:', hasBtns.value);

  // 2. 点击"复制首步"
  await ev(`document.querySelector('[data-copy-first]').click()`);
  await sleep(300);
  const toast1 = await ev(`document.querySelector('#toast')?.textContent`);
  console.log('复制首步 toast:', toast1.value);

  // 3. 读剪贴板
  const clip = await ev(`(async () => { try { return await navigator.clipboard.readText(); } catch(e) { return 'READ_FAIL:' + e.message; } })()`);
  console.log('剪贴板:', String(clip.value).slice(0, 80));

  // 4. 点击"复制清单"
  await ev(`document.querySelector('[data-copy-list]').click()`);
  await sleep(300);
  const toast2 = await ev(`document.querySelector('#toast')?.textContent`);
  console.log('复制清单 toast:', toast2.value);

  // 5. 测试分享：只在能读到"分享"按钮时确认存在，不触发原生面板
  const shareBtn = await ev(`document.querySelector('[data-share]')?.textContent`);
  console.log('分享按钮文本:', shareBtn.value);

  // 6. 无 JS 报错检查
  const err = await ev(`window.__luziErr || 'none'`);
  console.log('全局错误:', err.value);

  cdp.close();
  process.exit(0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(2); });
