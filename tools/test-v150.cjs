#!/usr/bin/env node
/** CDP 验证 v1.5.0：打卡日历 + 收入趋势图 */
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

  // 跳过引导
  await ev(`localStorage.setItem('luzi_seen_onboard','1'); document.querySelector('.onboard')?.remove(); 'ok'`).catch(() => {});
  await sleep(300);

  // 写入模拟数据：近几天签到+打卡+收入
  await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const t = new Date();
    const ds = (off) => { const d = new Date(t); d.setDate(d.getDate()-off); return d.toISOString().slice(0,10); };
    h.checkin = { [ds(0)]:1, [ds(1)]:1, [ds(2)]:1 };
    h.checks = { ['d001::'+ds(0)]:{0:true,1:true,2:true}, ['d001::'+ds(1)]:{0:true}, ['d002::'+ds(2)]:{0:true,1:true} };
    h.records = [
      { id:'r1', routeId:'d001', title:'测试', amount:50, type:'in', note:'接单', date:ds(0) },
      { id:'r2', routeId:'d002', title:'测试', amount:120, type:'in', note:'出单', date:ds(1) },
      { id:'r3', routeId:'d003', title:'测试', amount:30, type:'in', note:'佣金', date:ds(2) },
      { id:'r4', routeId:'d004', title:'测试', amount:80, type:'out', note:'成本', date:ds(1) },
    ];
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  await ev(`location.hash = 'track'; 'ok'`);
  await sleep(600);

  const cal = await ev(`(() => {
    const c = document.querySelector('.cal-card');
    if (!c) return null;
    const cells = [...c.querySelectorAll('.cal-cell')];
    return {
      title: c.querySelector('.cal-title')?.textContent,
      cellCount: cells.length,
      doneCount: cells.filter(x => x.classList.contains('done')).length,
      signCount: cells.filter(x => x.classList.contains('sign')).length,
      todayMarked: cells.filter(x => x.classList.contains('today')).length,
      stats: c.querySelector('.cal-stats')?.textContent || '',
      grid: (() => { const g = c.querySelector('.cal-grid'); return { wd: g.querySelectorAll('.cal-wd').length }; })(),
    };
  })()`);
  console.log('打卡日历:', JSON.stringify(cal));

  // 翻到上个月再翻回来
  await ev(`document.querySelector('[data-cal-prev]').click(); 'ok'`);
  await sleep(400);
  const prevTitle = await ev(`document.querySelector('.cal-title')?.textContent || ''`);
  await ev(`document.querySelector('[data-cal-next]').click(); 'ok'`);
  await sleep(400);
  const backTitle = await ev(`document.querySelector('.cal-title')?.textContent || ''`);
  console.log('翻月测试: prev=', prevTitle, 'back=', backTitle);

  // 记账页图表
  await ev(`location.hash = 'records'; 'ok'`);
  await sleep(600);
  const chart = await ev(`(() => {
    const ch = document.querySelector('.chart-card');
    if (!ch) return null;
    const cols = ch.querySelectorAll('.chart-col');
    const fills = [...cols].filter(c => (c.querySelector('.chart-val')?.textContent||'').trim() !== '');
    return {
      title: ch.querySelector('.ch-title')?.textContent,
      rangeOpts: [...ch.querySelectorAll('.ch-opt')].map(o => o.textContent + (o.classList.contains('on')?'*':'')),
      colCount: cols.length,
      activeBars: fills.length,
      foot: ch.querySelector('.chart-foot')?.textContent || '',
    };
  })()`);
  console.log('收入图表:', JSON.stringify(chart));

  // 切 30 天
  await ev(`document.querySelector('[data-chart="30"]').click(); 'ok'`);
  await sleep(500);
  const chart30 = await ev(`(() => { const c=document.querySelector('.chart-card'); return { on: c.querySelector('.ch-opt.on')?.textContent, cols: c.querySelectorAll('.chart-col').length, foot: c.querySelector('.chart-foot')?.textContent }; })()`);
  console.log('30天图表:', JSON.stringify(chart30));

  // 连续天数
  const streak = await ev(`(() => {
    const s = document.querySelector('.cal-stats');
    return s ? s.textContent : '';
  })()`);
  console.log('日历统计:', JSON.stringify(streak));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
