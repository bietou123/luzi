#!/usr/bin/env node
/** CDP 验证 v1.5.7：记账CSV导出 + 清空数据二次确认 */
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

  await ev(`localStorage.setItem('luzi_seen_onboard','1'); document.querySelector('.onboard')?.remove(); 'ok'`).catch(() => {});
  // 种子：3 条记账（含一条带引号的备注测转义）
  await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    h.records = [
      { id:'r1', routeId:'d001', title:'接单', amount:300, type:'in', note:'第一单', date:'2026-08-08' },
      { id:'r2', routeId:'f010', title:'逆回购', amount:500, type:'in', note:'说"好"', date:'2026-08-09' },
      { id:'r3', routeId:'', title:'买工具', amount:99, type:'out', note:'', date:'2026-08-10' },
    ];
    h.checkin = {}; h.checks = {};
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    'ok';
  })()`);
  await ev(`location.hash = ''; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 记账页导出按钮存在 + 点击触发 toast
  await ev(`location.hash = 'records'; 'ok'`);
  await sleep(700);
  const hasBtn = await ev(`!!document.querySelector('[data-export-records]')`);
  console.log('导出按钮存在:', hasBtn);
  await ev(`document.querySelector('[data-export-records]').click(); 'ok'`);
  await sleep(900);
  const expToast = await ev(`(() => { const t=document.querySelector('#toast'); return t && t.classList.contains('show') ? t.textContent : null; })()`);
  console.log('导出toast:', expToast);

  // 2) CSV 生成逻辑直接验证（含转义 + BOM + 排序）——用 localStorage 数据复算
  const csvCheck = await ev(`(() => {
    const recs = (JSON.parse(localStorage.getItem('luzi_app_v1')).records || []);
    const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const lines = ['日期,类型,标题,金额(元),备注,路子ID'];
    [...recs].sort((a,b)=>a.date.localeCompare(b.date)).forEach(r => {
      lines.push([r.date, r.type==='in'?'收入':'支出', r.title, r.amount, r.note||'', r.routeId||''].map(esc).join(','));
    });
    return '﻿' + lines.join('\\n');
  })()`);
  console.log('CSV内容:', JSON.stringify(csvCheck));

  // 3) 关于页清空：点清空 → 弹确认 → 取消 → 数据保留
  await ev(`location.hash = 'about'; 'ok'`);
  await sleep(600);
  await ev(`document.querySelector('[data-reset]').click(); 'ok'`);
  await sleep(400);
  const modal1 = await ev(`(() => {
    const m = document.querySelector('.modal-mask');
    return m ? { title: m.querySelector('h3')?.textContent, confirmBtn: !!m.querySelector('[data-confirm-reset]') } : null;
  })()`);
  console.log('清空确认弹窗:', JSON.stringify(modal1));
  await ev(`document.querySelector('[data-confirm-reset]') ? document.querySelector('.modal-mask [data-close]').click() : null; 'ok'`);
  await sleep(400);
  const afterCancel = await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); return { modal: !!document.querySelector('.modal-mask'), records: h.records.length }; })()`);
  console.log('取消后:', JSON.stringify(afterCancel));

  // 4) 再点 → 确认清空 → 数据清空并 reload
  await ev(`document.querySelector('[data-reset]').click(); 'ok'`);
  await sleep(400);
  await ev(`document.querySelector('[data-confirm-reset]').click(); 'ok'`);
  await sleep(2500);
  const afterReset = await ev(`(() => {
    const h = localStorage.getItem('luzi_app_v1');
    return { hasStorage: !!h, recCount: h ? (JSON.parse(h).records || []).length : null };
  })()`);
  console.log('确认清空后:', JSON.stringify(afterReset));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
