#!/usr/bin/env node
/** CDP 验证 v1.6.1：数据备份/恢复 + 版本号 */
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

  // 种子：可备份的数据
  const seedJson = await ev(`(() => {
    localStorage.setItem('luzi_seen_onboard','1');
    const h = {
      checkin: { '2026-08-09': 1 }, streak: 1, lastCheckin: '2026-08-09',
      checks: { 'f010::2026-08-10': { 0: true } },
      records: [ { id:'r1', routeId:'d001', title:'接单', amount:300, type:'in', note:'第一单', date:'2026-08-08' } ],
      liked: { d001: true }, progress: {}, routeVotes: {}, coins: 55,
      monthGoal: 1000, goalCelebratedMonth: '', achShown: [], remoteUrl: '', remoteUpdatedAt: null,
    };
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    return JSON.stringify(h);
  })()`);
  console.log('种子已写入，长度:', seedJson.length);

  // 1) 关于页入口存在
  await ev(`location.hash = 'about'; 'ok'`);
  await sleep(600);
  const entries = await ev(`(() => ({
    backup: !!document.querySelector('[data-backup]'),
    restore: !!document.querySelector('[data-restore]'),
    version: (document.querySelector('.card .line-height') ? '' : '') + (document.body.innerText.match(/版本 v[\d.]+/) || [''])[0],
  }))()`);
  console.log('关于页入口:', JSON.stringify(entries));

  // 2) 备份按钮：toast（剪贴板可能受限，但验证点击触发）
  await ev(`document.querySelector('[data-backup]').click(); 'ok'`);
  await sleep(600);
  const backupToast = await ev(`(() => { const t=document.querySelector('#toast'); return t && t.classList.contains('show') ? t.textContent : null; })()`);
  console.log('备份toast:', backupToast);

  // 3) 恢复：先篡改 localStorage（加一条记录）→ 恢复成 seedJson → reload 后应为 seed 状态
  await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    h.records.push({ id:'rX', routeId:'', title:'脏数据', amount:999, type:'in', note:'', date:'2026-08-10' });
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    return h.records.length;
  })()`);
  const dirtyCount = await ev(`JSON.parse(localStorage.getItem('luzi_app_v1')).records.length`);
  console.log('篡改后记录数:', dirtyCount);

  // 打开恢复弹窗，填非法 JSON
  await ev(`document.querySelector('[data-restore]').click(); 'ok'`);
  await sleep(400);
  await ev(`document.querySelector('#restore-text').value = 'not json'; document.querySelector('[data-restore-confirm]').click(); 'ok'`);
  await sleep(400);
  const badToast = await ev(`(() => { const t=document.querySelector('#toast'); return t && t.classList.contains('show') ? t.textContent : null; })()`);
  console.log('非法JSON toast:', badToast);

  // 填非路子结构
  await ev(`document.querySelector('#restore-text').value = '{"foo":1}'; document.querySelector('[data-restore-confirm]').click(); 'ok'`);
  await sleep(400);
  const wrongToast = await ev(`(() => { const t=document.querySelector('#toast'); return t && t.classList.contains('show') ? t.textContent : null; })()`);
  console.log('非路子数据 toast:', wrongToast);

  // 填合法备份 → 恢复
  await ev(`document.querySelector('#restore-text').value = ${JSON.stringify(JSON.stringify(JSON.parse(seedJson)))}; document.querySelector('[data-restore-confirm]').click(); 'ok'`);
  await sleep(2200); // 等待 reload
  const restored = await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { records: h.records.length, hasDirty: h.records.some(r => r.id === 'rX'), coins: h.coins };
  })()`);
  console.log('恢复后:', JSON.stringify(restored));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
