#!/usr/bin/env node
/** CDP 验证 v3.6.0：首单庆祝横幅（一次收起）+ 记账删除二次确认 */
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
  const records = async () => await ev(`(() => { const s = JSON.parse(localStorage.getItem('luzi_app_v1')); return s.records.length; })()`);
  const firstCele = async () => await ev(`(() => { const s = JSON.parse(localStorage.getItem('luzi_app_v1')); return !!s.firstInCelebrated; })()`);

  // 种子：有 in 记录，未庆祝
  await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[{id:'r1',routeId:'d002',title:'简历精修',amount:100,type:'in',note:'',date:'2026-08-10'}], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], firstInCelebrated:false })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);

  // ① 有 in + 未庆祝 → 横幅存在
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const r1 = await ev(`(() => ({ has: !!document.querySelector('.first-in'), txt: (document.querySelector('.fi-t')||{}).textContent||null }))()`);
  console.log('①横幅:', JSON.stringify(r1));

  // ② 点「👏 开心」→ 收起 + 持久化
  await click('.fi-btn[data-first-in-celebrate]');
  await sleep(500);
  const r2 = { has: await ev(`!!document.querySelector('.first-in')`), cele: await firstCele() };
  console.log('②收起:', JSON.stringify(r2));

  // ③ reload → 不再显示
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const r3 = { has: await ev(`!!document.querySelector('.first-in')`) };
  console.log('③reload:', JSON.stringify(r3));

  // ④ 记账页点删除 → 弹窗
  await ev(`location.hash='records'; 'ok'`);
  await sleep(700);
  await click('.ri-del[data-del]');
  await sleep(500);
  const r4 = { modal: await ev(`!!document.querySelector('.modal-sheet')`), h3: await ev(`(() => { const h=document.querySelector('.modal-sheet h3'); return h?h.textContent:null; })()`) };
  console.log('④删除弹窗:', JSON.stringify(r4));

  // ⑤ 取消 → 记录仍在
  await ev(`(() => { const c = document.querySelector('.modal-sheet .btn-cancel[data-close]'); if(c){c.click(); return 'ok';} return 'nofind'; })()`);
  await sleep(500);
  const r5 = { modal: await ev(`!!document.querySelector('.modal-sheet')`), records: await records() };
  console.log('⑤取消:', JSON.stringify(r5));

  // ⑥ 再删 → 确认 → 删除
  await click('.ri-del[data-del]');
  await sleep(500);
  await ev(`(() => { const c = document.querySelector('.modal-sheet [data-confirm-del]'); if(c){c.click(); return 'ok';} return 'nofind'; })()`);
  await sleep(600);
  const r6 = { modal: await ev(`!!document.querySelector('.modal-sheet')`), records: await records(), items: await ev(`document.querySelectorAll('.record-item').length`) };
  console.log('⑥确认删除:', JSON.stringify(r6));

  const pass = r1.has === true && !!r1.txt && r1.txt.includes('第一桶金')
    && r2.has === false && r2.cele === true
    && r3.has === false
    && r4.modal === true && !!r4.h3 && r4.h3.includes('删除')
    && r5.modal === false && r5.records === 1
    && r6.modal === false && r6.records === 0 && r6.items === 0;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
