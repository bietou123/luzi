#!/usr/bin/env node
/** CDP 验证 v1.6.4：分享路子图片卡片 */
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
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 打开详情页
  await ev(`location.hash = 'route/f010'; 'ok'`);
  await sleep(700);
  const hasBtn = await ev(`!!document.querySelector('[data-share-card]')`);
  console.log('分享图片按钮:', hasBtn);

  // 2) 点击 → 生成卡片 modal
  await ev(`document.querySelector('[data-share-card]').click(); 'ok'`);
  await sleep(800);
  const card = await ev(`(() => {
    const img = document.querySelector('.share-card-modal img');
    if (!img) return { modal: !!document.querySelector('.share-card-modal') };
    return {
      modal: true,
      srcIsData: (img.src || '').startsWith('data:image/png'),
      srcLen: (img.src || '').length,
      naturalW: img.naturalWidth,
      naturalH: img.naturalHeight,
      hint: document.querySelector('.sc-hint')?.textContent || '',
    };
  })()`);
  console.log('分享卡片:', JSON.stringify(card));

  // 3) 图片内容检查：加载到 canvas 里抽样几个像素验证非全黑
  const px = await ev(`(async () => {
    const img = document.querySelector('.share-card-modal img');
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    try { ctx.drawImage(img, 0, 0); } catch (e) { return { drawErr: String(e) }; }
    const c = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    return {
      bg: c(10, 700),          // 背景深蓝黑
      goldText: c(100, 140),   // 顶部「路子」金色 logo 附近
      whiteText: c(100, 430),  // 标题白色附近
      bottom: c(500, 1400),    // 底部
      size: [cv.width, cv.height],
    };
  })()`);
  console.log('像素抽样:', JSON.stringify(px));

  // 4) 关闭
  await ev(`document.querySelector('.share-card-modal [data-close]').click(); 'ok'`);
  await sleep(400);
  const closed = await ev(`!document.querySelector('.share-card-modal')`);
  console.log('关闭后 modal 移除:', closed);

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
