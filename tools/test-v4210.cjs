#!/usr/bin/env node
/** CDP 验证 v4.21.0：通知时间自定义（我的页入口 + 弹窗改晨/晚时间 + 保存重排） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const st = () => ev(`(() => { const s = JSON.parse(localStorage.getItem('luzi_app_v1')); return { mo: s.notifMorning, ev: s.notifEvening, nDate: localStorage.getItem('luzi_notif_date') }; })()`);
  const goMine = () => ev(`(function(){ location.hash='mine'; return 'ok'; })()`);
  const entry = () => ev(`(() => { const it = document.querySelector('[data-go="notif"]'); return it ? { name: it.querySelector('.mi-name').textContent.trim(), val: it.querySelector('.mi-val') ? it.querySelector('.mi-val').textContent.trim() : null } : null; })()`);

  // 场景 1：默认入口显示 8:30 · 20:30
  await seed({});
  await sleep(2200);
  await goMine();
  await sleep(1200);
  const e1 = await entry();
  console.log('1入口:', JSON.stringify(e1));
  // 场景 2：点击弹窗预填
  await ev(`document.querySelector('[data-go="notif"]').click()`);
  await sleep(800);
  const s2 = await ev(`(() => { const m = document.querySelector('#notif-morning'); const e = document.querySelector('#notif-evening'); return { h3: document.querySelector('.modal-sheet h3') ? document.querySelector('.modal-sheet h3').textContent.trim() : null, mo: m ? m.value : null, ev: e ? e.value : null }; })()`);
  console.log('2弹窗:', JSON.stringify(s2));
  // 场景 3：改成 07:00 / 21:15 保存
  await ev(`(() => { const m = document.querySelector('#notif-morning'); const e = document.querySelector('#notif-evening'); m.value = '07:00'; e.value = '21:15'; return 'ok'; })()`);
  await ev(`document.querySelector('[data-save]').click()`);
  await sleep(1200);
  const s3 = await st();
  const e3 = await entry();
  console.log('3保存后 state:', JSON.stringify(s3), '入口:', JSON.stringify(e3));
  // 场景 4：可选——原生 pending 通知时间（权限授予时才有效）
  const n4 = await ev(`window.__luziNotif ? window.__luziNotif() : null`);
  console.log('4pending通知:', JSON.stringify(n4));

  const pass = e1 && e1.name.includes('通知时间') && e1.val === '8:30 · 20:30'
    && s2 && s2.h3.includes('通知时间') && s2.mo === '08:30' && s2.ev === '20:30'
    && s3.mo === '07:00' && s3.ev === '21:15' && e3 && e3.val === '7:00 · 21:15';
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
