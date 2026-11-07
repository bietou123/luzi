#!/usr/bin/env node
/** CDP 真实触摸点击 5 个 tab，验证每个 tab 渲染正确的视图（重点：教程 tab 修复） */
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
    if (r.exceptionDetails) return { err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return { value: r.result.value };
  };

  // 打点真实点击，避免 app 内部跳转（如 mine 里 data-go）
  await ev(`window.__c=0; document.addEventListener('click', () => window.__c++, true); 'ok'`);

  const tabs = [
    ['home',  '今日'],
    ['library','路子库'],
    ['today', '教程'],
    ['track', '打卡'],
    ['mine',  '我的'],
  ];
  const results = [];
  for (const [view, label] of tabs) {
    const sel = `[data-view="${view}"]`;
    const rect = JSON.parse((await ev(`JSON.stringify((() => {
      const t = document.querySelector('${sel}');
      if (!t) return null;
      const b = t.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), offTop: window.visualViewport.offsetTop || 0 };
    })())`)).value);
    if (!rect) { results.push(`${label}: ❌ 无 tab 元素`); continue; }
    const ty = rect.y - (rect.offTop || 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: ty }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    // 检查各视图标识
    const probe = JSON.parse((await ev(`JSON.stringify((() => {
      const g = !!document.querySelector('.guide-hero');
      const hero = !!document.querySelector('.hero');
      const mine = !!document.querySelector('.mine-head');
      const lib = !!document.querySelector('.route-card');
      const trk = !!document.querySelector('.track-card, .track-day, [data-check]');
      const gd = document.querySelector('.gh-title');
      const pt = document.querySelector('.page-title');
      const active = [...document.querySelectorAll('.tab, [data-view]')].find(t=>t.classList.contains('active'));
      const act = active ? (active.dataset.view || active.getAttribute('data-view')) : '?';
      return { g, hero, mine, lib, trk, act, gd: gd ? gd.textContent.trim() : '', pt: pt ? pt.textContent.trim() : '' };
    })())`)).value);
    const bits = [];
    if (probe.g) bits.push(`guide(${probe.gd})`);
    if (probe.hero) bits.push('home');
    if (probe.mine) bits.push('mine');
    if (probe.lib) bits.push('library');
    if (probe.trk) bits.push('track');
    results.push(`${label} → active=${probe.act} ${bits.join(' ')}`);
  }
  console.log(results.join('\n'));

  // 全局 JS 错误
  const errs = (await ev(`(window.__errs||[]).slice(-5).join(' | ')`)).value || '';
  console.log('JS错误:', errs || '无');

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
