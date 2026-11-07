#!/usr/bin/env node
/** CDP 验证 v3.4.0：库页搜索历史（chips 一键重搜 + 清空） */
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
  const setSearch = async (v) => await ev(`(() => { const i = document.querySelector('#search-input'); if(!i) return 'noinput'; i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`);
  const hist = async () => await ev(`(() => { const s = JSON.parse(localStorage.getItem('luzi_app_v1')); return (s.searchHistory||[]); })()`);
  const chips = async () => await ev(`(() => [...document.querySelectorAll('.sh-chip')].map(c=>c.textContent))()`);
  const hasHist = async () => await ev(`!!document.querySelector('.search-hist')`);

  // 种子
  await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], searchHistory:[] })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='library'; 'ok'`);
  await sleep(700);

  // ① 无历史
  const r1 = { hist: await hasHist(), arr: await hist() };
  console.log('①初始:', JSON.stringify(r1));

  // ② 搜「闲鱼」，等 debounce 记录
  await setSearch('闲鱼');
  await sleep(900);
  const r2 = { arr: await hist() };
  console.log('②搜闲鱼:', JSON.stringify(r2));

  // ③ 清空输入 → 显示 chips
  await setSearch('');
  await sleep(500);
  const r3 = { hasHist: await hasHist(), chips: await chips() };
  console.log('③清空显示:', JSON.stringify(r3));

  // ④ 再搜「PPT」→ 历史 [PPT, 闲鱼]
  await setSearch('PPT');
  await sleep(900);
  await setSearch('');
  await sleep(500);
  const r4 = { arr: await hist(), chips: await chips() };
  console.log('④搜PPT:', JSON.stringify(r4));

  // ⑤ 点 chip「闲鱼」→ 搜索闲鱼 + 历史提到最前
  await ev(`(() => { const c = [...document.querySelectorAll('.sh-chip')].find(x=>x.textContent==='闲鱼'); if(c){c.click(); return 'ok';} return 'nofind'; })()`);
  await sleep(700);
  const r5 = { arr: await hist(), cards: await ev(`document.querySelectorAll('.route-card').length`), hasXianyu: await ev(`[...document.querySelectorAll('.route-card')].some(c=>c.textContent.includes('闲鱼'))`) };
  console.log('⑤点chip:', JSON.stringify(r5));

  // ⑥ 清空历史
  await setSearch('');
  await sleep(500);
  await ev(`(() => { const c = document.querySelector('.sh-clear'); if(c){c.click(); return 'ok';} return 'nofind'; })()`);
  await sleep(500);
  const r6 = { hasHist: await hasHist(), arr: await hist() };
  console.log('⑥清空:', JSON.stringify(r6));

  const pass = r1.hist === false && r1.arr.length === 0
    && r2.arr.length === 1 && r2.arr[0] === '闲鱼'
    && r3.hasHist === true && r3.chips.length === 1 && r3.chips[0] === '闲鱼'
    && r4.arr.length === 2 && r4.arr[0] === 'PPT' && r4.arr[1] === '闲鱼' && r4.chips.length === 2
    && r5.arr.length === 2 && r5.arr[0] === '闲鱼' && r5.cards >= 1 && r5.hasXianyu === true
    && r6.hasHist === false && r6.arr.length === 0;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
