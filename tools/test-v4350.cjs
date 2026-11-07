#!/usr/bin/env node
/** CDP 验证 v4.35.0：详情页成本核算（总投入/已回款/回本率 + 零成本起步） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[100,500,1000], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000, challenges:{}, challengeRewarded:[] }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const devToday = () => ev(`(() => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
  const goDetail = (id) => ev(`(() => { location.hash='route/${id}'; return 'ok'; })()`);
  const foot = () => ev(`(() => { const f=document.querySelector('.eb-foot'); if(!f) return null; return f.textContent.replace(/\\s+/g,' ').trim(); })()`);
  const hasBlock = () => ev(`(!!document.querySelector('.earn-block'))`);

  // 预热
  await seed({});
  await sleep(4000);
  const T = await devToday();
  const rid = await ev(`(() => { const t=document.querySelector('.today-route'); return t ? t.dataset.open : null; })()`);
  if (!rid) { console.error('无今日路子'); process.exit(2); }

  // 场景 1：纯收入（零成本）→ 累计收入 · 零成本起步
  await seed({ records: [{ routeId: rid, type: 'in', date: T, amount: 88 }] });
  await sleep(2500);
  await goDetail(rid); await sleep(1200);
  const f1 = await foot();
  console.log('1纯收入:', JSON.stringify({ f: f1 }));
  const p1 = f1 && f1.includes('累计收入') && f1.includes('¥88') && f1.includes('零成本起步');

  // 场景 2：投入+回款 → 总投入/已回款/回本率
  await seed({ records: [{ routeId: rid, type: 'out', date: T, amount: 100 }, { routeId: rid, type: 'in', date: T, amount: 300 }] });
  await sleep(2500);
  await goDetail(rid); await sleep(1200);
  const f2 = await foot();
  console.log('2回本:', JSON.stringify({ f: f2 }));
  const p2 = f2 && f2.includes('总投入') && f2.includes('¥100') && f2.includes('已回款') && f2.includes('¥300') && f2.includes('回本率') && f2.includes('300%');

  // 场景 3：未回本 → 还差 ¥150 回本
  await seed({ records: [{ routeId: rid, type: 'out', date: T, amount: 200 }, { routeId: rid, type: 'in', date: T, amount: 50 }] });
  await sleep(2500);
  await goDetail(rid); await sleep(1200);
  const f3 = await foot();
  console.log('3未回本:', JSON.stringify({ f: f3 }));
  const p3 = f3 && f3.includes('总投入') && f3.includes('¥200') && f3.includes('还差 ¥150 回本');

  // 场景 4：无记录 → 无成本核算行
  await seed({});
  await sleep(2500);
  await goDetail(rid); await sleep(1200);
  const hb4 = await hasBlock();
  const f4 = await foot();
  console.log('4无记录:', JSON.stringify({ block: hb4, f: f4 }));
  const p4 = !hb4 && f4 === null;

  const pass = p1 && p2 && p3 && p4;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
