#!/usr/bin/env node
/** CDP 验证 v2.3.0：分类收入分布图 */
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

  // ①有收入：f002 finance ¥400 in、d002 skill ¥300 in + ¥200 out（净100）、c010 content ¥150 in
  await ev(`(() => {
    var d = new Date(); d.setDate(1);
    function pad(n){ return n<10?'0'+n:String(n); }
    var ds = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:0, liked:{}, checks:{}, records:[
      { id:'a', routeId:'f002', title:'货币基金', amount:400, type:'in', note:'', date:ds },
      { id:'b', routeId:'d002', title:'简历精修', amount:300, type:'in', note:'', date:ds },
      { id:'c', routeId:'d002', title:'简历精修', amount:200, type:'out', note:'', date:ds },
      { id:'e', routeId:'c010', title:'探店笔记', amount:150, type:'in', note:'', date:ds }
    ], reviews:{}, badges:{}, activeBadge:'', coinLog:[] }));
    return 'ok';
  })()`);
  await ev(`location.hash='mine'; location.reload(); 'ok'`);
  await sleep(2200);
  const withData = await ev(`(() => {
    const box = document.querySelector('.cat-income');
    const rows = box ? [...box.querySelectorAll('.ci-row')] : [];
    return {
      has: !!box,
      n: rows.length,
      names: rows.map(r => r.querySelector('.ci-name').textContent),
      amts: rows.map(r => r.querySelector('.ci-amt').textContent),
      widths: rows.map(r => r.querySelector('.ci-fill').style.width),
      head: (box ? box.querySelector('.ci-head') : null) ? box.querySelector('.ci-head').textContent.replace(/\\s+/g,' ').trim() : ''
    };
  })()`);
  console.log('①有收入:', JSON.stringify(withData));

  // ②无收入 → 无分布卡
  await ev(`(() => { localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', coinLog:[] })); return 'ok'; })()`);
  await ev(`location.hash='mine'; location.reload(); 'ok'`);
  await sleep(2000);
  const empty = await ev(`(() => ({ has: !!document.querySelector('.cat-income') }))()`);
  console.log('②无收入:', JSON.stringify(empty));

  const widths = (withData.widths || []).map(w => parseInt(w, 10) || 0);
  const amts = (withData.amts || []).map(a => a.replace('¥',''));
  const descSort = amts.every((a, i) => i === 0 || Number(amts[i-1]) >= Number(a));
  const pass = withData.has && withData.n >= 2 && withData.names.length === withData.n
    && amts[0] === '400' && widths[0] === 100 && descSort
    && !empty.has;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
