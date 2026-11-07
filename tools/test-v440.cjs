#!/usr/bin/env node
/** CDP 验证 v4.4.0：金币盲盒（50金币开盒 + 金币/称号结果 + 动画 + 不足拦截） */
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
  const coins = async () => await ev(`JSON.parse(localStorage.getItem('luzi_app_v1')).coins`);
  const seed = async (c) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:${c}, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1'], coinLog:[], firstInCelebrated:true, execStreakRewards:[] })); return 'ok'; })()`);
  const goMine = async () => { await ev(`location.hash='mine'; location.reload(); 'ok'`); await sleep(2000); };

  // ===== 场景 1：入口 + 弹窗结构 =====
  await seed(500);
  await goMine();
  const entry = await ev(`(() => { const b = document.querySelector('[data-lucky-box]'); return b ? b.textContent.trim() : 'notfound'; })()`);
  await ev(`document.querySelector('[data-lucky-box]').click(); 'ok'`);
  await sleep(300);
  const sheet = await ev(`(() => { const s = document.querySelector('.modal-sheet.lucky-box'); if (!s) return null; return {
    h3: (s.querySelector('h3')||{}).textContent,
    desc: (s.querySelector('.lb-desc')||{}).textContent,
    bal: (s.querySelector('.lb-balance b')||{}).textContent,
    hasOpen: !!s.querySelector('[data-lucky-open]'),
    cost: (s.querySelector('.lb-cost')||{}).textContent,
    tip: (s.querySelector('.lb-tip')||{}).textContent
  }; })()`);
  console.log('1入口+弹窗:', JSON.stringify({ entry, sheet }));
  await ev(`document.querySelector('.modal-sheet.lucky-box [data-close]').click(); 'ok'`);

  // ===== 场景 2：金币不足拦截 =====
  await seed(30);
  await goMine();
  await ev(`document.querySelector('[data-lucky-box]').click(); 'ok'`);
  await sleep(300);
  await ev(`document.querySelector('[data-lucky-open]').click(); 'ok'`);
  await sleep(400);
  const poor = await ev(`(() => { const s = document.querySelector('.modal-sheet.lucky-box'); return { coins: ${'JSON.parse(localStorage.getItem("luzi_app_v1")).coins'}, stage: s ? s.querySelector('.lb-stage').innerHTML.slice(0,60) : 'null', toast: (document.querySelector('#toast')||{}).textContent||'' }; })()`);
  console.log('2不足拦截:', JSON.stringify(poor));
  await ev(`document.querySelector('.modal-sheet.lucky-box [data-close]').click(); 'ok'`);

  // ===== 场景 3：金币足够 → 开 3 盒（每盒扣50 + 动画 + reveal + 结果）=====
  await seed(500);
  await goMine();
  await ev(`document.querySelector('[data-lucky-box]').click(); 'ok'`);
  await sleep(300);
  const results = [];
  for (let i = 0; i < 3; i++) {
    const before = await coins();
    await ev(`document.querySelector('[data-lucky-open], [data-lucky-again]').click(); 'ok'`);
    await sleep(200);
    const shake = await ev(`!!document.querySelector('.lucky-shake')`);
    const afterDeduct = await coins();
    await sleep(1500);
    const reveal = await ev(`(() => { const s = document.querySelector('.modal-sheet.lucky-box'); const rv = s.querySelector('.lucky-reveal'); if (!rv) return null; return {
      title: (rv.querySelector('.lr-title')||{}).textContent,
      name: (rv.querySelector('.lr-name')||{}).textContent,
      isCoins: !!rv.querySelector('.lr-name.in'),
      hasAgain: !!s.querySelector('[data-lucky-again]')
    }; })()`);
    const afterAll = await coins();
    results.push({ before, afterDeduct, shake, reveal, afterAll });
  }
  const c3 = await coins();
  const log = await ev(`JSON.parse(localStorage.getItem('luzi_app_v1')).coinLog`);
  console.log('3开盒:', JSON.stringify({ results, finalCoins: c3, log }));
  await ev(`document.querySelector('.modal-sheet.lucky-box [data-close]').click(); 'ok'`);

  // ===== 场景 4：称号结果正确性（强制开直到出称号或 10 次）=====
  await seed(500);
  await goMine();
  await ev(`document.querySelector('[data-lucky-box]').click(); 'ok'`);
  await sleep(300);
  let badgeSeen = false, coinsIn = 0;
  for (let i = 0; i < 10; i++) {
    const pre = await coins();
    await ev(`document.querySelector('[data-lucky-open], [data-lucky-again]').click(); 'ok'`);
    await sleep(1700);
    const r = await ev(`(() => { const s = document.querySelector('.modal-sheet.lucky-box'); const rv = s.querySelector('.lucky-reveal'); const isCoins = !!rv.querySelector('.lr-name.in'); const st = JSON.parse(localStorage.getItem('luzi_app_v1')); return { isCoins, badges: Object.keys(st.badges||{}).length, active: st.activeBadge, name: (rv.querySelector('.lr-name')||{}).textContent }; })()`);
    const post = await coins();
    if (r.isCoins) coinsIn++; else badgeSeen = true;
    if (!r.isCoins && i === 0 && pre - post !== 50) { console.log('4fail-称号盒扣50异常', pre, post); }
    if (badgeSeen) break;
  }
  const st4 = await ev(`(() => { const st = JSON.parse(localStorage.getItem('luzi_app_v1')); return { badges: Object.keys(st.badges||{}), active: st.activeBadge, coins: st.coins }; })()`);
  console.log('4称号:', JSON.stringify({ badgeSeen, coinsIn, st4 }));

  const pass = !!entry && entry.includes('金币盲盒')
    && sheet && sheet.h3.includes('金币盲盒') && sheet.desc.includes('50') && sheet.desc.includes('40%')
    && sheet.bal === '500' && sheet.hasOpen && sheet.cost.includes('50') && sheet.tip.includes('金币')
    && poor && poor.coins === 30 && !poor.stage.includes('lucky-shake') && poor.toast.includes('金币不足')
    && results.every(r => r.shake === true && r.reveal && r.reveal.hasAgain && r.afterDeduct === r.before - 50)
    && results.every(r => r.reveal.isCoins ? r.afterAll === r.afterDeduct + parseInt(r.reveal.name) : r.afterAll === r.afterDeduct)
    && log.filter(l => l.amt === -50 && l.note === '金币盲盒').length === 3
    && (badgeSeen ? st4.badges.length === 1 && !!st4.active : true);
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
