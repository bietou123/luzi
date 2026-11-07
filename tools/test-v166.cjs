#!/usr/bin/env node
/** CDP 验证 v1.6.6：收藏夹分类筛选 + 排序 */
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

  await ev(`localStorage.setItem('luzi_seen_onboard','1'); 'ok'`);
  // 种子：4 条不同分类，收藏时间戳递增
  const seeded = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    st.liked = { d001: 1, s009: 2, c001: 3, f001: 4 };
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    return Object.keys(st.liked);
  })()`);
  console.log('种子收藏:', seeded);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 打开收藏页
  await ev(`location.hash='likes'; 'ok'`);
  await sleep(800);
  const init = await ev(`(() => {
    const chips = [...document.querySelectorAll('[data-likes-filter]')].map(c => c.dataset.likesFilter);
    const sorts = [...document.querySelectorAll('[data-likes-sort]')].map(c => c.dataset.likesSort);
    const cards = [...document.querySelectorAll('.route-card')].map(c => c.dataset.open || '');
    const sub = document.querySelector('.page-sub')?.textContent || '';
    return { chips, sorts, cards, sub };
  })()`);
  console.log('收藏页初始:', JSON.stringify(init));

  // 2) 默认排序 time：最新收藏 f001 在最前
  const timeOrder = await ev(`(() => [...document.querySelectorAll('.route-card')].map(c => c.dataset.open).slice(0, 3))()`);
  console.log('time 排序前3:', timeOrder);

  // 3) 分类筛选 content → 只剩 c001
  await ev(`document.querySelector('[data-likes-filter="content"]').click(); 'ok'`);
  await sleep(500);
  const contentF = await ev(`(() => [...document.querySelectorAll('.route-card')].map(c => c.dataset.open))()`);
  console.log('content 筛选:', contentF);

  // 4) 切到全部 + 收入高排序（money）
  await ev(`document.querySelector('[data-likes-filter="all"]').click(); 'ok'`);
  await sleep(400);
  await ev(`document.querySelector('[data-likes-sort="money"]').click(); 'ok'`);
  await sleep(400);
  const moneyTitles = await ev(`(() => [...document.querySelectorAll('.route-card .rc-title, .route-card')].map(c => (c.querySelector('.rc-title')?.textContent || c.textContent.slice(0, 12))).slice(0, 4))()`);
  const moneyVals = await ev(`(() => [...document.querySelectorAll('.route-card')].map(c => {
    const t = c.querySelector('.rc-meta')?.textContent || c.textContent;
    const m = t.match(/¥[\\d,]+-[\\d,]+/); return m ? m[0] : t.slice(0, 20);
  }).slice(0, 4))()`);
  console.log('money 排序:', JSON.stringify({ moneyTitles, moneyVals }));

  // 5) 易上手排序（easy → diff 升序）
  await ev(`document.querySelector('[data-likes-sort="easy"]').click(); 'ok'`);
  await sleep(400);
  const easyTitles = await ev(`(() => [...document.querySelectorAll('.route-card')].map(c => c.dataset.open).slice(0, 4))()`);
  console.log('easy 排序:', easyTitles);

  // 6) 取消收藏：点第一张卡片的 ♡ → 列表少一条
  await ev(`document.querySelector('[data-likes-filter="all"]').click(); 'ok'`);
  await sleep(400);
  const before = await ev(`document.querySelectorAll('.route-card').length`);
  await ev(`document.querySelector('.route-card [data-like]').click(); 'ok'`);
  await sleep(500);
  const after = await ev(`document.querySelectorAll('.route-card').length`);
  console.log('取消收藏:', { before, after });

  // 7) 空态：点一个没有收藏的分类（ecommerce）
  await ev(`document.querySelector('[data-likes-filter="ecommerce"]').click(); 'ok'`);
  await sleep(400);
  const empty = await ev(`(() => {
    const e = document.querySelector('.empty');
    return { has: !!e, text: e ? e.textContent.trim() : '' };
  })()`);
  console.log('分类空态:', JSON.stringify(empty));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
