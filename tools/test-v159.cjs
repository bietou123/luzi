#!/usr/bin/env node
/** CDP 验证 v1.5.9：记账类型切换(收入/支出) + 编辑已有记录 */
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

  // 种子：两条记录（一条收入带备注、一条支出）
  await ev(`localStorage.setItem('luzi_seen_onboard','1'); 'ok'`);
  await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    h.records = [
      { id:'rec1', routeId:'d001', title:'接单', amount:300, type:'in', note:'PPT代做', date:'2026-08-09' },
      { id:'rec2', routeId:'f010', title:'逆回购', amount:100, type:'out', note:'', date:'2026-08-10' },
    ];
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    'ok';
  })()`);
  await ev(`location.hash = ''; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 记一笔：打开弹窗，检查类型切换存在、默认收入，切到支出保存
  await ev(`location.hash = 'records'; 'ok'`);
  await sleep(700);
  await ev(`document.querySelector('[data-addmoney]').click(); 'ok'`);
  await sleep(500);
  const sheet1 = await ev(`(() => ({
    title: document.querySelector('.modal-sheet h3')?.textContent,
    hasType: !!document.querySelector('[data-mtype="in"]'),
    defaultType: document.querySelector('[data-mtype].on')?.dataset.mtype || null,
  }))()`);
  console.log('新增弹窗:', JSON.stringify(sheet1));
  await ev(`document.querySelector('[data-mtype="out"]').click(); 'ok'`);
  await sleep(200);
  await ev(`document.querySelector('#money-amount').value = '88'; document.querySelector('#money-note').value = '买工具'; document.querySelector('[data-save]').click(); 'ok'`);
  await sleep(800);
  const afterAdd = await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    const top = h.records[0];
    return { count: h.records.length, top: { title:top.title, amount:top.amount, type:top.type, note:top.note } };
  })()`);
  console.log('新增支出后:', JSON.stringify(afterAdd));

  // 2) 点记录项 → 编辑弹窗预填 → 改金额/类型 → 保存
  await ev(`document.querySelector('.record-item[data-edit="rec1"]').click(); 'ok'`);
  await sleep(500);
  const sheet2 = await ev(`(() => ({
    title: document.querySelector('.modal-sheet h3')?.textContent,
    type: document.querySelector('[data-mtype].on')?.dataset.mtype,
    amount: document.querySelector('#money-amount').value,
    note: document.querySelector('#money-note').value,
    selRoute: document.querySelector('#money-route').value,
  }))()`);
  console.log('编辑弹窗(rec1 预填):', JSON.stringify(sheet2));
  await ev(`document.querySelector('#money-amount').value = '500'; document.querySelector('#money-note').value = '两单'; document.querySelector('[data-save]').click(); 'ok'`);
  await sleep(800);
  const afterEdit = await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    const rec = h.records.find(r => r.id === 'rec1');
    return { count: h.records.length, rec: { amount:rec.amount, note:rec.note, date:rec.date } };
  })()`);
  console.log('编辑后(rec1):', JSON.stringify(afterEdit));

  // 3) 页面汇总应随支出变化
  const summary = await ev(`document.querySelector('.money-summary .total')?.textContent`);
  console.log('汇总显示:', summary);

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
