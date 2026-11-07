#!/usr/bin/env node
/** CDP 验证 v1.7.2：月度战绩分享图 */
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
  const ds = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const TODAY = ds(0), T1 = ds(1), T2 = ds(2);

  // 种子：本月 2 笔收入 + 1 笔支出、签到3天、打卡项若干、收藏2
  await ev(`(() => {
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({
      records: [
        { id:'r1', routeId:'s009', title:'上门收纳', amount:700, type:'in', date:'${TODAY}' },
        { id:'r2', routeId:'d001', title:'PPT代做', amount:800, type:'in', date:'${T1}' },
        { id:'r3', routeId:'s009', title:'上门收纳物料', amount:200, type:'out', date:'${T2}' },
      ],
      checkin: { '${TODAY}':1, '${T1}':1, '${T2}':1 },
      checks: { 'd001::${T1}': { 0:true, 1:true, 2:true } },
      liked: { d001:1, s009:2 },
      monthGoal: 1000, coins: 100, coinLog: []
    }));
    return 'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(1200);

  // 1) 分享按钮存在 + 战绩数据
  const board = await ev(`(() => {
    const b = document.querySelector('[data-share-earn]');
    const grid = [...document.querySelectorAll('.eb-cell')].map(c => c.textContent.replace(/\\s+/g,''));
    return { hasBtn: !!b, btnText: b ? b.textContent.trim() : '', grid };
  })()`);
  console.log('1.分享按钮:', JSON.stringify(board));

  // 2) 点击 → 生成图片
  await ev(`document.querySelector('[data-share-earn]').click(); 'ok'`);
  await sleep(800);
  const img = await ev(`(() => {
    const im = document.querySelector('.share-card-modal img');
    return im ? { w: im.naturalWidth, h: im.naturalHeight, len: (im.src||'').length, hasModal: !!document.querySelector('.share-card-modal') } : { err: 'no img' };
  })()`);
  console.log('2.分享图:', JSON.stringify(img));

  // 3) 像素采样：大数字金色 + 顶部背景
  const px = await ev(`new Promise(res => {
    const im = document.querySelector('.share-card-modal img');
    const i2 = new Image();
    i2.onload = () => {
      const c = document.createElement('canvas'); c.width=1080; c.height=1440;
      const cx = c.getContext('2d'); cx.drawImage(i2, 0, 0);
      const gold = cx.getImageData(540, 470, 1, 1).data;
      const bg = cx.getImageData(100, 100, 1, 1).data;
      res({ gold: Array.from(gold.slice(0,3)), bg: Array.from(bg.slice(0,3)) });
    };
    i2.onerror = () => res({ err: 1 });
    i2.src = im.src;
  })`);
  console.log('3.像素:', JSON.stringify(px));

  // 4) 关闭
  await ev(`document.querySelector('.share-card-modal [data-close]').click(); 'ok'`);
  await sleep(400);
  const closed = await ev(`!document.querySelector('.share-card-modal')`);
  console.log('4.关闭:', closed);

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
