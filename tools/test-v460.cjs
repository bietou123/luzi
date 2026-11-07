#!/usr/bin/env node
/** CDP 验证 v4.6.0：成就金币奖励（解锁发奖/防重/网格+弹窗显示/老用户静默校准不发） */
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
  const state = async () => await ev(`JSON.parse(localStorage.getItem('luzi_app_v1'))`);
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[] }, ${JSON.stringify(extra||{})}))); return 'ok'; })()`);
  const goHome = async () => { await ev(`location.hash='home'; location.reload(); 'ok'`); await sleep(2000); };
  const goMine = async () => { await ev(`location.hash='mine'; 'ok'`); await sleep(600); };

  // ===== 场景 1：签到解锁「迈出第一步」→ +10 金币 + toast =====
  await seed({});
  await goHome();
  const coinsBefore = (await state()).coins;
  await ev(`document.querySelector('.stat-box[data-checkin]').click(); 'ok'`);
  await sleep(1500);
  const after1 = await state();
  const toast1 = await ev(`document.querySelector('#toast').textContent`);
  console.log('1签到解锁:', JSON.stringify({ coinsBefore, coins: after1.coins, delta: after1.coins - coinsBefore, achRewarded: after1.achRewarded, toast1 }));

  // ===== 场景 2：reload 防重 + 网格显示 =====
  await goHome();
  await goMine();
  const after2 = await state();
  const grid = await ev(`(() => { const items = [...document.querySelectorAll('.as-item')]; return { n: items.length, first: items[0] ? { locked: items[0].classList.contains('locked'), reward: (items[0].querySelector('.as-reward')||{}).textContent||'' } : null, rewardCount: items.filter(x => x.querySelector('.as-reward')).length }; })()`);
  console.log('2防重+网格:', JSON.stringify({ coins: after2.coins, achRewarded: after2.achRewarded, grid }));

  // ===== 场景 3：成就详情弹窗奖励态 =====
  await ev(`document.querySelector('.as-item[data-ach="0"]').click(); 'ok'`);
  await sleep(300);
  const sheetClaimed = await ev(`(() => { const m = document.querySelector('.modal-mask'); const r = m && m.querySelector('.ach-reward'); return r ? { txt: r.textContent, claimed: r.classList.contains('claimed') } : null; })()`);
  await ev(`document.querySelector('.ach-sheet [data-close]').click(); 'ok'`);
  await sleep(200);
  await ev(`document.querySelector('.as-item[data-ach="9"]').click(); 'ok'`);
  await sleep(300);
  const sheetLocked = await ev(`(() => { const m = document.querySelector('.modal-mask'); const r = m && m.querySelector('.ach-reward'); return r ? r.textContent : null; })()`);
  await ev(`document.querySelector('.ach-sheet [data-close]').click(); 'ok'`);
  console.log('3弹窗:', JSON.stringify({ sheetClaimed, sheetLocked }));

  // ===== 场景 4：老用户升级静默校准（不补发）=====
  await seed({ coins: 1000, checkin: { '2026-08-09': 1 }, lastCheckin: '2026-08-09', streak: 1 });
  await goHome();
  await goMine();
  const after4 = await state();
  console.log('4老用户校准:', JSON.stringify({ coins: after4.coins, achRewarded: after4.achRewarded, achShown: after4.achShown }));

  const pass = after1.coins - coinsBefore === 25
    && JSON.stringify(after1.achRewarded) === '["迈出第一步"]'
    && toast1.includes('迈出第一步') && toast1.includes('+10')
    && after2.coins === after1.coins && JSON.stringify(after2.achRewarded) === '["迈出第一步"]'
    && grid.n === 15 && grid.first.locked === false && grid.first.reward === '+10🪙' && grid.rewardCount === 15
    && sheetClaimed && sheetClaimed.txt.includes('奖励已领取') && sheetClaimed.claimed === true
    && sheetLocked && sheetLocked.includes('解锁奖励 +80')
    && after4.coins === 1000 && JSON.stringify(after4.achRewarded) === '[]'
    && after4.achShown.length === 1 && after4.achShown[0] === '迈出第一步';
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
