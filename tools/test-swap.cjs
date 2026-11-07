#!/usr/bin/env node
/** CDP 验证：今日路子「换一条」+「加入打卡」交互 */
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
  const tap = async (sel) => {
    const rect = await ev(`(() => {
      const t = document.querySelector(${JSON.stringify(sel)});
      if (!t) return null;
      const b = t.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), offTop: window.visualViewport.offsetTop || 0 };
    })()`);
    if (!rect) return false;
    const ty = rect.y - (rect.offTop || 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: ty }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return true;
  };

  // 重置并跳过引导
  await ev(`localStorage.removeItem('luzi_seen_onboard'); location.reload(); 'ok'`);
  await sleep(1800);
  const ob = await ev(`!!document.querySelector('.onboard')`);
  if (ob) {
    const ok = await tap('.ob-skip');
    await sleep(400);
    console.log('跳过引导:', ok);
  }

  // 1. 今日路子标题（换前）
  const t1 = await ev(`document.querySelector('.tr-title')?.textContent || ''`);
  console.log('换一条前:', t1);

  // 2. 点换一条（纯 JS 状态操作，用 click）
  const swapped = await ev(`(() => {
    const b = document.querySelector('[data-swap-today]');
    if (!b) return 'NO_BTN';
    b.click();
    return 'clicked';
  })()`);
  await sleep(600);
  const after = await ev(`(() => ({
    title: document.querySelector('.tr-title')?.textContent || '',
    toast: document.querySelector('#toast')?.textContent || '',
    votes: (() => { const h = JSON.parse(localStorage.getItem('luzi_app_v1')); return h && h.routeVotes ? Object.entries(h.routeVotes) : []; })(),
  }))()`);
  console.log('换一条:', swapped, '→', after.title, '| toast:', after.toast);
  console.log('routeVotes:', JSON.stringify(after.votes));

  // 3. 点加入打卡
  const trk = await ev(`(() => {
    const b = document.querySelector('[data-track]');
    if (!b) return 'NO_BTN';
    b.click();
    return 'clicked';
  })()`);
  await sleep(600);
  const track = await ev(`(() => ({
    hash: location.hash,
    hasCheckCard: !!document.querySelector('.check-card'),
    checkItems: document.querySelectorAll('[data-check]').length,
    pageTitle: document.querySelector('.page-title')?.textContent || '',
  }))()`);
  console.log('加入打卡:', trk, '→', JSON.stringify(track));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
