#!/usr/bin/env node
/** CDP 验证 v4.34.0：30 天挑战（开始/每日推进去重/30天完成+300+庆祝/防重/我的页挑战卡） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000, challenges:{}, challengeRewarded:[] }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const devToday = () => ev(`(() => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
  const goDetail = (id) => ev(`(() => { location.hash='route/${id}'; return 'ok'; })()`);
  const chBox = () => ev(`(() => { const c=document.querySelector('.challenge-box'); if(!c) return null; return { text: c.textContent.replace(/\\s+/g,' ').trim(), done: c.classList.contains('done'), idle: c.classList.contains('idle') }; })()`);
  const chState = (rid) => ev(`(() => { const st=JSON.parse(localStorage.getItem('luzi_app_v1')); const c=st.challenges && st.challenges['${rid}']; return c ? { days: Object.keys(c.days||{}).length, done: !!c.done } : null; })()`);
  const rwLog = (note) => ev(`(() => { try { return JSON.parse(localStorage.getItem('luzi_app_v1')).coinLog.filter(x=>x.note==='${note}').length; } catch { return 0; } })()`);
  const cr = () => ev(`(() => { try { return JSON.parse(localStorage.getItem('luzi_app_v1')).challengeRewarded || []; } catch { return []; } })()`);
  const celTitle = () => ev(`(() => { const t=document.querySelector('.exec-cel .ec-title'); return t ? t.textContent : null; })()`);
  const coins = () => ev(`(() => { try { return JSON.parse(localStorage.getItem('luzi_app_v1')).coins; } catch { return -1; } })()`);

  // 预热
  await seed({});
  await sleep(4000);
  const T = await devToday();
  const rid = await ev(`(() => { const t=document.querySelector('.today-route'); return t ? t.dataset.open : null; })()`);
  if (!rid) { console.error('无今日路子'); process.exit(2); }

  // 场景 1：空态 → 详情有「开始 30 天挑战」idle 按钮，我的页无挑战卡
  await seed({});
  await sleep(2500);
  await goDetail(rid); await sleep(1200);
  const h1 = await chBox();
  await ev(`location.hash='mine'`); await sleep(1200);
  const mc1 = await ev(`(!!document.querySelector('.challenge-card'))`);
  console.log('1空态:', JSON.stringify({ h: h1, mineHasCard: mc1 }));
  const p1 = h1 && h1.idle && h1.text.includes('开始 30 天挑战') && !mc1;

  // 场景 2：点开始 → 第 0/30 天 + 我的页挑战卡出现
  await seed({});
  await sleep(2500);
  await goDetail(rid); await sleep(1200);
  await ev(`document.querySelector('.ch-start').click()`); await sleep(1200);
  const h2 = await chBox();
  const st2 = await chState(rid);
  await ev(`location.hash='mine'`); await sleep(1200);
  const mc2 = await ev(`(() => { const c=document.querySelector('.challenge-card'); return c ? c.textContent.replace(/\\s+/g,' ').trim() : null; })()`);
  console.log('2开始:', JSON.stringify({ h: h2, st: st2, mine: mc2 }));
  const p2 = h2 && h2.text.includes('第 0/30 天') && st2 && st2.days === 0 && mc2 && mc2.includes('我的 30 天挑战');

  // 场景 3：打卡推进 → 第 1 天；再勾另一项 → 仍第 1 天（同天去重）
  await seed({ challenges: { [rid]: { start: T, days: {}, done: false } }, challengeRewarded: [] });
  await sleep(2500);
  await goDetail(rid); await sleep(1200);
  await ev(`document.querySelector('.check-item[data-dcheck="0"]').click()`); await sleep(1200);
  const h3a = await chBox();
  await ev(`document.querySelector('.check-item[data-dcheck="1"]').click()`); await sleep(1200);
  const h3b = await chBox();
  console.log('3推进:', JSON.stringify({ a: h3a, b: h3b }));
  const p3 = h3a && h3a.text.includes('第 1/30 天') && h3b && h3b.text.includes('第 1/30 天');

  // 场景 4：29 天 + 今天打卡 → 完成 +300 + 庆祝「30 天挑战完成！」
  const hist = [];
  for (let i = 1; i <= 29; i++) { const d = new Date(T + 'T00:00:00'); d.setDate(d.getDate() - i); hist.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')); }
  const days29 = hist.reduce((o, h) => (o[h] = 1, o), {});
  await seed({ challenges: { [rid]: { start: hist[0], days: days29, done: false } }, challengeRewarded: [] });
  await sleep(2500);
  await goDetail(rid); await sleep(1200);
  const h4a = await chBox();
  await ev(`document.querySelector('.check-item[data-dcheck="0"]').click()`); await sleep(1500);
  const h4b = await chBox();
  const st4 = await chState(rid);
  const cel4 = await celTitle();
  const log4 = await rwLog('30天挑战完成');
  const cr4 = await cr();
  const coins4 = await coins();
  console.log('4完成:', JSON.stringify({ before: h4a, after: h4b, st: st4, cel: cel4, log: log4, cr: cr4, coins: coins4 }));
  const p4 = h4a && h4a.text.includes('第 29/30 天') && st4 && st4.done && log4 === 1 && cel4 === '30 天挑战完成！' && cr4.includes(rid) && coins4 === 300;

  // 场景 5：防重 → reload 后不再发奖，显示完成态
  await ev(`location.hash='route/${rid}'; location.reload()`); await sleep(3000);
  const h5 = await chBox();
  const log5 = await rwLog('30天挑战完成');
  const cr5 = await cr();
  const coins5 = await coins();
  console.log('5防重:', JSON.stringify({ h: h5, log: log5, cr: cr5, coins: coins5 }));
  const p5 = h5 && h5.done && log5 === 1 && cr5.includes(rid) && coins5 === 300;

  const pass = p1 && p2 && p3 && p4 && p5;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
