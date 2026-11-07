#!/usr/bin/env node
/** CDP 验证 v4.38.0：每日路子档案（最近 14 天回放 / 今日角标 / 点开进详情） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[100,500,1000], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000, challenges:{}, challengeRewarded:[], saveGoal:0, saveGoalCelebrated:false }, ${JSON.stringify(extra||{})}))); location.hash='library'; location.reload(); return 'ok'; })()`);

  // 预热
  await seed({});
  await sleep(4000);

  // 场景 1：内容库有每日路子档案，14 行
  const arc1 = await ev(`(() => { const a=document.querySelector('.daily-archive'); if(!a) return null; const rows=[...a.querySelectorAll('.da-row')]; const today=rows[0] && rows[0].querySelector('.da-today'); const head=a.querySelector('.da-head') ? a.querySelector('.da-head').textContent.replace(/\\s+/g,' ').trim() : ''; return { count: rows.length, first: rows[0] ? rows[0].textContent.replace(/\\s+/g,' ').trim() : null, hasTodayBadge: !!today, head }; })()`);
  console.log('1档案区:', JSON.stringify(arc1));
  const ok1 = arc1 && arc1.count === 14 && arc1.hasTodayBadge === true && arc1.head.includes('每日路子') && arc1.first.includes('今日');

  // 场景 2：首行与第二行的路子不同（每天轮换）
  const arc2 = await ev(`(() => { const rows=[...document.querySelectorAll('.da-row')]; return rows.length>=2 ? { id0: rows[0].getAttribute('data-open'), id1: rows[1].getAttribute('data-open') } : null; })()`);
  console.log('2轮换:', JSON.stringify(arc2));
  const ok2 = arc2 && arc2.id0 && arc2.id1 && arc2.id0 !== arc2.id1;

  // 场景 3：点某行进详情页
  const arc3 = await ev(`(() => { const rows=[...document.querySelectorAll('.da-row')]; rows[1].click(); return 'clicked'; })()`);
  await sleep(1500);
  const detail = await ev(`(() => { const h=document.querySelector('.detail-hero'); if(!h) return null; const t=h.querySelector('.detail-title'); return { hero: !!h, title: t ? t.textContent.replace(/\\s+/g,' ').trim() : null, back: !!h.querySelector('[data-back]') }; })()`);
  console.log('3详情:', JSON.stringify({ click: arc3, detail }));
  const ok3 = arc3 === 'clicked' && detail && detail.hero === true && detail.title;

  const pass = ok1 && ok2 && ok3;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
