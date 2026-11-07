#!/usr/bin/env node
/** CDP 验证 v3.3.0：新手教程互动化（去试试跳转）+ 学完奖励金币 */
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
  const st = async () => await ev(`(() => { const s = JSON.parse(localStorage.getItem('luzi_app_v1')); return { stage: s.guideStage, rewarded: !!s.guideRewarded, coins: s.coins }; })()`);
  const activeDot = async () => await ev(`(() => { const a = document.querySelector('.gh-step.active .gh-dot'); return a ? a.textContent : null; })()`);
  const ctaTxt = async () => await ev(`(() => { const c = document.querySelector('.guide-cta'); return c ? c.textContent : null; })()`);

  // 种子
  await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], guideStage:0, guideRewarded:false })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='guide'; 'ok'`);
  await sleep(700);

  const t0 = { dot: await activeDot(), cta: await ctaTxt() };
  console.log('①stage0:', JSON.stringify(t0));

  // 下一步 → stage1
  await click('.guide-next[data-guide-next]');
  await sleep(500);
  const t1 = { dot: await activeDot(), cta: await ctaTxt() };
  console.log('②stage1:', JSON.stringify(t1));

  // 去试试 → library（不推进 stage）
  await click('.guide-cta[data-guide-jump]');
  await sleep(700);
  const j1 = await ev(`(() => ({ hash: location.hash, isLib: !!document.querySelector('.random-btn[data-random-route]') }))()`);
  const sAfterJump = await st();
  await ev(`location.hash='guide'; 'ok'`);
  await sleep(600);
  const dotAfterJump = await activeDot();
  console.log('③去试试跳库:', JSON.stringify({ j1, stage: sAfterJump.stage, dotBack: dotAfterJump }));

  // 下一步 → stage2 → 去试试 → home
  await click('.guide-next[data-guide-next]');
  await sleep(500);
  const t2 = { dot: await activeDot(), cta: await ctaTxt() };
  await click('.guide-cta[data-guide-jump]');
  await sleep(700);
  const j2 = await ev(`(() => ({ hash: location.hash, isHome: !!document.querySelector('.slogan') }))()`);
  console.log('④stage2去试试:', JSON.stringify({ t2, j2 }));

  // 回 guide → 下一步 → stage3 → 去试试 → mine
  await ev(`location.hash='guide'; 'ok'`);
  await sleep(600);
  await click('.guide-next[data-guide-next]');
  await sleep(500);
  const t3 = { dot: await activeDot(), cta: await ctaTxt() };
  await click('.guide-cta[data-guide-jump]');
  await sleep(700);
  const j3 = await ev(`(() => ({ hash: location.hash, isMine: !!document.querySelector('.mine-head') }))()`);
  console.log('⑤stage3去试试:', JSON.stringify({ t3, j3 }));

  // 回 guide → 全部学完 → +50 金币
  await ev(`location.hash='guide'; 'ok'`);
  await sleep(600);
  await click('.guide-next[data-guide-next]');
  await sleep(700);
  const sDone = await st();
  console.log('⑥学完发奖:', JSON.stringify(sDone));

  // 再学完 → 不重复发
  await ev(`location.hash='guide'; 'ok'`);
  await sleep(600);
  await click('.guide-next[data-guide-next]');
  await sleep(700);
  const sDone2 = await st();
  console.log('⑦防重:', JSON.stringify(sDone2));

  const pass = t0.dot === '1' && t0.cta === null
    && t1.dot === '2' && t1.cta && t1.cta.includes('路子库')
    && j1.hash === '#library' && j1.isLib === true && sAfterJump.stage === 1 && dotAfterJump === '2'
    && t2.dot === '3' && t2.cta && t2.cta.includes('今日路子') && j2.hash === '#home' && j2.isHome === true
    && t3.dot === '4' && t3.cta && t3.cta.includes('坚持') && j3.hash === '#mine' && j3.isMine === true
    && sDone.rewarded === true && sDone.coins === 50
    && sDone2.coins === 50;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
