#!/usr/bin/env node
/** CDP 验证 v1.5.5：成就实时解锁提示（签到动作触发 per-achievement toast） */
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
  // 种子：过去 6 天已签到，清空 achShown → 升级校准应静默填「迈出第一步」
  await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const t = new Date();
    h.checkin = {};
    for (let i = 1; i <= 6; i++) { const d = new Date(t); d.setDate(d.getDate()-i); h.checkin[d.toISOString().slice(0,10)] = 1; }
    h.records = []; h.liked = {}; h.checks = {}; h.routeVotes = {}; h.lastCheckin = null; h.streak = 0;
    delete h.achShown;
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    'ok';
  })()`);
  await ev(`location.hash = ''; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 升级校准：achShown 应有「迈出第一步」，加载后无成就 toast
  const cal = await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { achShown: h.achShown, toast: document.querySelector('#toast')?.classList.contains('show') };
  })()`);
  console.log('升级校准:', JSON.stringify(cal));

  // 2) 首页点签到 → 第 7 天 → 解锁「小有坚持」→ 实时 toast
  await ev(`document.querySelector('[data-checkin]').click(); 'ok'`);
  await sleep(1000);
  const after = await ev(`(() => {
    const t = document.querySelector('#toast');
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { toastText: t && t.classList.contains('show') ? t.textContent : null, achShown: h.achShown };
  })()`);
  console.log('签到解锁toast:', JSON.stringify(after));

  // 3) 再去「我的」→ 不应再弹已解锁过的成就
  await ev(`document.querySelector('.modal-mask [data-close]')?.click(); 'ok'`);
  await ev(`location.hash = 'mine'; 'ok'`);
  await sleep(1300);
  const mine = await ev(`(() => {
    const t = document.querySelector('#toast');
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { toastShown: t && t.classList.contains('show') ? t.textContent : null, achShown: h.achShown, asCount: document.querySelector('.as-count')?.textContent };
  })()`);
  console.log('再进我的:', JSON.stringify(mine));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
