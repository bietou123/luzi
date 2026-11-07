#!/usr/bin/env node
/** CDP 验证 v1.7.5：明日路子详情预览 */
'use strict';
const net = require('node:net'); const http = require('node:http'); const crypto = require('node:crypto');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b))); }).on('error', rej); });
function connect(wsUrl) {
  const u = new URL(wsUrl); const sock = net.connect(Number(u.port), u.hostname);
  const handlers = new Map(); let id = 0, buf = Buffer.alloc(0), open = false;
  const ready = new Promise((resolve) => {
    sock.on('connect', () => sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); if (!open) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; buf = buf.subarray(i + 4); open = true; resolve(); } for (;;) { if (buf.length < 2) return; const l0 = buf[1] & 0x7f; let off = 2, len = l0; if (l0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (l0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; } if (buf.length < off + len) return; const s = buf.subarray(off, off + len).toString('utf8'); buf = buf.subarray(off + len); let m; try { m = JSON.parse(s); } catch { continue; } if (m.id && handlers.has(m.id)) { handlers.get(m.id)(m); handlers.delete(m.id); } } });
  });
  const frame = (text) => { const d = Buffer.from(text, 'utf8'); const mask = crypto.randomBytes(4); let h; if (d.length < 126) h = Buffer.from([0x81, 0x80 | d.length]); else if (d.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xfe; h.writeUInt16BE(d.length, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0xff; h.writeBigUInt64BE(BigInt(d.length), 2); } const m2 = Buffer.from(d); for (let i = 0; i < m2.length; i++) m2[i] ^= mask[i % 4]; return Buffer.concat([h, mask, m2]); };
  const send = (method, params = {}) => ready.then(() => new Promise((resolve, reject) => { const mid = ++id; handlers.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result))); sock.write(frame(JSON.stringify({ id: mid, method, params }))); }));
  return { send, close: () => sock.destroy() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const list = await getJSON('/json'); const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl); await cdp.send('Runtime.enable'); await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r.result.value; };
  await ev(`(() => { localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:0 })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2500);

  const home = await ev(`(() => {
    const tt = document.querySelector('.tr-tomorrow');
    return { has: !!tt, tomId: tt ? tt.dataset.openTomorrow : null, title: (document.querySelector('.tt-title')||{}).textContent ? document.querySelector('.tt-title').textContent.trim() : '' };
  })()`);
  console.log('①首页预告:', JSON.stringify(home));

  // 点击明日预告条进入预览
  await ev(`document.querySelector('.tr-tomorrow').click(); 'ok'`);
  await sleep(400);
  const det = await ev(`(() => ({
    previewBanner: !!document.querySelector('.preview-banner'),
    bannerText: (document.querySelector('.preview-banner span')||{}).textContent ? document.querySelector('.preview-banner span').textContent.trim() : '',
    trackText: (document.querySelector('[data-track]')||{}).textContent ? document.querySelector('[data-track]').textContent.trim() : '',
    detailTitle: (document.querySelector('.detail-title')||{}).textContent ? document.querySelector('.detail-title').textContent.trim() : ''
  }))()`);
  console.log('②详情预览:', JSON.stringify(det));

  // 点「明天开始」按钮 → 应 toast 提示，不加入打卡
  await ev(`document.querySelector('[data-track]').click(); 'ok'`);
  await sleep(250);
  const trackCheck = await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const today = new Date();
    const tst = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    const tomId = document.querySelector('.tr-tomorrow');
    const toastTxt = (document.querySelector('#toast')||{}).textContent ? document.querySelector('#toast').textContent.trim() : '';
    const keys = Object.keys(s.checks || {});
    return { toastTxt, checksKeys: keys, addedToday: keys.some(k => k.endsWith('::' + tst)) };
  })()`);
  console.log('③点明天开始:', JSON.stringify(trackCheck));

  // 收藏明日路子 → preview 状态应保留
  await ev(`document.querySelector('[data-like2]').click(); 'ok'`);
  await sleep(300);
  const like = await ev(`(() => ({
    previewStill: !!document.querySelector('.preview-banner'),
    likeText: (document.querySelector('[data-like2]')||{}).textContent ? document.querySelector('[data-like2]').textContent.trim() : ''
  }))()`);
  console.log('④收藏后:', JSON.stringify(like));

  // 返回 → 回 home
  await ev(`document.querySelector('[data-back]').click(); 'ok'`);
  await sleep(300);
  const back = await ev(`(() => ({ homeTomorrow: !!document.querySelector('.tr-tomorrow'), viewText: (document.querySelector('.page-title')||{}).textContent ? document.querySelector('.page-title').textContent.trim() : '' }))()`);
  console.log('⑤返回:', JSON.stringify(back));

  const pass = home.has && !!home.tomId && det.previewBanner && det.bannerText === '🌅 明日路子' && det.trackText === '🌅 明天开始' && det.detailTitle === home.title && trackCheck.toastTxt.includes('明天') && trackCheck.addedToday === false && like.previewStill === true && back.homeTomorrow === true;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
