#!/usr/bin/env node
/** CDP 验证 v1.6.5：搞钱战绩（详情页收益块 + 我的页战绩卡） */
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
  await ev(`location.hash = 'home'; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 拿今日路子 id
  const todayId = await ev(`document.querySelector('.today-route')?.dataset.open || 'f010'`);
  console.log('今日路子:', todayId);

  // 种子：关联该路子的收入/支出 + 另一路子 d002 收入 + 收藏
  const seeded = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const t = '${todayId}';
    const d = new Date().toISOString().slice(0, 10);
    st.records = (st.records || []).filter(r => !String(r.routeId).startsWith('TEST'));
    st.records.unshift(
      { id:'TEST1', routeId:t, title:'PPT代做', amount:500, type:'in', note:'第一单', date:d },
      { id:'TEST2', routeId:t, title:'PPT代做', amount:300, type:'in', note:'第二单', date:d },
      { id:'TEST3', routeId:t, title:'PPT代做', amount:100, type:'out', note:'素材费', date:d },
      { id:'TEST4', routeId:'d002', title:'简历精修', amount:200, type:'in', note:'', date:d },
    );
    st.liked = st.liked || {}; st.liked[t] = 1; st.liked.d002 = 1;
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    return { n: st.records.length, liked: Object.keys(st.liked).length };
  })()`);
  console.log('种子:', JSON.stringify(seeded));
  await ev(`location.reload(); 'ok'`);
  await sleep(2200);

  // 1) 详情页收益块
  await ev(`location.hash = 'route/${todayId}'; 'ok'`);
  await sleep(800);
  const eb = await ev(`(() => {
    const b = document.querySelector('.earn-block');
    if (!b) return { has: false };
    return {
      has: true,
      t: b.querySelector('.eb-t')?.textContent || '',
      amt: b.querySelector('.eb-amt')?.textContent || '',
      sub: b.querySelector('.eb-sub')?.textContent || '',
      btn: !!b.querySelector('[data-earn]'),
    };
  })()`);
  console.log('详情页收益块:', JSON.stringify(eb));

  // 2) 记一笔按钮 → modal 预选来源路子
  await ev(`document.querySelector('.earn-block [data-earn]').click(); 'ok'`);
  await sleep(600);
  const modal = await ev(`(() => {
    const m = document.querySelector('.modal-mask');
    if (!m) return { modal: false };
    const sel = document.querySelector('#money-route');
    return { modal: true, h3: document.querySelector('.modal-sheet h3')?.textContent, selRoute: sel ? sel.value : null };
  })()`);
  console.log('记一笔弹窗:', JSON.stringify(modal));
  await ev(`document.querySelector('.modal-mask [data-close]').click(); 'ok'`);
  await sleep(400);

  // 3) 我的页战绩卡
  await ev(`location.hash = 'mine'; 'ok'`);
  await sleep(800);
  const board = await ev(`(() => {
    const b = document.querySelector('.earn-board');
    if (!b) return { has: false };
    const cells = [...b.querySelectorAll('.eb-cell')].map(c => c.textContent.trim().replace(/\\s+/g, ' '));
    const rows = [...b.querySelectorAll('.eb-row')].map(r => r.textContent.trim());
    return {
      has: true,
      head: b.querySelector('.eb-head')?.textContent || '',
      cells,
      rows,
    };
  })()`);
  console.log('我的页战绩卡:', JSON.stringify(board));

  // 4) 空状态：清 records → mine → 空提示
  const cleared = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    st.records = st.records.filter(r => !String(r.routeId).startsWith('TEST'));
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash = 'mine'; 'ok'`);
  await sleep(800);
  const empty = await ev(`(() => {
    const b = document.querySelector('.earn-board');
    if (!b) return { has: false };
    const e = b.querySelector('.eb-empty');
    return { has: true, emptyText: e ? e.textContent.slice(0, 30) : null };
  })()`);
  console.log('空状态:', JSON.stringify(empty));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
