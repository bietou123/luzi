#!/usr/bin/env node
/** CDP 验证 v4.2.0：记账自定义日期（新增选历史日期 + 编辑改日期） */
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
  const click = async (sel) => await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'notfound'; el.click(); return 'ok'; })()`);
  const recs = async () => await ev(`JSON.parse(localStorage.getItem('luzi_app_v1')).records`);

  await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], firstInCelebrated:false })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='records'; 'ok'`);
  await sleep(800);

  // ① 打开记账弹窗：日期默认今天
  await click('.head-right [data-addmoney]');
  await sleep(500);
  const d0 = await ev(`document.querySelector('#money-date').value`);
  console.log('①默认日期:', d0);

  // ② 新增：选历史日期 2026-07-15
  await ev(`(() => { document.querySelector('#money-amount').value='100'; document.querySelector('#money-date').value='2026-07-15'; return 'ok'; })()`);
  await click('[data-save]');
  await sleep(600);
  const r1 = await recs();
  const t1 = await ev(`(() => { const it=document.querySelector('.record-item'); return (it.querySelector('.ri-time')||{}).textContent; })()`);
  console.log('②新增历史日期:', JSON.stringify({ date: r1[0].date, t1 }));

  // ③ 编辑：预填原日期 → 改 2026-08-01
  await click('.record-item[data-edit]');
  await sleep(500);
  const dEdit = await ev(`document.querySelector('#money-date').value`);
  await ev(`(() => { document.querySelector('#money-date').value='2026-08-01'; return 'ok'; })()`);
  await click('[data-save]');
  await sleep(600);
  const r2 = await recs();
  const t2 = await ev(`(() => { const it=document.querySelector('.record-item'); return (it.querySelector('.ri-time')||{}).textContent; })()`);
  console.log('③编辑改日期:', JSON.stringify({ dEdit, date: r2[0].date, t2 }));

  const pass = d0 === '2026-08-10'
    && r1[0].date === '2026-07-15' && !!t1 && t1.includes('2026-07-15')
    && dEdit === '2026-07-15'
    && r2[0].date === '2026-08-01' && !!t2 && t2.includes('2026-08-01');
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
