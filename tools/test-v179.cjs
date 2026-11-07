#!/usr/bin/env node
/** CDP 验证 v1.7.9：内容库扩充（88 条 + AI 新路子） */
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
  await ev(`location.hash='library'; location.reload(); 'ok'`);
  await sleep(2500);

  // 库总条数
  const total = await ev(`(() => {
    const sub = (document.querySelector('.page-sub')||{}).textContent ? document.querySelector('.page-sub').textContent.trim() : '';
    const cards = document.querySelectorAll('.route-card').length;
    return { sub, cards };
  })()`);
  console.log('①库总数:', JSON.stringify(total));

  // 搜索 AI → 新路子应出现
  await ev(`(() => {
    const input = document.querySelector('#search-input');
    input.value = 'AI';
    input.dispatchEvent(new Event('input'));
    return 'ok';
  })()`);
  await sleep(500);
  const search = await ev(`(() => {
    const titles = [...document.querySelectorAll('.route-card .rc-title')].map(t => t.textContent.trim());
    return { count: titles.length, titles: titles.slice(0, 8) };
  })()`);
  console.log('②搜AI:', JSON.stringify(search));

  // 打开 d018 详情
  await ev(`location.hash='route/d018'; location.reload(); 'ok'`);
  await sleep(2000);
  const detail = await ev(`(() => ({
    title: (document.querySelector('.detail-title')||{}).textContent ? document.querySelector('.detail-title').textContent.trim() : '',
    tag: (document.querySelector('.detail-tag')||{}).textContent ? document.querySelector('.detail-tag').textContent.trim() : '',
    steps: document.querySelectorAll('.step-item').length,
    checks: document.querySelectorAll('.check-item').length,
    pitfalls: document.querySelectorAll('.pitfall-item').length
  }))()`);
  console.log('③d018详情:', JSON.stringify(detail));

  // 今日路子正常
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2500);
  const home = await ev(`(() => ({
    todayTitle: (document.querySelector('.tr-title')||{}).textContent ? document.querySelector('.tr-title').textContent.trim() : '',
    hasTomorrow: !!document.querySelector('.tr-tomorrow'),
    hasRoadmap: !!document.querySelector('.roadmap-card')
  }))()`);
  console.log('④首页:', JSON.stringify(home));

  const pass = total.sub.includes('88') && search.count >= 3 && search.titles.some(t => t.includes('AI')) && detail.title === 'AI 老照片修复/上色代做' && detail.steps === 6 && detail.checks === 7 && detail.pitfalls === 3 && home.todayTitle && home.hasTomorrow && home.hasRoadmap;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
