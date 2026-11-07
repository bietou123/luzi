#!/usr/bin/env node
/** CDP 诊断：tab 栏为何不在底部渲染 + 收集 JS 错误 */
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await getJSON('/json');
  const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Runtime.evaluate', { expression: `location.hash='home'; 'ok'` });
  await sleep(700);
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };
  const diag = await ev(`(() => {
    const tb = document.getElementById('tabbar');
    const view = document.getElementById('view');
    const res = {
      tabbarExists: !!tb,
      tabCount: tb ? tb.querySelectorAll('.tab').length : 0,
      tabbarRect: tb ? (() => { const r = tb.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), w: Math.round(r.width) }; })() : null,
      viewRect: view ? (() => { const r = view.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; })() : null,
      viewport: { h: window.innerHeight, dpr: window.devicePixelRatio, safeBottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom') },
      bodyScrollH: document.body.scrollHeight,
      bodyClientH: document.body.clientHeight,
      activeTab: document.querySelector('.tab.active')?.dataset.view || null,
      activeTabColor: tb ? getComputedStyle(document.querySelector('.tab.active')).color : null,
      tabColor: tb ? getComputedStyle(document.querySelector('.tab')).color : null,
      htmlHeight: document.documentElement.clientHeight,
    };
    return res;
  })()`);
  console.log('诊断:', JSON.stringify(diag, null, 1));

  // 尝试读取 onerror 捕获的历史错误
  const errs = await ev(`(() => window.__luziErrors || [])()`);
  console.log('已捕获错误:', JSON.stringify(errs));

  // 看 tabbar computed style 完整
  const style = await ev(`(() => {
    const tb = document.getElementById('tabbar');
    const cs = getComputedStyle(tb);
    return { position: cs.position, bottom: cs.bottom, height: cs.height, zIndex: cs.zIndex, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, paddingBottom: cs.paddingBottom, background: cs.backgroundColor, overflow: cs.overflow, transform: cs.transform, maxWidth: cs.maxWidth };
  })()`);
  console.log('tabbar style:', JSON.stringify(style, null, 1));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('诊断失败:', e.message); process.exit(2); });
