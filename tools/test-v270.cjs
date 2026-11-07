#!/usr/bin/env node
/** CDP 验证 v2.7.0：首页签到里程碑进度条 */
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
const seed = (s) => `(function(){
  function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
  var now=new Date();
  var checkin={};
  for(var i=1;i<=${s.streak};i++){ var d=new Date(now.getTime()-i*86400000); checkin[fmt(d)]=1; }
  var yest=fmt(new Date(now.getTime()-86400000));
  localStorage.setItem('luzi_seen_onboard','1');
  localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:checkin, lastCheckin:yest, streak:${s.streak}, coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:${JSON.stringify(s.rewards||[])}, tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] }));
  return 'ok';
})()`;
(async () => {
  const list = await getJSON('/json'); const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl); await cdp.send('Runtime.enable'); await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r.result.value; };
  const go = async (s, wait) => { await ev(seed(s)); await ev(`location.hash='home'; location.reload(); 'ok'`); await sleep(wait); };

  // ① streak=6 → 距7天+50，进度条 86%
  await go({ streak: 6, rewards: [] }, 2200);
  const r1 = await ev(`(() => { const m = document.querySelector('.streak-ms'); if (!m) return { exists:false }; return { top: (m.querySelector('.ms-top')||{}).textContent || '', fill: (m.querySelector('.ms-fill')||{}).style.width || '', done: m.classList.contains('done') }; })()`);
  console.log('①streak6:', JSON.stringify(r1));
  const ok1 = !!r1.top && r1.top.includes('连续签到 6') && r1.top.includes('距 7 天') && r1.top.includes('+50') && r1.fill === '86%' && !r1.done;

  // ② streak=29 → 距30天+150，进度 97%
  await go({ streak: 29, rewards: [] }, 2200);
  const r2 = await ev(`(() => { const m = document.querySelector('.streak-ms'); return { top: (m.querySelector('.ms-top')||{}).textContent || '', fill: (m.querySelector('.ms-fill')||{}).style.width || '' }; })()`);
  console.log('②streak29:', JSON.stringify(r2));
  const ok2 = r2.top.includes('连续签到 29') && r2.top.includes('距 30 天') && r2.top.includes('+150') && r2.fill === '97%';

  // ③ streak=60（全部解锁）→ 显示已完成文案
  await go({ streak: 60, rewards: [7, 30, 60] }, 2200);
  const r3 = await ev(`(() => { const m = document.querySelector('.streak-ms'); return { text: (m.textContent||'').trim(), done: m.classList.contains('done') }; })()`);
  console.log('③streak60:', JSON.stringify(r3));
  const ok3 = r3.done && r3.text.includes('全部签到里程碑已解锁') && r3.text.includes('60');

  // ④ streak=0 未签过 → 无进度条
  await go({ streak: 0, rewards: [] }, 2200);
  const r4 = await ev(`(() => ({ exists: !!document.querySelector('.streak-ms') }))()`);
  console.log('④streak0:', JSON.stringify(r4));
  const ok4 = r4.exists === false;

  const pass = ok1 && ok2 && ok3 && ok4;
  console.log('断言明细:', { ok1, ok2, ok3, ok4 });
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
