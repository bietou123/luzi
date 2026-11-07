#!/usr/bin/env node
/** CDP 验证 v4.14.0：下一个成就引导卡（未解锁中进度最大的一项） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', luckyCount:0, monthGoal:1000, goalCelebratedMonth:'', saveGoal:0, saveGoalCelebrated:false }, ${JSON.stringify(extra||{})}))); location.hash='mine'; location.reload(); return 'ok'; })()`);
  const na = () => ev(`(() => { const el = document.querySelector('.next-ach'); if (!el) return null; return { name: el.querySelector('.na-name') ? el.querySelector('.na-name').textContent : null, sub: el.querySelector('.na-sub') ? el.querySelector('.na-sub').textContent.replace(/\\s+/g,' ').trim() : null, fill: el.querySelector('.na-fill') ? el.querySelector('.na-fill').style.width : null, ico: el.querySelector('.na-ico') ? el.querySelector('.na-ico').textContent : null }; })()`);
  const days = (n, end = '2026-08-10') => { const o = {}; const e = new Date(end + 'T00:00:00'); for (let i = 0; i < n; i++) { const d = new Date(e); d.setDate(d.getDate() - i); o[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`] = 1; } return o; };

  // 场景 1：空态 → 第一个未解锁「迈出第一步」0%
  await seed({});
  await sleep(2000);
  const n1 = await na();
  console.log('1空态:', JSON.stringify(n1));

  // 场景 2：签到 5 天 → 小有坚持 71%「还差 2 解锁」+ 点击弹详情
  await seed({ checkin: days(5), streak: 5 });
  await sleep(2000);
  const n2 = await na();
  console.log('2签到5:', JSON.stringify(n2));
  await ev(`document.querySelector('.next-ach').click()`); await sleep(400);
  const sheet = await ev(`(() => { const s = document.querySelector('.ach-sheet'); return s ? s.querySelector('.ach-name').textContent : null; })()`);
  console.log('2点开详情:', sheet);

  // 场景 3：签到 7（小有坚持已解锁）+ 收藏 3 → 路子收藏家 60%
  await seed({ checkin: days(7), streak: 7, liked: { 'd001': 1, 'd002': 1, 'd003': 1 }, achShown: ['迈出第一步', '小有坚持'], achRewarded: ['迈出第一步', '小有坚持'] });
  await sleep(2000);
  const n3 = await na();
  console.log('3收藏3:', JSON.stringify(n3));

  // 场景 4：全解锁 → 无卡
  const mkChecks = () => { const o = {}; for (let d = 1; d <= 10; d++) { const k = `d001::2026-08-${String(d).padStart(2,'0')}`; o[k] = {}; for (let i = 0; i < 6; i++) o[k][i] = true; } return o; };
  const mkReviews = () => { const o = {}; for (let d = 4; d <= 13; d++) o[`2026-08-${String(d).padStart(2,'0')}`] = 'done'; return o; };
  const allBadges = ['迈出第一步','小有坚持','自律达人','第一桶金','千元小目标','净赚小成','路子收藏家','行动派','搞钱实干家','打卡铁人','执行力MAX','行动家','雷打不动','识货','挑剔鬼'];
  await seed({
    checkin: days(30), streak: 30,
    records: [ { id:1, routeId:'d001', title:'a', amount:1000, type:'in', date:'2026-08-10' }, { id:2, routeId:'d001', title:'b', amount:200, type:'out', date:'2026-08-09' } ],
    checks: mkChecks(),
    reviews: mkReviews(),
    liked: { 'd001': 1, 'd002': 1, 'd003': 1, 'd004': 1, 'd005': 1 },
    routeVotes: { 'd001':'like','d002':'like','d003':'like','d004':'like','d005':'like','d006':'meh' },
    achShown: allBadges, achRewarded: allBadges
  });
  await sleep(2000);
  const n4 = await na();
  console.log('4全解锁:', JSON.stringify(n4));

  const pass = n1 && n1.name === '迈出第一步' && n1.fill === '0%' && n1.sub.includes('还差 1 解锁')
    && n2 && n2.name === '小有坚持' && n2.fill === '71%' && n2.sub.includes('还差 2 解锁') && n2.sub.includes('+20')
    && sheet === '小有坚持'
    && n3 && n3.name === '路子收藏家' && n3.fill === '60%' && n3.sub.includes('还差 2 解锁')
    && n4 === null;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
