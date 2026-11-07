#!/usr/bin/env node
/** CDP 验证 v1.6.2：本月小结卡片 */
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

  // 种子：本月收入1500+支出200、签到3天、打卡完成若干（本月 + 上月各一笔，只算本月）
  const seed = await ev(`(() => {
    const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,'0');
    localStorage.setItem('luzi_seen_onboard','1');
    const h = {
      checkin: { [y+'-'+m+'-01']: 1, [y+'-'+m+'-02']: 1, [y+'-'+m+'-03']: 1 },
      records: [
        { id:'a', routeId:'', title:'卖东西', amount:1000, type:'in', note:'', date:y+'-'+m+'-05' },
        { id:'b', routeId:'', title:'接单', amount:500, type:'in', note:'', date:y+'-'+m+'-06' },
        { id:'c', routeId:'', title:'工具', amount:200, type:'out', note:'', date:y+'-'+m+'-07' },
        { id:'d', routeId:'', title:'上月', amount:999, type:'in', note:'', date:y+'-'+String(now.getMonth()).padStart(2,'0')+'-20' },
      ],
      liked: {}, progress: {}, routeVotes: {}, coins: 0, achShown: [], monthGoal: 1000, goalCelebratedMonth: '', checks: {},
    };
    h.checks['f010::'+y+'-'+m+'-05'] = { 0: true, 1: true };
    h.checks['f010::'+y+'-'+m+'-06'] = { 0: true };
    h.checks['f010::'+(now.getMonth()===0 ? (y-1)+'-12-20' : y+'-'+String(now.getMonth()).padStart(2,'0')+'-20')] = { 0: true };
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    return y+'-'+m;
  })()`);
  console.log('本月:', seed);

  await ev(`location.hash = ''; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 进 mine 页，检查小结卡片
  await ev(`location.hash = 'mine'; 'ok'`);
  await sleep(700);
  const ms = await ev(`(() => {
    const card = document.querySelector('.month-summary');
    if (!card) return null;
    const nums = [...card.querySelectorAll('.ms-num')].map(n => n.textContent);
    const lb = [...card.querySelectorAll('.ms-lb')].map(n => n.textContent);
    const comment = card.querySelector('.ms-comment')?.textContent;
    return { nums, lb, comment };
  })()`);
  console.log('本月小结:', JSON.stringify(ms));

  // 2) 边界：无数据时评语
  await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    h.records = []; h.checkin = {}; h.checks = {};
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash = 'mine'; 'ok'`);
  await sleep(600);
  const emptyComment = await ev(`document.querySelector('.ms-comment')?.textContent`);
  console.log('无数据评语:', emptyComment);

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
