#!/usr/bin/env node
/** CDP 验证 v1.5.4：详情页步骤完成标记 */
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
  await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };

  await ev(`localStorage.setItem('luzi_seen_onboard','1'); document.querySelector('.onboard')?.remove(); 'ok'`).catch(() => {});
  // 清掉进度，从干净状态开始
  await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')||'{}'); h.progress={}; localStorage.setItem('luzi_app_v1', JSON.stringify(h)); 'ok'; })()`);
  await ev(`location.hash = ''; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  await ev(`location.hash = 'route/d001'; 'ok'`);
  await sleep(700);

  const stepState = () => ev(`(() => {
    const items = [...document.querySelectorAll('.step-item')];
    return {
      total: items.length,
      done: items.map(i => i.classList.contains('done')),
      checks: items.map(i => i.querySelector('.step-check')?.textContent || ''),
      progLabel: document.querySelector('.sp-label span:last-child')?.textContent || '',
      fillW: document.querySelector('.sp-bar .fill')?.style.width || '',
    };
  })()`);

  console.log('初始:', JSON.stringify(await stepState()));

  // 点第 1 步（index0）→ 进度 1
  await ev(`document.querySelector('[data-step="0"]').click(); 'ok'`);
  await sleep(500);
  console.log('点第1步:', JSON.stringify(await stepState()));

  // 点第 3 步（index2）→ 进度 3
  await ev(`document.querySelector('[data-step="2"]').click(); 'ok'`);
  await sleep(500);
  console.log('点第3步:', JSON.stringify(await stepState()));

  // 点第 2 步（index1，已完成非边界）→ 进度退回 1
  await ev(`document.querySelector('[data-step="1"]').click(); 'ok'`);
  await sleep(500);
  console.log('点已完成第2步:', JSON.stringify(await stepState()));

  // 再点第 1 步（index0，边界）→ 进度退回 0
  await ev(`document.querySelector('[data-step="0"]').click(); 'ok'`);
  await sleep(500);
  console.log('再点第1步:', JSON.stringify(await stepState()));

  // state.progress 持久化检查
  const prog = await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); return h.progress; })()`);
  console.log('state.progress:', JSON.stringify(prog));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
