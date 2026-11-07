#!/usr/bin/env node
/** CDP 验证 v1.7.0：金币明细（收支记录 + 弹窗） */
'use strict';
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b)));
  }).on('error', rej);
});
function connect(wsUrl) {
  const u = new URL(wsUrl);
  const sock = net.connect(Number(u.port), u.hostname);
  const handlers = new Map();
  let id = 0, buf = Buffer.alloc(0), open = false;
  const ready = new Promise((resolve) => {
    sock.on('connect', () => sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!open) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; buf = buf.subarray(i + 4); open = true; resolve(); }
      for (;;) {
        if (buf.length < 2) return;
        const l0 = buf[1] & 0x7f; let off = 2, len = l0;
        if (l0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (l0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const s = buf.subarray(off, off + len).toString('utf8'); buf = buf.subarray(off + len);
        let m; try { m = JSON.parse(s); } catch { continue; }
        if (m.id && handlers.has(m.id)) { handlers.get(m.id)(m); handlers.delete(m.id); }
      }
    });
  });
  const frame = (text) => {
    const d = Buffer.from(text, 'utf8'); const mask = crypto.randomBytes(4);
    let h;
    if (d.length < 126) h = Buffer.from([0x81, 0x80 | d.length]);
    else if (d.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xfe; h.writeUInt16BE(d.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0xff; h.writeBigUInt64BE(BigInt(d.length), 2); }
    const m2 = Buffer.from(d); for (let i = 0; i < m2.length; i++) m2[i] ^= mask[i % 4];
    return Buffer.concat([h, mask, m2]);
  };
  const send = (method, params = {}) => ready.then(() => new Promise((resolve, reject) => {
    const mid = ++id;
    handlers.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    sock.write(frame(JSON.stringify({ id: mid, method, params })));
  }));
  return { send, close: () => sock.destroy() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await getJSON('/json');
  const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };
  const ds = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const T1 = ds(1), T2 = ds(2);

  // ============ 场景1：新用户签到 → 记账（签到+任务） ============
  await ev(`(() => {
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin: {}, coins: 0, coinLog: [] }));
    return 'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  await ev(`document.querySelector('[data-checkin]').click(); 'ok'`);
  await sleep(900);
  const scene1 = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { coins: st.coins, log: (st.coinLog || []).map(l => \`\${l.amt>=0?'+':''}\${l.amt}:\${l.note}\`) };
  })()`);
  console.log('1.签到记账:', JSON.stringify(scene1));

  // ============ 场景2：补签 → 记账 -100 ============
  await ev(`(() => {
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin: { '${T2}': 1 }, coins: 200, coinLog: [], streak: 1, lastCheckin: '${T2}' }));
    return 'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  await ev(`document.querySelector('.makeup-strip').click(); 'ok'`);
  await sleep(500);
  await ev(`document.querySelector('[data-confirm-makeup]').click(); 'ok'`);
  await sleep(900);
  const scene2 = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { coins: st.coins, makeupLog: (st.coinLog || []).filter(l => l.amt < 0).map(l => \`\${l.amt}:\${l.note}\`), hasYest: !!st.checkin['${T1}'] };
  })()`);
  console.log('2.补签记账:', JSON.stringify(scene2));

  // ============ 场景3：明细弹窗 ============
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(900);
  const hasEntry = await ev(`!!document.querySelector('[data-coin-ledger]')`);
  await ev(`document.querySelector('[data-coin-ledger]').click(); 'ok'`);
  await sleep(500);
  const modal = await ev(`(() => {
    const m = document.querySelector('.coin-ledger');
    const rows = [...document.querySelectorAll('.cl-row')].map(r => r.textContent.replace(/\\s+/g,'').slice(0,28));
    return { hasModal: !!m, balance: document.querySelector('.cl-balance')?.textContent.replace(/\\s+/g,'') || '', rows: rows.slice(0,4), firstRow: rows[0] || '' };
  })()`);
  console.log('3.明细弹窗:', JSON.stringify({ hasEntry, ...modal }));

  // ============ 场景4：空态 ============
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    st.coinLog = []; localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    return 'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(900);
  await ev(`document.querySelector('[data-coin-ledger]').click(); 'ok'`);
  await sleep(500);
  const empty = await ev(`(() => {
    const e = document.querySelector('.cl-empty');
    return { hasEmpty: !!e, text: e ? e.textContent.replace(/\\s+/g,'') : '', rows: document.querySelectorAll('.cl-row').length };
  })()`);
  console.log('4.空态:', JSON.stringify(empty));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
