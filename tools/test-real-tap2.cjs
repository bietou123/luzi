#!/usr/bin/env node
/** 真实 tap 端到端验证（spawnSync 直接调 adb，不走 shell） */
'use strict';
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ADB = 'D:/pad6pro/platform-tools/adb.exe';
const adb = (...args) => {
  const r = spawnSync(ADB, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('adb ' + args.join(' ') + ' -> ' + (r.stderr || r.stdout));
  return r.stdout.trim();
};

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
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { err: r.exceptionDetails.text };
    return { value: r.result.value };
  };

  await ev(`window.__clicks = []; document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-copy-first],[data-share],[data-copy-list]');
    window.__clicks.push(t ? t.getAttribute('data-copy-first') || t.getAttribute('data-share') || t.getAttribute('data-copy-list') : 'other:' + e.target.tagName);
  }, true); 'armed'`);

  await ev(`document.querySelector('[data-copy-first]').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  const geo = JSON.parse((await ev(`JSON.stringify((() => {
    const b = document.querySelector('[data-copy-first]').getBoundingClientRect();
    return { x: Math.round((b.left + b.width / 2) * devicePixelRatio), y: Math.round((b.top + b.height / 2) * devicePixelRatio) };
  })())`)).value);
  console.log('tap at', JSON.stringify(geo));

  adb('shell', 'input', 'tap', String(geo.x), String(geo.y));
  await sleep(900);

  console.log('捕获 click:', (await ev(`JSON.stringify(window.__clicks)`)).value);
  console.log('toast:', (await ev(`document.querySelector('#toast')?.textContent || ''`)).value);
  const clip = (await ev(`(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return 'READ_FAIL:' + e.message; } })()`)).value;
  console.log('剪贴板读回:', String(clip).slice(0, 80));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
