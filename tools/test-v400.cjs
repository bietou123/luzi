#!/usr/bin/env node
/** CDP 验证 v4.0.0：攒钱目标卡（设置/进度/达标发奖/防重） */
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
  const click = async (sel) => await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'notfound'; el.click(); return 'ok'; })()`);

  const records = [
    { id:'a',routeId:'',title:'R',amount:100,type:'in',note:'',date:'2026-08-10' },
    { id:'b',routeId:'',title:'R',amount:50,type:'out',note:'',date:'2026-08-05' },
    { id:'c',routeId:'',title:'R',amount:300,type:'in',note:'',date:'2026-07-20' },
    { id:'d',routeId:'',title:'R',amount:80,type:'in',note:'',date:'2026-06-08' },
  ];
  const seed = async (saveGoal, coins) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:${coins}, liked:{}, checks:{}, records:${JSON.stringify(records)}, reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], firstInCelebrated:false, saveGoal:${saveGoal}, saveGoalCelebrated:false })); return 'ok'; })()`);
  const coins = async () => await ev(`JSON.parse(localStorage.getItem('luzi_app_v1')).coins`);
  const card = async () => await ev(`(() => {
    const guide = document.querySelector('.save-goal .sg-t');
    const gc = document.querySelector('.goal-card.save-goal');
    return {
      guide: guide ? guide.textContent : null,
      title: gc ? (gc.querySelector('.goal-title')||{}).textContent : null,
      now: gc ? (gc.querySelector('.goal-now b')||{}).textContent : null,
      sub: gc ? (gc.querySelector('.goal-sub')||{}).textContent : null,
      pct: gc ? (gc.querySelector('.goal-pct')||{}).textContent : null,
      reward: gc ? (gc.querySelector('.goal-reward')||{}).textContent : null,
      done: gc ? gc.classList.contains('done') : false,
    };
  })()`);

  // ① 未设置 → 引导卡
  await seed(0, 100);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const a = await card();
  console.log('①未设置:', JSON.stringify(a));

  // ② 打开弹窗 → 点 3000 chip → 保存
  await click('[data-save-goal-set]');
  await sleep(500);
  const b = await ev(`(() => ({ modal: !!document.querySelector('.modal-sheet'), chips: document.querySelectorAll('.sg-chip').length, title: (document.querySelector('.modal-sheet h3')||{}).textContent }))()`);
  console.log('②弹窗:', JSON.stringify(b));
  await click('.sg-chip[data-sg-val="3000"]');
  const chipVal = await ev(`document.querySelector('#save-goal-amount').value`);
  console.log('  chip值:', chipVal);
  await click('[data-sg-save]');
  await sleep(600);
  const c = await card();
  const cCoins = await coins();
  console.log('③已设3000:', JSON.stringify({ c, cCoins }));

  // ③ 编辑改 200 → 达标发奖
  await click('.goal-card.save-goal [data-save-goal-set]');
  await sleep(500);
  await ev(`(() => { const i=document.querySelector('#save-goal-amount'); i.value='200'; return 'ok'; })()`);
  await click('[data-sg-save]');
  await sleep(700);
  const d = await card();
  const dCoins = await coins();
  console.log('④改200达标:', JSON.stringify({ d, dCoins }));

  // ④ reload 防重
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const e = await card();
  const eCoins = await coins();
  console.log('⑤reload:', JSON.stringify({ e, eCoins }));

  const pass = a && a.guide === '设个攒钱目标'
    && b && b.modal === true && b.chips === 4 && b.title === '🐷 攒钱目标'
    && chipVal === '3000'
    && c && c.title === '🐷 攒钱目标' && c.now === '¥430'
    && !!c.sub && c.sub.includes('¥3,000') && c.sub.includes('¥2,570')
    && c.pct === '14%' && !!c.reward && c.reward.includes('+300')
    && d && d.done === true && d.now === '¥430' && !!d.reward && d.reward.includes('已领取')
    && (dCoins - cCoins) === 300
    && e && e.done === true && !!e.reward && e.reward.includes('已领取')
    && eCoins === dCoins;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
