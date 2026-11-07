#!/usr/bin/env node
/** CDP 验证 v4.13.0：金币盲盒保底（每 5 次必出称号 + 保底进度条） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:500, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', luckyCount:0 }, ${JSON.stringify(extra||{})}))); location.hash='mine'; location.reload(); return 'ok'; })()`);
  const openBox = async () => { await ev(`document.querySelector('[data-lucky-box]').click()`); await sleep(400); return ev(`(() => { const b = document.querySelector('.lucky-box'); if (!b) return null; return { txt: b.querySelector('.lb-pity-txt').textContent.replace(/\\s+/g,' ').trim(), on: b.querySelectorAll('.lp-cell.on').length, cells: b.querySelectorAll('.lp-cell').length, desc: b.querySelector('.lb-desc').textContent.replace(/\\s+/g,' ').trim() }; })()`); };
  const openOnce = async () => { await ev(`document.querySelector('[data-lucky-open]').click()`); await sleep(1800); return ev(`(() => { const r = document.querySelector('.lucky-reveal'); if (!r) return null; const st = JSON.parse(localStorage.getItem('luzi_app_v1')); return { title: r.querySelector('.lr-title') ? r.querySelector('.lr-title').textContent : null, ico: r.querySelector('.lr-ico') ? r.querySelector('.lr-ico').textContent : null, luckyCount: st.luckyCount, badges: Object.keys(st.badges||{}).length, pityTxt: document.querySelector('.lb-pity-txt') ? document.querySelector('.lb-pity-txt').textContent.replace(/\\s+/g,' ').trim() : null, pityOn: document.querySelectorAll('.lp-cell.on').length }; })()`); };

  // 场景 1：干净 seed → 保底进度 0/5「再开 5 次必出」
  await seed({});
  await sleep(2000);
  const p1 = await openBox();
  console.log('1空态保底:', JSON.stringify(p1));

  // 场景 2：luckyCount=4 → 再开 1 次必出 → 开盒保底出称号
  await seed({ luckyCount: 4 });
  await sleep(2000);
  const p2 = await openBox();
  console.log('2进度4:', JSON.stringify(p2));
  const r2 = await openOnce();
  console.log('2开盒保底:', JSON.stringify(r2));

  // 场景 3：luckyCount=5（刚保底）→ 满格 + 再开 5 次
  await seed({ luckyCount: 5 });
  await sleep(2000);
  const p3 = await openBox();
  console.log('3刚保底:', JSON.stringify(p3));

  // 场景 4：全称号 + luckyCount=4 → 保底但无未拥有称号 → 金币兜底不崩
  await seed({ luckyCount: 4, badges: { '搞钱新手':true, '路子学徒':true, '行动达人':true, '日进斗金':true, '搞钱老司机':true, '路子收藏家':true } });
  await sleep(2000);
  const p4 = await openBox();
  console.log('4进度4全称号:', JSON.stringify(p4));
  const r4 = await openOnce();
  console.log('4开盒金币兜底:', JSON.stringify(r4));

  const pass = p1 && p1.txt.includes('已开 0 次') && p1.txt.includes('再开 5 次必出') && p1.on === 0 && p1.cells === 5
    && p2 && p2.txt.includes('已开 4 次') && p2.txt.includes('再开 1 次必出') && p2.on === 4
    && r2 && r2.title && r2.title.includes('保底必出') && r2.luckyCount === 5 && r2.badges === 1 && r2.pityTxt.includes('再开 5 次') && r2.pityOn === 5
    && p3 && p3.txt.includes('已开 5 次') && p3.txt.includes('再开 5 次必出') && p3.on === 5
    && p4 && p4.txt.includes('再开 1 次必出') && p4.on === 4
    && r4 && r4.ico === '🪙' && r4.luckyCount === 5 && r4.badges === 6;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
