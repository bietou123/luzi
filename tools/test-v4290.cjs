#!/usr/bin/env node
/** CDP 验证 v4.29.0：今日三步走聚合引导卡（状态计数 + 点击签到/记账跳转 + 签到后刷新） */
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
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  // 设备日期可能与宿主机不同（此环境设备 8-10 vs Node 8-11），当天精确匹配必须用设备端 today
  const devToday = await ev(`(function(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
  const T = devToday;
  const mkRec = (amount) => ({ id: 'r' + Math.random().toString(36).slice(2,8), routeId: 'd002', date: T, type: 'in', amount, note: '测试', ts: Date.now() });
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000 }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);
  const tsInfo = () => ev(`(() => { const c = document.querySelector('.today-steps'); if (!c) return null; return { count: (c.querySelector('.ts-count')||{}).textContent, signDone: !!c.querySelector('[data-ts="sign"].done'), execDone: !!c.querySelector('[data-ts="exec"].done'), bookDone: !!c.querySelector('[data-ts="book"].done'), allDone: c.classList.contains('all-done'), complete: !!c.querySelector('.ts-complete'), items: c.querySelectorAll('.ts-item').length }; })()`);
  const sheetH3 = () => ev(`(() => { const m = document.querySelector('.modal-sheet'); const h = m && (m.querySelector('h3') || m.querySelector('.ci-title')); return h ? h.textContent : null; })()`);

  // 预热
  await seed({});
  await sleep(4000);

  // 场景 1：全空 → 0/3 三步全未完成
  await seed({});
  await sleep(2600);
  const c1 = await tsInfo();
  console.log('1空态:', JSON.stringify(c1));

  // 场景 2：已签到 + 已记账 → 2/3，sign/book done
  await seed({ checkin: { [T]: 1 }, records: [mkRec(30)], reviews: {} });
  await sleep(2600);
  const c2 = await tsInfo();
  console.log('2签+记:', JSON.stringify(c2));

  // 场景 3：全完成 → 3/3 all-done complete
  await seed({ checkin: { [T]: 1 }, records: [mkRec(30)], reviews: { [T]: 'done' } });
  await sleep(2600);
  const c3 = await tsInfo();
  console.log('3全完成:', JSON.stringify(c3));

  // 场景 4：点签到步骤 → 签到 sheet + 三步卡 sign 变 done + count 1/3
  await seed({});
  await sleep(2600);
  await ev(`document.querySelector('.ts-item[data-ts="sign"]') ? document.querySelector('.ts-item[data-ts="sign"]').click() : null`);
  await sleep(1000);
  const c4sheet = await sheetH3();
  const c4 = await tsInfo();
  console.log('4点签到 sheet:', JSON.stringify(c4sheet), '步骤:', JSON.stringify(c4));

  // 场景 5：点记账步骤 → 记一笔 sheet
  await ev(`document.querySelector('.modal-mask') ? document.querySelector('.modal-mask').remove() : null`);
  await ev(`document.querySelector('.ts-item[data-ts="book"]') ? document.querySelector('.ts-item[data-ts="book"]').click() : null`);
  await sleep(900);
  const c5 = await sheetH3();
  console.log('5点记账:', JSON.stringify(c5));

  const pass = c1 && c1.count === '0/3' && !c1.signDone && !c1.execDone && !c1.bookDone && c1.items === 3
    && c2 && c2.count === '2/3' && c2.signDone && c2.bookDone && !c2.execDone
    && c3 && c3.count === '3/3' && c3.allDone && c3.complete
    && c4sheet && c4sheet.includes('打卡成功') && c4 && c4.count === '1/3' && c4.signDone
    && c5 && c5.includes('记一笔');
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
