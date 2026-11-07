#!/usr/bin/env node
/** CDP 验证 v2.8.0：执行复盘金币奖励（done+10 / partial+5 / miss 不奖 / 防重复） */
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
const SEED = `(function(){
  function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
  var now=new Date();
  var yest=fmt(new Date(now.getTime()-86400000));
  var checkin={}; checkin[yest]=1;
  localStorage.setItem('luzi_seen_onboard','1');
  localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:checkin, lastCheckin:yest, streak:1, coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] }));
  return 'ok';
})()`;
(async () => {
  const list = await getJSON('/json'); const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl); await cdp.send('Runtime.enable'); await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r.result.value; };
  const click = async (sel) => { const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'notfound'; el.click(); return 'ok'; })()`); return r; };
  const st2 = async () => await ev(`(function(){ var s=JSON.parse(localStorage.getItem('luzi_app_v1')); var t=new Date(); var ds=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); return { coins:s.coins, rewarded:!!(s.reviewRewarded||{})[ds], rv:(s.reviews||{})[ds] }; })()`);

  // ① done → +10
  await ev(SEED); await ev(`location.hash='home'; location.reload(); 'ok'`); await sleep(2200);
  const b1 = await click('.trv-btn[data-review="done"]');
  await sleep(400);
  const s1 = await st2();
  const card1 = await ev(`(() => { const c = document.querySelector('.today-review'); return c ? c.className : 'none'; })()`);
  console.log('①done:', JSON.stringify({ b1, coins: s1.coins, rewarded: s1.rewarded, rv: s1.rv, card: card1 }));

  // ①b repick 后选 partial → 不重复发
  await click('.trv-repick[data-review-repick]');
  await sleep(300);
  await click('.trv-btn[data-review="partial"]');
  await sleep(400);
  const s1b = await st2();
  console.log('①b重选partial防重:', JSON.stringify(s1b));

  // ② 独立种子 partial → +5
  await ev(SEED); await ev(`location.hash='home'; location.reload(); 'ok'`); await sleep(2200);
  await click('.trv-btn[data-review="partial"]');
  await sleep(400);
  const s2 = await st2();
  console.log('②partial:', JSON.stringify(s2));

  // ③ 独立种子 miss → 0
  await ev(SEED); await ev(`location.hash='home'; location.reload(); 'ok'`); await sleep(2200);
  await click('.trv-btn[data-review="miss"]');
  await sleep(400);
  const s3 = await st2();
  console.log('③miss:', JSON.stringify(s3));

  const pass = s1.coins === 10 && s1.rewarded === true && s1.rv === 'done' && card1.includes('today-review')
    && s1b.coins === 10 && s1b.rewarded === true
    && s2.coins === 5 && s2.rewarded === true && s2.rv === 'partial'
    && s3.coins === 0 && s3.rv === 'miss';
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
