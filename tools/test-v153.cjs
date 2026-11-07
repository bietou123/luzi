#!/usr/bin/env node
/** CDP 验证 v1.5.2+v1.5.3：新路子详情 / 成就解锁toast / TOP角标 / 同类推荐 */
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
  await sleep(300);

  // 初始种子：仅 1 次签到 → 解锁 1 个成就（迈出第一步）
  await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const t = new Date();
    h.checkin = {}; h.checks = {};
    const d1 = new Date(t); d1.setDate(d1.getDate()-1);
    h.checkin[d1.toISOString().slice(0,10)] = 1;
    h.liked = {}; h.records = []; h.routeVotes = {};
    delete h.prevAchUnlocked; // 重置，交给升级校准逻辑
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    'ok';
  })()`);
  await ev(`location.hash = ''; 'ok'`); // 确保 reload 后落在首页
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 老用户升级静默校准：prevAchUnlocked 应为 1（不应触发 toast）
  const cal = await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); return { prev: h.prevAchUnlocked, toast: !!document.querySelector('.toast') }; })()`);
  console.log('升级校准:', JSON.stringify(cal));

  // 2) 首页热门 TOP 角标
  await ev(`location.hash = 'home'; 'ok'`);
  await sleep(800);
  const home = await ev(`(() => {
    const cards = [...document.querySelectorAll('.route-card')].slice(0,5);
    return cards.map(c => {
      const rk = c.querySelector('.rc-rank');
      return { title: c.querySelector('.rc-title')?.textContent, rank: rk ? rk.textContent : null, top: rk ? rk.classList.contains('top') : false };
    });
  })()`);
  console.log('热门TOP角标:', JSON.stringify(home));

  // 3) 新路子 f010 详情渲染
  await ev(`location.hash = 'route/f010'; 'ok'`);
  await sleep(600);
  const det = await ev(`(() => {
    const t = document.querySelector('.detail-title');
    const rel = [...document.querySelectorAll('.rel-item')];
    return {
      title: t?.textContent,
      steps: document.querySelectorAll('.step-item').length,
      pitfalls: document.querySelectorAll('.pitfall-item').length,
      related: rel.map(x => x.querySelector('.rel-title')?.textContent),
      relatedClickable: rel.every(x => x.getAttribute('data-open')),
    };
  })()`);
  console.log('f010详情+同类推荐:', JSON.stringify(det));

  // 4) 点同类推荐第一条 → 应跳到另一条详情
  const relFirst = await ev(`(() => { const e=document.querySelector('.rel-item'); return e ? e.getAttribute('data-open') : null; })()`);
  if (relFirst) {
    await ev(`document.querySelector('.rel-item').click(); 'ok'`);
    await sleep(600);
    const det2 = await ev(`document.querySelector('.detail-title')?.textContent || ''`);
    console.log('点推荐跳转:', JSON.stringify({ from: 'f010', to: det2 }));
  } else { console.log('点推荐跳转: 无推荐条目'); }

  // 5) 成就解锁 toast：新增收入记录 → 解锁「第一桶金」「千元小目标」→ 去「我的」应弹 toast
  await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    const t = new Date();
    const ds = (off) => { const d = new Date(t); d.setDate(d.getDate()-off); return d.toISOString().slice(0,10); };
    h.records = [
      { id:'r1', routeId:'f010', title:'逆回购', amount:600, type:'in', note:'', date:ds(2) },
      { id:'r2', routeId:'d001', title:'接单', amount:900, type:'in', note:'', date:ds(1) },
    ];
    localStorage.setItem('luzi_app_v1', JSON.stringify(h));
    'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  await ev(`location.hash = 'mine'; 'ok'`);
  await sleep(1500);
  const ach = await ev(`(() => {
    const toastEl = document.querySelector('#toast');
    const toastShown = toastEl ? toastEl.classList.contains('show') : false;
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    const unlocked = document.querySelector('.as-count')?.textContent || '';
    return { toastText: toastShown ? toastEl.textContent : null, prev: h.prevAchUnlocked, asCount: unlocked };
  })()`);
  console.log('成就解锁toast:', JSON.stringify(ach));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
