#!/usr/bin/env node
/** CDP 截屏 + DOM 完整性验证：确认真实渲染布局（tab 栏位置、成就区、坐标映射） */
'use strict';
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
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
  await cdp.send('Page.enable');
  await sleep(300);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };

  // 跳过引导（若显示）
  const onb = await ev(`!!document.querySelector('.onboard')`);
  if (onb) { await ev(`localStorage.setItem('luzi_seen_onboard','1'); document.querySelector('.onboard').remove(); 'ok'`); await sleep(300); }

  // 首页 tab 栏 DOM 位置（CSS 坐标）
  await ev(`location.hash='home'; 'ok'`); await sleep(500);
  const home = await ev(`(() => {
    const tb = document.getElementById('tabbar');
    const tbs = tb.getBoundingClientRect();
    const tabs = [...tb.querySelectorAll('.tab')].map(t => {
      const r = t.getBoundingClientRect();
      const ic = t.querySelector('svg')?.getBoundingClientRect();
      return { v: t.dataset.view, x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), icon: ic ? { x: Math.round(ic.left+ic.width/2), y: Math.round(ic.top+ic.height/2) } : null, color: getComputedStyle(t).color, cls: t.className };
    });
    return { tabbar: { top: Math.round(tbs.top), bottom: Math.round(tbs.bottom), left: Math.round(tbs.left), right: Math.round(tbs.right), h: Math.round(tbs.height) }, tabs, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, docH: document.body.scrollHeight };
  })()`);
  console.log('首页 tab 布局:', JSON.stringify(home, null, 1));

  // CDP 截图（CSS 视口，含 tab 栏）
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/cdp_home.png', Buffer.from(shot.data, 'base64'));
  console.log('已存 tools/cdp_home.png');

  // 真实触摸点击「我的」tab（CSS 坐标）
  const mineTab = home.tabs.find(t => t.v === 'mine');
  if (mineTab) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mineTab.icon.x, y: mineTab.icon.y }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
  }
  const mine = await ev(`(() => {
    const s = document.querySelector('.achieve-sec');
    const tb = document.getElementById('tabbar');
    const active = document.querySelector('.tab.active')?.dataset.view;
    return {
      active,
      tabbarTop: Math.round(tb.getBoundingClientRect().top),
      achieveExists: !!s,
      achCount: s?.querySelector('.as-count')?.textContent || '',
      achItems: s ? s.querySelectorAll('.as-item').length : 0,
      mineHead: document.querySelector('.mine-head')?.textContent || '',
    };
  })()`);
  console.log('我的页(点击后):', JSON.stringify(mine, null, 1));
  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('tools/cdp_mine.png', Buffer.from(shot2.data, 'base64'));
  console.log('已存 tools/cdp_mine.png');

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(2); });
