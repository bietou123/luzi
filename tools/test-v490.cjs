#!/usr/bin/env node
/** CDP 验证 v4.9.0：奖励阶梯（签到/执行 7/30/60 三台阶，done=金色实底、next=金色虚线、未到=灰） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[] }, ${JSON.stringify(extra||{})}))); location.hash='mine'; location.reload(); return 'ok'; })()`);
  const ladder = async () => await ev(`(() => { const rows = [...document.querySelectorAll('.lr-row')]; if (!rows.length) return null; return rows.map(row => {
    const lb = row.querySelector('.lr-lb').textContent.trim();
    return { lb, steps: [...row.querySelectorAll('.ladder-step')].map(s => ({
      k: s.querySelector('.ls-k').childNodes[0].textContent,
      coins: s.querySelector('.ls-c').textContent,
      cls: (s.classList.contains('done') ? 'd' : '') + (s.classList.contains('current') ? 'c' : '') + (s.classList.contains('done') || s.classList.contains('current') ? '' : 'x')
    })) };
  }); })()`);

  // 场景 1：空态 → 签到+执行各 7/30/60 全灰，第一格 current（next）
  await seed({});
  await sleep(2000);
  const e1 = await ladder();
  console.log('1空态:', JSON.stringify(e1));

  // 场景 2：签到 7/30 已领 + 执行 7 已领 → 签7 done 签30 done 签60 current；执7 done 执30 current
  await seed({ streak: 30, streakRewards: [7, 30], execStreakRewards: [7], reviews: {} });
  await sleep(2000);
  const e2 = await ladder();
  console.log('2阶梯:', JSON.stringify(e2));

  const pass = e1
    && e1.length === 2 && e1[0].lb === '🔥 签到' && e1[1].lb === '💪 执行'
    && e1[0].steps[0].cls === 'c' && e1[0].steps[0].coins === '+50🪙'
    && e1[1].steps[0].cls === 'c' && e1[1].steps[0].coins === '+60🪙'
    && e2 && e2[0].steps[0].cls === 'd' && e2[0].steps[0].coins === '+50🪙'
    && e2[0].steps[1].cls === 'd' && e2[0].steps[1].coins === '+150🪙'
    && e2[0].steps[2].cls === 'c' && e2[0].steps[2].coins === '+300🪙'
    && e2[1].steps[0].cls === 'd' && e2[1].steps[0].coins === '+60🪙'
    && e2[1].steps[1].cls === 'c' && e2[1].steps[1].coins === '+150🪙';
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
