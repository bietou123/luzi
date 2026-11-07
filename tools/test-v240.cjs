#!/usr/bin/env node
/** CDP 验证 v2.4.0：连续签到里程碑奖励 */
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
  const click = async (sel) => { const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'notfound'; el.click(); return 'ok'; })()`); return r; };

  // ①种子：连续6天（昨天往前5天），今天未签，tasks 全完成，coins 0
  await ev(`(() => {
    function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
    var now = new Date();
    var checkin = {};
    for (var i=1;i<=6;i++){ var d = new Date(now.getTime() - i*86400000); checkin[fmt(d)] = 1; }
    var yest = fmt(new Date(now.getTime()-86400000));
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin: checkin, lastCheckin: yest, streak: 6, coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] }));
    return 'ok';
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);

  // ②签到 → streak 7 里程碑 +50
  await click('.stat-box[data-checkin]');
  await sleep(900);
  const r7 = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    const bonus = (document.querySelector('.checkin-bonus')||{}).textContent || '';
    const next = (document.querySelector('.checkin-next')||{}).textContent || '';
    const sub = (document.querySelector('.ci-sub')||{}).textContent || '';
    return { streak: st.streak, coins: st.coins, rewards: st.streakRewards, bonus, next, sub };
  })()`);
  console.log('①streak6→7:', JSON.stringify(r7));
  await click('.checkin-btn');
  await sleep(300);

  // ②b 防重：reload 后同一天再点签到 → 不重发（已签 toast，streakRewards 不变）
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2000);
  await click('.stat-box[data-checkin]');
  await sleep(500);
  const dup = await ev(`(() => { const st = JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins: st.coins, rewards: st.streakRewards }; })()`);
  console.log('①b重签防重:', JSON.stringify(dup));
  await click('.checkin-btn').catch(() => {});

  // ③种子 streak=29 连续29天 → 签到 → 30 里程碑 +150
  await ev(`(() => {
    function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
    var now = new Date();
    var checkin = {};
    for (var i=1;i<=29;i++){ var d = new Date(now.getTime() - i*86400000); checkin[fmt(d)] = 1; }
    var yest = fmt(new Date(now.getTime()-86400000));
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin: checkin, lastCheckin: yest, streak: 29, coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] }));
    return 'ok';
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await click('.stat-box[data-checkin]');
  await sleep(900);
  const r30 = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { streak: st.streak, coins: st.coins, rewards: st.streakRewards, bonus: (document.querySelector('.checkin-bonus')||{}).textContent || '' };
  })()`);
  console.log('②streak29→30:', JSON.stringify(r30));

  const pass = r7.streak === 7 && r7.coins === 95 && r7.rewards.includes(7) && r7.bonus.includes('+50') && r7.sub.includes('7')
    && dup.coins === r7.coins && dup.rewards.length === r7.rewards.length
    && r30.streak === 30 && r30.coins === 210 && r30.rewards.includes(30) && r30.bonus.includes('+150');
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
