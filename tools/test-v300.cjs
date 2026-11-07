#!/usr/bin/env node
/** CDP 验证 v3.0.0：内容库 100 条 + 库页随机按钮 */
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

  // 种子：清空本地状态避免干扰
  await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);

  // ① 库页：100 条
  await ev(`location.hash='library'; 'ok'`);
  await sleep(800);
  const r1 = await ev(`(() => { const sub = document.querySelector('.page-sub'); return { sub: sub?sub.textContent:null, cards: document.querySelectorAll('.route-card').length, hasRandom: !!document.querySelector('.random-btn[data-random-route]') }; })()`);
  console.log('①库页:', JSON.stringify(r1));

  // ② 随机按钮点击进详情
  await click('.random-btn[data-random-route]');
  await sleep(600);
  const r2 = await ev(`(() => { const t = document.querySelector('.detail-title'); const steps = document.querySelectorAll('.step-item').length; return { title: t?t.textContent:null, steps, inDetail: !!document.querySelector('.first-block') }; })()`);
  console.log('②随机详情:', JSON.stringify(r2));

  // ③ 搜索「Excel」命中 s013（openDetail 不改 hash，用 home→library 强制刷新回库页）
  await ev(`location.hash='home'; location.hash='library'; 'ok'`);
  await sleep(700);
  await ev(`(() => { const i = document.querySelector('#search-input'); if(!i) return 'noinput'; i.value = 'Excel'; i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`);
  await sleep(600);
  const r3 = await ev(`(() => { const cards=[...document.querySelectorAll('.route-card')]; return { n: cards.length, hasExcel: cards.some(c=>c.textContent.includes('Excel')) }; })()`);
  console.log('③搜Excel:', JSON.stringify(r3));

  // ④ 搜不存在关键词 → 空态
  await ev(`(() => { const i = document.querySelector('#search-input'); if(i){ i.value='zzz不存在的词'; i.dispatchEvent(new Event('input',{bubbles:true})); } return 'ok'; })()`);
  await sleep(500);
  const r4 = await ev(`(() => ({ empty: !!document.querySelector('.empty'), cards: document.querySelectorAll('.route-card').length }))()`);
  console.log('④空态:', JSON.stringify(r4));

  // ⑤ 清空搜索恢复 100 条
  await ev(`(() => { const i = document.querySelector('#search-input'); if(i){ i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); } return 'ok'; })()`);
  await sleep(500);
  const r5 = await ev(`document.querySelectorAll('.route-card').length`);
  console.log('⑤恢复条数:', r5);

  const pass = !!r1 && r1.sub && r1.sub.includes('100 条') && r1.hasRandom === true
    && !!r2 && r2.inDetail === true && !!r2.title && r2.steps >= 6
    && !!r3 && r3.n >= 1 && r3.hasExcel === true
    && !!r4 && r4.empty === true && r4.cards === 0
    && r5 === 100;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
