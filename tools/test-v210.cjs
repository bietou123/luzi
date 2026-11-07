#!/usr/bin/env node
/** CDP 验证 v2.1.0：首页月目标进度条 */
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
  // 本月日期前缀
  const ym = await ev(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); })()`);

  // ①未达标：本月收入 300 / 目标 1000
  await ev(`(() => {
    localStorage.setItem('luzi_seen_onboard','1');
    var d = new Date(); d.setDate(1);
    function pad(n){ return n<10 ? '0'+n : String(n); }
    var first = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:0, liked:{}, checks:{}, records:[{ id:'r1', routeId:'d001', title:'PPT代做', amount:300, type:'in', note:'测试', date: first }], reviews:{}, badges:{}, activeBadge:'', coinLog:[], monthGoal:1000, goalCelebratedMonth:'' }));
    return first;
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);

  const before = await ev(`(() => {
    const g = document.querySelector('.home-goal');
    return {
      has: !!g, doneCls: g ? g.classList.contains('done') : false,
      pct: (document.querySelector('.hg-pct')||{}).textContent || '',
      sub: (document.querySelector('.hg-sub')||{}).textContent || '',
      hint: (document.querySelector('.hg-hint')||{}).textContent || '',
      coins: JSON.parse(localStorage.getItem('luzi_app_v1')).coins
    };
  })()`);
  console.log('①未达标首页:', JSON.stringify(before));

  // ②点击 → 跳我的页
  await click('.home-goal');
  await sleep(500);
  const clicked = await ev(`(() => ({ hash: location.hash, goalCard: !!document.querySelector('.goal-card') }))()`);
  console.log('②点击跳转:', JSON.stringify(clicked));

  // ③达标：本月收入 1200
  await ev(`(() => {
    var d = new Date(); d.setDate(1);
    function pad(n){ return n<10 ? '0'+n : String(n); }
    var first = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:0, liked:{}, checks:{}, records:[{ id:'r1', routeId:'d001', title:'PPT代做', amount:1200, type:'in', note:'测试', date: first }], reviews:{}, badges:{}, activeBadge:'', coinLog:[], monthGoal:1000, goalCelebratedMonth:'' }));
    return 'ok';
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  const done = await ev(`(() => {
    const g = document.querySelector('.home-goal');
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    const celebrated = st.coinLog.some(l => l.note.includes('月度目标达成'));
    return {
      doneCls: g ? g.classList.contains('done') : false,
      pct: (document.querySelector('.hg-pct')||{}).textContent || '',
      sub: (document.querySelector('.hg-sub')||{}).textContent || '',
      hint: !document.querySelector('.hg-hint'),
      coins: st.coins, celebrated, goalCelebratedMonth: st.goalCelebratedMonth
    };
  })()`);
  console.log('③达标首页:', JSON.stringify(done));

  // ④重进不重复发奖
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2000);
  const again = await ev(`(() => { const st = JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins: st.coins, count: st.coinLog.filter(l => l.note.includes('月度目标达成')).length }; })()`);
  console.log('④重进不发奖:', JSON.stringify(again));

  const pass = before.has && !before.doneCls && before.pct === '30%' && before.sub.includes('还差 ¥700') && before.hint.includes('+200')
    && clicked.hash === '#mine' && clicked.goalCard
    && done.doneCls && done.pct.includes('已达标') && done.sub.includes('超出 ¥200') && done.hint && done.celebrated
    && done.goalCelebratedMonth.length === 7
    && done.coins - before.coins === 200
    && again.coins === done.coins && again.count === 1;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
