#!/usr/bin/env node
/** CDP 验证 v4.18.0：金币明细弹窗加金币来源分析（按 note 归类 + 占比条） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'' }, ${JSON.stringify(extra||{})}))); location.hash='mine'; location.reload(); return 'ok'; })()`);
  const openLedger = async () => { await ev(`document.querySelector('[data-coin-ledger]').click()`); await sleep(400); return ev(`(() => { const b = document.querySelector('.coin-ledger'); if (!b) return null; const srcs = Array.from(b.querySelectorAll('.cl-s-row')).map(r => ({ name: r.querySelector('.cl-s-name').textContent, amt: r.querySelector('.cl-s-amt').textContent, fill: r.querySelector('.cl-s-fill').style.width })); return { hasSrc: !!b.querySelector('.cl-sources'), title: b.querySelector('.cl-s-title') ? b.querySelector('.cl-s-title').textContent.replace(/\\s+/g,' ').trim() : null, empty: b.querySelector('.cl-empty') ? b.querySelector('.cl-empty').textContent.replace(/\\s+/g,' ').trim() : null, srcs, rows: b.querySelectorAll('.cl-row').length }; })()`); };

  // 场景 1：coinLog 空 → 无 sources，显示空态
  await seed({ coins: 0 });
  await sleep(2000);
  const l1 = await openLedger();
  console.log('1空:', JSON.stringify(l1));

  // 场景 2：多来源 coinLog → sources 按 |amt| 降序，分类正确
  await seed({
    coins: 250,
    coinLog: [
      { d:'2026-08-10', amt:50, note:'签到 · 连续X天' },
      { d:'2026-08-10', amt:20, note:'新手任务：迈出第一步' },
      { d:'2026-08-10', amt:10, note:'解锁成就「迈出第一步」' },
      { d:'2026-08-10', amt:150, note:'本周目标达成' },
      { d:'2026-08-10', amt:60, note:'连续执行 7 天里程碑' },
      { d:'2026-08-10', amt:-100, note:'兑换「搞钱新手」称号' },
      { d:'2026-08-10', amt:50, note:'盲盒开出金币' },
      { d:'2026-08-10', amt:10, note:'今日执行复盘：做了' }
    ]
  });
  await sleep(2000);
  const l2 = await openLedger();
  console.log('2多来源:', JSON.stringify(l2));

  const pass = l1 && !l1.hasSrc && l1.empty && l1.empty.includes('暂无金币记录')
    && l2 && l2.hasSrc && l2.title.includes('金币来源') && l2.srcs.length === 8
    && l2.srcs[0].name === '目标达成' && l2.srcs[0].amt === '+150'
    && l2.srcs[1].name === '消费' && l2.srcs[1].amt === '-100'
    && l2.srcs[2].name === '里程碑' && l2.srcs[2].amt === '+60'
    && l2.srcs[3].amt === '+50' && l2.srcs[4].amt === '+50'
    && l2.rows === 8;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
