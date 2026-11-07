#!/usr/bin/env node
/** CDP 验证 v3.8.0：收益记录页月份筛选 + 筛选合计 + 记录跳路子详情 */
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

  const records = [
    { id:'a',routeId:'d002',title:'简历精修',amount:100,type:'in',note:'',date:'2026-08-10' },
    { id:'b',routeId:'',title:'打车费',amount:50,type:'out',note:'',date:'2026-08-05' },
    { id:'c',routeId:'d003',title:'证件照精修',amount:300,type:'in',note:'',date:'2026-07-20' },
    { id:'d',routeId:'',title:'零工',amount:80,type:'in',note:'',date:'2026-06-08' },
  ];
  await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:${JSON.stringify(records)}, reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], firstInCelebrated:false })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='records'; 'ok'`);
  await sleep(800);

  const snap = async () => await ev(`(() => {
    const chips=[...document.querySelectorAll('[data-rec-month]')].map(c=>c.dataset.recMonth);
    const active=document.querySelector('[data-rec-month].active');
    const lb=(document.querySelector('.money-summary .lb')||{}).textContent||null;
    const total=(document.querySelector('.money-summary .total')||{}).textContent||null;
    const sum=(document.querySelector('.rm-sum')||{}).textContent||null;
    const items=document.querySelectorAll('.record-item').length;
    const riGo=document.querySelectorAll('.ri-go').length;
    return { chips, active:active?active.dataset.recMonth:null, lb, total, sum, items, riGo };
  })()`);

  // ① 默认全部
  const a = await snap();
  console.log('①全部:', JSON.stringify(a));

  // ② 点 8月 chip
  await click('[data-rec-month="2026-08"]');
  await sleep(500);
  const b = await snap();
  console.log('②8月:', JSON.stringify(b));

  // ③ 点 全部
  await click('[data-rec-month="all"]');
  await sleep(500);
  const c = await snap();
  console.log('③回全部:', JSON.stringify(c));

  // ④ 点 d002 记录的 ri-go → 详情
  await click('[data-rec-month="2026-08"]');
  await sleep(400);
  const goCount = await ev(`document.querySelectorAll('.ri-go').length`);
  await click('.record-item .ri-go');
  await sleep(600);
  const detail = await ev(`!!document.querySelector('.detail-hero')`);
  console.log('④跳详情:', JSON.stringify({ goCount, detail }));

  const pass = a && a.chips.join() === 'all,2026-08,2026-07,2026-06'
    && a.lb === '累计收益' && a.items === 4 && a.riGo === 2 && a.sum === null
    && b && b.chips.join() === 'all,2026-08,2026-07,2026-06'
    && b.active === '2026-08' && b.lb === '8月收益'
    && b.total && b.total.includes('¥50') && b.items === 2
    && b.sum && b.sum.includes('8月') && b.sum.includes('收入') && b.sum.includes('¥100')
    && b.sum.includes('支出') && b.sum.includes('¥50') && b.sum.includes('¥50')
    && c && c.active === 'all' && c.lb === '累计收益' && c.items === 4 && c.sum === null
    && goCount === 1 && detail === true;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
