#!/usr/bin/env node
/** CDP 验证 v2.0.0：金币商城（称号系统）——v2 修正版 */
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

  // ①种子：coins 1000，无称号（load 后 t1 自动 +20 → 1020）
  await ev(`(() => { localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:1000, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', coinLog:[] })); return 'ok'; })()`);
  await ev(`location.hash='mine'; location.reload(); 'ok'`);
  await sleep(2200);

  // ②入口
  const entry = await ev(`(() => ({ shopBtn: !!document.querySelector('[data-coin-shop]'), ledgerBtn: !!document.querySelector('[data-coin-ledger]'), badgeNone: !(document.querySelector('.mh-badge')||{}).textContent }))()`);
  console.log('①入口:', JSON.stringify(entry));

  // ③开商城：6 项，1000金币时 5 可买 1 poor
  await click('[data-coin-shop]');
  await sleep(400);
  const shop = await ev(`(() => ({
    modal: !!document.querySelector('.coin-shop'),
    items: document.querySelectorAll('.shop-item').length,
    names: [...document.querySelectorAll('.shop-name')].map(n => n.textContent),
    poor: document.querySelectorAll('.shop-item.poor').length,
    buyBtns: document.querySelectorAll('[data-badge-buy]').length
  }))()`);
  console.log('②商城:', JSON.stringify(shop));

  // ④买「搞钱新手」100 → 扣款+记录+徽标
  await click('.shop-item[data-badge-buy="搞钱新手"]');
  await sleep(600);
  const bought = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    const badge = (document.querySelector('.mh-badge')||{}).textContent || '';
    const minus = st.coinLog.filter(l => l.amt < 0);
    return { coins: st.coins, badge, modalGone: !document.querySelector('.coin-shop'), active: st.activeBadge, minus };
  })()`);
  console.log('③买新手:', JSON.stringify(bought));

  // ⑤再买「路子学徒」200 → 购买即激活
  await click('[data-coin-shop]');
  await sleep(400);
  await click('.shop-item[data-badge-buy="路子学徒"]');
  await sleep(600);
  const bought2 = await ev(`(() => { const st = JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins: st.coins, active: st.activeBadge, badge: (document.querySelector('.mh-badge')||{}).textContent || '' }; })()`);
  console.log('④买学徒:', JSON.stringify(bought2));

  // ⑥切回「搞钱新手」（已拥有免费切换）
  await click('[data-coin-shop]');
  await sleep(400);
  await click('.shop-item[data-badge-activate="搞钱新手"]');
  await sleep(500);
  const switched = await ev(`(() => { const st = JSON.parse(localStorage.getItem('luzi_app_v1')); return { active: st.activeBadge, coins: st.coins, badge: (document.querySelector('.mh-badge')||{}).textContent || '' }; })()`);
  console.log('⑤切回新手:', JSON.stringify(switched));

  // ⑦金币明细含 -100 与 -200 兑换
  await click('[data-coin-ledger]');
  await sleep(400);
  const log = await ev(`(() => {
    const amts = [...document.querySelectorAll('.cl-amt')].map(a => a.textContent.trim());
    const notes = [...document.querySelectorAll('.cl-note')].map(n => n.textContent);
    return { hasMinus100: amts.includes('-100') && notes.some(n => n.includes('搞钱新手')), hasMinus200: amts.includes('-200') && notes.some(n => n.includes('路子学徒')), rows: amts.length };
  })()`);
  await click('.coin-ledger [data-close]');
  await sleep(300);
  console.log('⑥金币明细:', JSON.stringify(log));

  // ⑧金币不足：coins=0 全 poor 不可买
  await ev(`(() => { const st = JSON.parse(localStorage.getItem('luzi_app_v1')); st.coins = 0; localStorage.setItem('luzi_app_v1', JSON.stringify(st)); return 'ok'; })()`);
  await ev(`location.hash='mine'; location.reload(); 'ok'`);
  await sleep(2000);
  await click('[data-coin-shop]');
  await sleep(400);
  const poor = await ev(`(() => ({ poor: document.querySelectorAll('.shop-item.poor').length, buyBtns: document.querySelectorAll('[data-badge-buy]').length, total: document.querySelectorAll('.shop-item').length }))()`);
  console.log('⑦金币不足:', JSON.stringify(poor));

  const pass = entry.shopBtn && entry.ledgerBtn && entry.badgeNone
    && shop.modal && shop.items === 6 && shop.poor === 1 && shop.buyBtns === 5
    && bought.badge.includes('搞钱新手') && bought.modalGone && bought.active === '搞钱新手'
    && bought.minus.length === 1 && bought.minus[0].amt === -100
    && bought2.coins === 720 && bought2.active === '路子学徒' && bought2.badge.includes('路子学徒')
    && switched.active === '搞钱新手' && switched.coins === 720 && switched.badge.includes('搞钱新手')
    && log.hasMinus100 && log.hasMinus200 && log.rows >= 3
    && poor.poor === 4 && poor.buyBtns === 0 && poor.total === 6;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
