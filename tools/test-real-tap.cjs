#!/usr/bin/env node
/** 真实触摸验证：CDP 拿按钮坐标 → adb input tap → 检查剪贴板写入是否成功 */
'use strict';
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

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
const adb = (args) => execSync(`"D:\\pad6pro\\platform-tools\\adb.exe" ${args}`, { encoding: 'utf8' }).trim();

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

  // 1. 导航详情页
  await ev(`location.hash = 'route/d001'`);
  await sleep(800);

  // 2. 把按钮滚入视口，再拿物理坐标
  await ev(`document.querySelector('[data-copy-first]').scrollIntoView({ block: 'center' })`);
  await sleep(500);
  const geo = await ev(`JSON.stringify((() => {
    const b = document.querySelector('[data-copy-first]').getBoundingClientRect();
    const vv = window.visualViewport || {};
    const sx = window.devicePixelRatio || 1;
    const barTop = vv.offsetTop || 0;
    return { x: Math.round((b.left + b.width / 2) * sx), y: Math.round((b.top + b.height / 2 + barTop) * sx), w: Math.round(b.width * sx), dpr: sx, scrollY: window.scrollY };
  })())`);
  const g = JSON.parse(geo.value);
  console.log('按钮物理坐标:', JSON.stringify(g));

  // 3. 真实触摸点击
  adb(`shell input tap ${g.x} ${g.y}`);
  await sleep(600);

  // 4. 检查 toast（真实手势下 writeText 应成功）
  const toast = await ev(`document.querySelector('#toast')?.textContent || ''`);
  console.log('真实点击后 toast:', toast.value);

  // 5. 尝试读回剪贴板（真实手势 + write 无权限要求，read 可能需要权限）
  const clip = await ev(`(async () => { try { return await navigator.clipboard.readText(); } catch(e) { return 'READ_FAIL:' + e.message; } })()`);
  console.log('剪贴板读回:', String(clip.value).slice(0, 80));

  // 6. 确认页面没有弹复制失败（toast 里不含"失败"）
  const fails = await ev(`document.querySelectorAll('.toast').length`);
  console.log('全局错误:', (await ev(`window.__luziErr || 'none'`)).value);

  cdp.close();
  process.exit(0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(2); });
