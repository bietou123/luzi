#!/usr/bin/env node
/** CDP 验证 v3.9.0：详情页「我的执行足迹」——路子收益块展开历史记账明细 */
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
    { id:'b',routeId:'d002',title:'打印材料',amount:20,type:'out',note:'',date:'2026-08-08' },
    { id:'c',routeId:'d002',title:'简历精修',amount:50,type:'in',note:'',date:'2026-07-30' },
    { id:'d',routeId:'d003',title:'证件照精修',amount:300,type:'in',note:'',date:'2026-08-01' },
  ];
  await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:${JSON.stringify(records)}, reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], firstInCelebrated:false })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='library'; 'ok'`);
  await sleep(800);

  // ① d002 详情：收益块完整账目
  await click('[data-open="d002"]');
  await sleep(600);
  const a = await ev(`(() => {
    const amt=(document.querySelector('.earn-block .eb-amt')||{}).textContent||null;
    const note=(document.querySelector('.earn-block .eb-note')||{}).textContent||null;
    const sub=(document.querySelector('.earn-block .eb-sub')||{}).textContent||null;
    const rows=[...document.querySelectorAll('.ebd-row')].map(r=>({ date:(r.querySelector('.ebd-date')||{}).textContent, title:(r.querySelector('.ebd-title')||{}).textContent, amt:(r.querySelector('.ebd-amt')||{}).textContent, red:r.querySelector('.ebd-amt').classList.contains('red') }));
    return { has: !!document.querySelector('.earn-block'), head: !!document.querySelector('.ebx-head'), amt, note, sub, rows, first:rows[0], last:rows[rows.length-1] };
  })()`);
  console.log('①d002执行足迹:', JSON.stringify(a));

  // ② d001（无记录）→ 无收益块
  await ev(`location.hash='home'; location.hash='library'; 'ok'`);
  await sleep(600);
  await click('[data-open="d001"]');
  await sleep(600);
  const b = await ev(`(() => ({ has: !!document.querySelector('.earn-block'), title: (document.querySelector('.detail-title')||{}).textContent }))()`);
  console.log('②d001无记录:', JSON.stringify(b));

  const pass = a && a.has === true && a.head === true
    && !!a.amt && a.amt.includes('¥130') && !!a.note && a.note.includes('2 笔收入')
    && !!a.sub && a.sub.includes('执行 3 天')
    && a.rows.length === 3
    && a.first.date === '08-10' && a.first.title === '简历精修' && a.first.amt === '+¥100' && a.first.red === false
    && a.rows[1].date === '08-08' && a.rows[1].amt === '-¥20' && a.rows[1].red === true
    && a.last.date === '07-30' && a.last.amt === '+¥50'
    && b && b.has === false && !!b.title;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
