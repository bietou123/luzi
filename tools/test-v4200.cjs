#!/usr/bin/env node
/** CDP 验证 v4.20.0：首页双目标卡（本周目标 + 本月目标合并），周目标达标检测+防重 */
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
  const today = new Date('2026-08-10T12:00:00');
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const hw = () => ev(`(() => { const w = document.querySelector('.hg-week'); if (!w) return null; return { cls: w.className, pct: w.querySelector('.hw-pct') ? w.querySelector('.hw-pct').textContent.trim() : null, fill: w.querySelector('.hw-fill') ? w.querySelector('.hw-fill').style.width : null, sub: w.querySelector('.hw-sub') ? w.querySelector('.hw-sub').textContent.replace(/\\s+/g,' ').trim() : null }; })()`);
  const stR = () => ev(`(() => { const s=JSON.parse(localStorage.getItem('luzi_app_v1')); return { recs: s.records, coins: s.coins, wkCeleb: s.weekGoalCelebrated, wkLogs: (s.coinLog||[]).filter(l=>l.note&&l.note.includes('本周目标达成')).length }; })()`);
  const st = () => ev(`(() => { const s = JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins: s.coins, wkCeleb: s.weekGoalCelebrated, wkLogs: (s.coinLog||[]).filter(l=>l.note&&l.note.includes('本周目标达成')).length }; })()`);
  const mkRec = (amt) => [{ id:'r1', date: todayStr, type:'in', amount:amt, note:'测试收入', ts:Date.now() }];

  // 场景 1：无本周收入 → 周目标行 0%，还差 ¥230
  await seed({});
  await sleep(2000);
  const w1 = await hw();
  console.log('1空:', JSON.stringify(w1), 'st:', JSON.stringify(await stR()));
  await seed({ records: mkRec(120) });
  await sleep(2000);
  const w2 = await hw();
  console.log('2本周120:', JSON.stringify(w2), 'st:', JSON.stringify(await stR()));

  // 场景 3：本周收入 240 > 230 → 达标 +150，防重
  await seed({ records: mkRec(240) });
  await sleep(2500);
  const w3 = await hw();
  const s3 = await st();
  console.log('3达标:', JSON.stringify(w3), 'state:', JSON.stringify(s3));
  // 再次 reload 验证不重复发奖
  await ev(`location.reload()`);
  await sleep(2500);
  const s3b = await st();
  console.log('3reload防重:', JSON.stringify(s3b));

  const pass = w1 && w1.pct === '0%' && w1.fill === '0%' && w1.sub.includes('¥230') && w1.sub.includes('还差')
    && w2 && w2.pct === '52%' && w2.fill === '52%' && w2.sub.includes('还差 ¥110') && w2.sub.includes('+150')
    && w3 && w3.pct === '已达标 🎉' && w3.fill === '100%' && w3.cls.includes('done') && w3.sub.includes('超出')
    && s3.coins >= 250 && s3.wkLogs === 1 && s3.wkCeleb === todayStr && s3b.wkLogs === 1;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
