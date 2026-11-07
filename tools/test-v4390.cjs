#!/usr/bin/env node
/** CDP 验证 v4.39.0：搞钱避坑指南（我的页/教程页入口 / 黄金守则3条+八种套路+自救4步 / 读完+30金币防重） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[100,500,1000], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000, challenges:{}, challengeRewarded:[], saveGoal:0, saveGoalCelebrated:false }, ${JSON.stringify(extra||{})}))); location.hash='mine'; location.reload(); return 'ok'; })()`);

  // 预热
  await seed({});
  await sleep(4000);

  // 场景 1：我的页有「避坑指南」入口，未读完
  const m1 = await ev(`(() => { const i=[...document.querySelectorAll('.mine-item[data-go]')].find(x=>x.dataset.go==='guard'); if(!i) return null; return { name: i.textContent.replace(/\\s+/g,' ').trim(), val: i.querySelector('.mi-val') ? i.querySelector('.mi-val').textContent : null }; })()`);
  console.log('1我的页入口:', JSON.stringify(m1));
  const ok1 = m1 && m1.name.includes('避坑指南') && m1.val === '未读完';

  // 场景 2：点入口 → hash guard → 避坑页结构（banner/守则3/套路8/自救4/读按钮）
  await ev(`(() => { const i=[...document.querySelectorAll('.mine-item[data-go]')].find(x=>x.dataset.go==='guard'); i.click(); })()`);
  await sleep(1500);
  const g2 = await ev(`(() => { const h=location.hash; const b=document.querySelector('.guard-banner'); const rules=[...document.querySelectorAll('.gr-rule')]; const traps=[...document.querySelectorAll('.gt-row')]; const help=[...document.querySelectorAll('.gh-row')]; const btn=document.querySelector('[data-guard-read]'); return { hash: h, banner: !!b, rules: rules.length, traps: traps.length, help: help.length, btn: !!btn }; })()`);
  console.log('2避坑页:', JSON.stringify(g2));
  const ok2 = g2 && g2.hash === '#guard' && g2.banner === true && g2.rules === 3 && g2.traps === 8 && g2.help === 4 && g2.btn === true;

  // 场景 3：点读完 → +30 金币 · guardRead=true · 按钮变已读完
  await ev(`(() => { document.querySelector('[data-guard-read]').click(); })()`);
  await sleep(1200);
  const g3 = await ev(`(() => { const st=JSON.parse(localStorage.getItem('luzi_app_v1')); const done=document.querySelector('.gr-read-done'); const logs=(st.coinLog||[]).filter(x=>x.note==='读完避坑指南'); return { coins: st.coins, guardRead: st.guardRead, done: done ? done.textContent.replace(/\\s+/g,' ').trim() : null, logCount: logs.length, logAmt: logs.length ? logs[0].amt : null }; })()`);
  console.log('3读完:', JSON.stringify(g3));
  const ok3 = g3 && g3.guardRead === true && g3.coins >= 30 && g3.done && g3.done.includes('已读完') && g3.logCount === 1 && g3.logAmt === 30;

  // 场景 4：reload 防重 + 我的页显示「已读完」
  await ev(`(() => { location.hash='mine'; location.reload(); return 'ok'; })()`);
  await sleep(3500);
  const g4 = await ev(`(() => { const st=JSON.parse(localStorage.getItem('luzi_app_v1')); const logs=(st.coinLog||[]).filter(x=>x.note==='读完避坑指南'); const i=[...document.querySelectorAll('.mine-item[data-go]')].find(x=>x.dataset.go==='guard'); return { coinLogs: logs.length, coins: st.coins, guardRead: st.guardRead, mineVal: i && i.querySelector('.mi-val') ? i.querySelector('.mi-val').textContent : null }; })()`);
  console.log('4防重:', JSON.stringify(g4));
  const ok4 = g4 && g4.coinLogs === 1 && g4.guardRead === true && g4.mineVal === '已读完';

  // 场景 5：教程页有避坑入口
  await ev(`(() => { location.hash='guide'; return 'ok'; })()`);
  await sleep(1200);
  const g5 = await ev(`(() => { const e=document.querySelector('[data-guard-entry]'); return e ? e.textContent.replace(/\\s+/g,' ').trim() : null; })()`);
  console.log('5教程入口:', JSON.stringify(g5));
  const ok5 = g5 && g5.includes('避坑指南');

  const pass = ok1 && ok2 && ok3 && ok4 && ok5;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
