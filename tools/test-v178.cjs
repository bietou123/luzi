#!/usr/bin/env node
/** CDP 验证 v1.7.8：打卡日历点日期查看当天详情 */
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
  const today = new Date();
  const tst = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
  const yest = new Date(today.getTime() - 86400000);
  const yst = yest.getFullYear() + '-' + String(yest.getMonth()+1).padStart(2,'0') + '-' + String(yest.getDate()).padStart(2,'0');
  // 种子：今天签到 + 打卡 f001 3项完成 + 收入100；昨天签到 + 收入80
  await ev(`(() => {
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({
      checkin: { '${tst}': 1, '${yst}': 1 }, coins: 0,
      checks: { 'f001::${tst}': { 0:true, 1:true, 2:true, 3:false } },
      records: [
        { id:'r1', routeId:'f001', title:'可转债打新', amount:100, type:'in', note:'中签', date:'${tst}' },
        { id:'r2', routeId:'f001', title:'可转债打新', amount:80, type:'in', note:'卖出', date:'${yst}' }
      ]
    })); return 'ok';
  })()`);
  await ev(`location.hash='track'; location.reload(); 'ok'`);
  await sleep(2500);

  // 今天的 cell
  const todayCell = await ev(`(() => {
    const c = document.querySelector('[data-cal-day="${tst}"]');
    return c ? { has: true, cls: c.className } : { has: false };
  })()`);
  console.log('①今日cell:', JSON.stringify(todayCell));

  // 点今天 → 弹窗
  await ev(`document.querySelector('[data-cal-day="${tst}"]').click(); 'ok'`);
  await sleep(300);
  const todaySheet = await ev(`(() => {
    const s = document.querySelector('.day-sheet');
    return {
      has: !!s,
      title: (document.querySelector('.dd-title')||{}).textContent ? document.querySelector('.dd-title').textContent.trim() : '',
      rows: [...document.querySelectorAll('.dd-row')].map(r => r.textContent.trim())
    };
  })()`);
  console.log('②今日弹窗:', JSON.stringify(todaySheet));
  await ev(`document.querySelector('[data-close]').click(); 'ok'`);
  await sleep(250);

  // 点昨天（有数据）
  await ev(`document.querySelector('[data-cal-day="${yst}"]').click(); 'ok'`);
  await sleep(300);
  const yestSheet = await ev(`(() => ({
    title: (document.querySelector('.dd-title')||{}).textContent ? document.querySelector('.dd-title').textContent.trim() : '',
    rows: [...document.querySelectorAll('.dd-row')].map(r => r.textContent.trim())
  }))()`);
  console.log('③昨日弹窗:', JSON.stringify(yestSheet));
  await ev(`document.querySelector('[data-close]').click(); 'ok'`);
  await sleep(250);

  // 点一个无数据的日子（前天）
  const pre = new Date(today.getTime() - 2*86400000);
  const pst = pre.getFullYear() + '-' + String(pre.getMonth()+1).padStart(2,'0') + '-' + String(pre.getDate()).padStart(2,'0');
  const hasPre = await ev(`!!document.querySelector('[data-cal-day="${pst}"]')`);
  if (hasPre) {
    await ev(`document.querySelector('[data-cal-day="${pst}"]').click(); 'ok'`);
    await sleep(300);
  }
  const preSheet = await ev(`(() => ({
    has: !!document.querySelector('.day-sheet'),
    rows: document.querySelector('.day-sheet') ? [...document.querySelectorAll('.dd-row')].map(r => r.textContent.trim()) : []
  }))()`);
  console.log('④无数据日:', JSON.stringify({ hasPre, ...preSheet }));

  // 未来日期无 data-cal-day
  const futureCells = await ev(`(() => {
    const all = [...document.querySelectorAll('.cal-cell')];
    const withAttr = all.filter(c => c.hasAttribute('data-cal-day'));
    const future = all.filter(c => c.classList.contains('future'));
    return { withAttr: withAttr.length, future: future.length, futureHasAttr: future.filter(c => c.hasAttribute('data-cal-day')).length };
  })()`);
  console.log('⑤未来cell:', JSON.stringify(futureCells));

  const pass = todayCell.has && todayCell.cls.includes('today') && todaySheet.has && todaySheet.title.includes(today.getDate() + ' 日') && todaySheet.rows.some(r => r.includes('已签')) && todaySheet.rows.some(r => r.includes('¥100')) && todaySheet.rows.some(r => r.includes('3/7')) && yestSheet.title.includes(yest.getDate() + ' 日') && yestSheet.rows.some(r => r.includes('¥80')) && preSheet.has && preSheet.rows.some(r => r.includes('未签')) && futureCells.futureHasAttr === 0;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
