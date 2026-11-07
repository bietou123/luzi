#!/usr/bin/env node
/** CDP 验证 v4.8.1：审计 bug 修复——脏数据(缺 date)下各页不白屏 + v4.8.0 圆环仍工作 */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[] }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const go = async (h) => { await ev(`location.hash='${h}'; 'ok'`); await sleep(700); };

  // 脏数据：一条无 date 的记录 + 一条正常记录；还有 reviews 缺 execStreakRewards 场景由 defaultState 覆盖
  await seed({ records: [ { id:1, routeId:'d001', title:'脏记录', amount:100, type:'in' }, { id:2, routeId:'d001', title:'正常', amount:50, type:'in', date:'2026-08-09' }, { id:3, routeId:'d002', title:'支出', amount:30, type:'out', date:'2026-07-20' } ] });
  await sleep(1800);

  // 场景1：我的页不崩 + 圆环还在（v4.8.0 回归）
  await go('mine');
  const mine = await ev(`(() => { const money = document.querySelector('.money-summary'); const ring = document.querySelector('.mastery-card .mc-pct'); return { money: !!money, pct: ring ? ring.textContent : null }; })()`);
  console.log('1我的页(脏+圆环):', JSON.stringify(mine));

  // 场景2：收益记录页不崩（月份筛选含脏记录）
  await go('records');
  const recs = await ev(`(() => { const items = document.querySelectorAll('.record-item'); const chips = document.querySelectorAll('.filter-chip'); return { count: items.length, chips: chips.length }; })()`);
  console.log('2收益记录页:', JSON.stringify(recs));

  // 场景2b：点 8 月 chip → sum 出现、脏记录被筛掉只剩 1 条
  await ev(`(() => { const c = document.querySelector('[data-rec-month="2026-08"]'); if (c) c.click(); return 'ok'; })()`);
  await sleep(500);
  const recsAug = await ev(`(() => { const items = document.querySelectorAll('.record-item'); const sum = document.querySelector('.rm-sum'); return { count: items.length, sum: sum ? sum.textContent : null }; })()`);
  console.log('2b 8月筛选:', JSON.stringify(recsAug));

  // 场景3：详情页 renderEarnBlock 有脏记录不崩
  await go('home');
  await sleep(400);
  const det = await ev(`(() => { const el = document.querySelector('[data-open]'); return el ? el.getAttribute('data-open') : null; })()`);
  if (det) {
    await ev(`(() => { document.querySelector('[data-open]').click(); return 'ok'; })()`);
    await sleep(700);
  }
  const detail = await ev(`(() => { const hero = document.querySelector('.detail-hero'); return !!hero; })()`);
  console.log('3详情页:', JSON.stringify({ det, ok: detail }));

  // 场景4：月份 chips 不出现 'undefin'
  await go('records');
  await sleep(400);
  const badchip = await ev(`([...document.querySelectorAll('.filter-chip')].map(c => c.textContent).join('|'))`);
  console.log('4月份chips:', JSON.stringify(badchip));

  const pass = mine && mine.money === true && mine.pct === '2%'
    && recs && recs.count === 3 && recs.chips === 3
    && recsAug && recsAug.count === 1 && recsAug.sum && recsAug.sum.includes('8月') && recsAug.sum.includes('收入')
    && detail === true
    && !badchip.includes('undefin');
  console.log('D:', JSON.stringify({ m: mine && mine.money, p: mine && mine.pct, r1: recs && recs.count, r2: recs && recs.chips, a1: recsAug && recsAug.count, a2: recsAug && recsAug.sum, a3: detail, a4: badchip.includes('undefin') }));
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
