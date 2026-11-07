#!/usr/bin/env node
/** CDP 验证 v1.5.8：今日打卡全部完成 → 庆祝动效 */
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

  // 种子：重置为干净状态，收藏 f010（出现于 track 页），今天 checks 为空
  const seed = await ev(`(() => {
    const today = new Date();
    const ts = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    localStorage.setItem('luzi_seen_onboard','1');
    const h = {
      checkin: {}, checks: {}, records: [], liked: { f010: true },
      progress: {}, routeVotes: {}, coins: 0, achShown: [],
      monthGoal: 1000, goalCelebratedMonth: ''
    };
    h.checks['f010::' + ts] = {};
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    return ts;
  })()`);
  console.log('今日日期:', seed);
  await ev(`location.hash = ''; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 进 track 页，确认 f010 出现且清单项数
  await ev(`location.hash = 'track'; 'ok'`);
  await sleep(700);
  const items = await ev(`document.querySelectorAll('[data-check="f010"]').length`);
  console.log('f010 今日清单项数:', items);

  // 2) 逐次勾完（每次点击触发 render，需 re-query）
  let count = 0, celebrateSeen = false, toastText = null;
  for (let i = 0; i < items; i++) {
    const clicked = await ev(`(() => {
      const box = document.querySelector('[data-check="f010"]:not(.done)');
      if (!box) return false;
      box.click(); return true;
    })()`);
    if (!clicked) break;
    count++;
    await sleep(450);
  }
  console.log('已点击勾选:', count);

  // 3) 最后一项触发 celebrate：检查覆盖层 + toast
  const after = await ev(`(() => ({
    celebrate: !!document.querySelector('.celebrate'),
    cfCount: document.querySelectorAll('.celebrate .cf').length,
    toast: (() => { const t=document.querySelector('#toast'); return t && t.classList.contains('show') ? t.textContent : null; })()
  }))()`);
  console.log('勾完后:', JSON.stringify(after));

  // 4) 等待 2.5 秒，覆盖层应移除
  await sleep(2500);
  const gone = await ev(`!!document.querySelector('.celebrate')`);
  console.log('2.5s 后覆盖层已移除:', !gone);

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
