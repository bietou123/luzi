#!/usr/bin/env node
/** CDP 验证 v1.5.6：首页今日路子卡片打卡进度联动 */
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
  await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')||'{}'); h.checks={}; localStorage.setItem('luzi_app_v1', JSON.stringify(h)); 'ok'; })()`);
  await ev(`location.hash = ''; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  const trId = await ev(`document.querySelector('.today-route')?.getAttribute('data-open') || ''`);
  console.log('今日路子 id:', trId);

  // 1) 未加入：无进度条，按钮"加入打卡"
  const before = await ev(`(() => {
    return {
      progress: !!document.querySelector('.tr-progress'),
      btn: document.querySelector('.tr-track')?.textContent.trim(),
      joined: document.querySelector('.tr-track')?.classList.contains('joined'),
    };
  })()`);
  console.log('加入前:', JSON.stringify(before));

  // 2) 加入打卡 → 跳 track 页 → 回首页
  await ev(`document.querySelector('[data-track]').click(); 'ok'`);
  await sleep(600);
  console.log('当前hash:', await ev(`location.hash`));
  await ev(`location.hash = 'home'; 'ok'`);
  await sleep(700);
  const joined = await ev(`(() => {
    const p = document.querySelector('.tr-progress');
    return {
      progress: !!p,
      label: p?.querySelector('.tp-label')?.textContent || '',
      fillW: p?.querySelector('.tp-fill')?.style.width || '',
      btn: document.querySelector('.tr-track')?.textContent.trim(),
      joined: document.querySelector('.tr-track')?.classList.contains('joined'),
    };
  })()`);
  console.log('加入后:', JSON.stringify(joined));

  // 3) 去 track 页逐次勾掉 0/1/2 号项（每次重新查询，因 toggleCheck 会重渲染）
  await ev(`location.hash = 'track'; 'ok'`);
  await sleep(600);
  for (const idx of [0, 1, 2]) {
    await ev(`document.querySelector('[data-checkid="${idx}"]').click(); 'ok'`);
    await sleep(300);
  }
  await ev(`location.hash = 'home'; 'ok'`);
  await sleep(700);
  const mid = await ev(`(() => {
    const p = document.querySelector('.tr-progress');
    return { label: p?.querySelector('.tp-label')?.textContent || '', fillW: p?.querySelector('.tp-fill')?.style.width || '' };
  })()`);
  console.log('勾3项后:', JSON.stringify(mid));

  // 4) 勾完剩余 → 全部完成
  await ev(`location.hash = 'track'; 'ok'`);
  await sleep(600);
  for (let idx = 3; idx < 7; idx++) {
    await ev(`document.querySelector('[data-checkid="${idx}"]').click(); 'ok'`);
    await sleep(300);
  }
  await ev(`location.hash = 'home'; 'ok'`);
  await sleep(700);
  const all = await ev(`(() => {
    const p = document.querySelector('.tr-progress');
    const f = p?.querySelector('.tp-fill');
    return { label: p?.querySelector('.tp-label')?.textContent || '', full: f?.classList.contains('full') || false, fillW: f?.style.width || '' };
  })()`);
  console.log('全部完成:', JSON.stringify(all));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
