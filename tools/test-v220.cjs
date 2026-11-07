#!/usr/bin/env node
/** CDP 验证 v2.2.0：打卡日历整合执行复盘 */
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
  const click = async (sel) => { const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'notfound'; el.click(); return 'ok'; })()`); return r; };

  // 种子：今天 done / 昨天 partial / 前天 miss + 签到 3 天
  const dates = await ev(`(() => {
    function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
    var now = new Date();
    var today = fmt(now);
    var yest = fmt(new Date(now.getTime()-86400000));
    var dayB4 = fmt(new Date(now.getTime()-2*86400000));
    var checkin = {}; checkin[dayB4]=1; checkin[yest]=1; checkin[today]=1;
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin: checkin, coins:0, liked:{}, checks:{}, records:[], reviews: (function(o){o[today]='done';o[yest]='partial';o[dayB4]='miss';return o;})({}), badges:{}, activeBadge:'' }));
    return { today, yest, dayB4 };
  })()`);
  await ev(`location.hash='track'; location.reload(); 'ok'`);
  await sleep(2200);

  const cellExpr = `(() => {
    function info(ds){ const el = document.querySelector('.cal-cell[data-cal-day="'+ds+'"]'); if(!el) return null; return { cls: el.className, rv: (el.querySelector('.c-rv')||{}).className||'', title: el.title }; }
    return { today: info(${JSON.stringify(dates.today)}), yest: info(${JSON.stringify(dates.yest)}), b4: info(${JSON.stringify(dates.dayB4)}), stats: (document.querySelector('.cal-stats')||{}).textContent || '' };
  })()`;
  const cells = await ev(cellExpr);
  console.log('①日历标记:', JSON.stringify(cells));

  // 点昨天 cell → 弹窗含执行复盘 partial
  await click(`.cal-cell[data-cal-day="${dates.yest}"]`);
  await sleep(400);
  const detailYest = await ev(`(() => {
    const rows = [...document.querySelectorAll('.day-sheet .dd-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim());
    return { rows };
  })()`);
  await click('.day-sheet [data-close]');
  await sleep(300);
  console.log('②昨天弹窗:', JSON.stringify(detailYest));

  // 点今天 cell → 弹窗含执行复盘 done
  await click(`.cal-cell[data-cal-day="${dates.today}"]`);
  await sleep(400);
  const detailToday = await ev(`(() => {
    const rows = [...document.querySelectorAll('.day-sheet .dd-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim());
    return { rows };
  })()`);
  await click('.day-sheet [data-close]');
  await sleep(300);
  console.log('③今天弹窗:', JSON.stringify(detailToday));

  const pass = cells.today && cells.today.cls.includes('rv-done') && cells.today.rv.includes('done') && cells.today.title.includes('做了')
    && cells.yest && cells.yest.cls.includes('rv-partial') && cells.yest.rv.includes('partial') && cells.yest.title.includes('做了一半')
    && cells.b4 && cells.b4.cls.includes('rv-miss') && cells.b4.rv.includes('miss') && cells.b4.title.includes('没做')
    && cells.stats.includes('执行')
    && detailYest.rows.some(r => r.includes('执行复盘') && r.includes('做了一半'))
    && detailToday.rows.some(r => r.includes('执行复盘') && r.includes('做了'));
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
