#!/usr/bin/env node
/** CDP 验证 v1.6.3：新手任务系统 */
'use strict';
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b)));
  }).on('error', rej);
});
function connect(wsUrl) {
  const u = new URL(wsUrl);
  const sock = net.connect(Number(u.port), u.hostname);
  const handlers = new Map();
  let id = 0, buf = Buffer.alloc(0), open = false;
  const ready = new Promise((resolve) => {
    sock.on('connect', () => sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!open) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; buf = buf.subarray(i + 4); open = true; resolve(); }
      for (;;) {
        if (buf.length < 2) return;
        const l0 = buf[1] & 0x7f; let off = 2, len = l0;
        if (l0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (l0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const s = buf.subarray(off, off + len).toString('utf8'); buf = buf.subarray(off + len);
        let m; try { m = JSON.parse(s); } catch { continue; }
        if (m.id && handlers.has(m.id)) { handlers.get(m.id)(m); handlers.delete(m.id); }
      }
    });
  });
  const frame = (text) => {
    const d = Buffer.from(text, 'utf8'); const mask = crypto.randomBytes(4);
    let h;
    if (d.length < 126) h = Buffer.from([0x81, 0x80 | d.length]);
    else if (d.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0xfe; h.writeUInt16BE(d.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0xff; h.writeBigUInt64BE(BigInt(d.length), 2); }
    const m2 = Buffer.from(d); for (let i = 0; i < m2.length; i++) m2[i] ^= mask[i % 4];
    return Buffer.concat([h, mask, m2]);
  };
  const send = (method, params = {}) => ready.then(() => new Promise((resolve, reject) => {
    const mid = ++id;
    handlers.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    sock.write(frame(JSON.stringify({ id: mid, method, params })));
  }));
  return { send, close: () => sock.destroy() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await getJSON('/json');
  const page = list.find((x) => x.type === 'page');
  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Input.setIgnoreInputEvents', { ignore: false }).catch(() => {});
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };

  // 种子：干净状态（无任何数据，streak=0）
  await ev(`localStorage.setItem('luzi_seen_onboard','1'); 'ok'`);
  await ev(`(() => {
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:null, coins:0, liked:{}, checks:{}, records:[], progress:{}, guideStage:0, routeHistory:{}, routeVotes:{}, monthGoal:1000, goalCelebratedMonth:'', achShown:[], tasks:[], remoteUrl:'', remoteUpdatedAt:null, lastRemoteFetch:null }));
    'ok';
  })()`);
  await ev(`location.hash = ''; 'ok'`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);

  // 1) 干净启动：t1 应自动完成（+20 金币），横幅显示 1/7
  const afterBoot = await ev(`(() => {
    const h = JSON.parse(localStorage.getItem('luzi_app_v1'));
    const banner = document.querySelector('.task-banner');
    return {
      coins: h.coins,
      tasks: h.tasks,
      bannerText: banner ? banner.textContent.replace(/\\s+/g,' ').trim() : null,
    };
  })()`);
  console.log('启动后(t1 应自动完成):', JSON.stringify(afterBoot));

  // 2) 弹窗：点横幅 → 7 项任务，t1 已领取
  await ev(`document.querySelector('.task-banner').click(); 'ok'`);
  await sleep(500);
  const sheet = await ev(`(() => {
    const items = [...document.querySelectorAll('.task-item')].map(i => ({
      name: i.querySelector('.ti-name')?.textContent,
      state: i.querySelector('.ti-state')?.textContent,
    }));
    return { count: items.length, items };
  })()`);
  console.log('任务弹窗:', JSON.stringify(sheet));
  await ev(`document.querySelector('.modal-mask [data-close]').click(); 'ok'`);
  await sleep(300);

  // 3) 签到 → t2
  await ev(`document.querySelector('[data-checkin]').click(); 'ok'`);
  await sleep(700);
  await ev(`document.querySelector('.modal-mask [data-close]').click().catch?.(()=>{}); document.querySelector('.modal-mask [data-close]')?.click(); 'ok'`);
  await sleep(300);
  let st = await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins:h.coins, tasks:h.tasks }; })()`);
  console.log('签到后:', JSON.stringify(st));

  // 4) 收藏 → t5（回首页点第一条热门路子的 ♡）
  await ev(`location.hash = ''; 'ok'`);
  await sleep(600);
  await ev(`document.querySelector('[data-like]').click(); 'ok'`);
  await sleep(600);
  st = await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins:h.coins, tasks:h.tasks, liked:Object.keys(h.liked).length }; })()`);
  console.log('收藏后:', JSON.stringify(st));

  // 5) 记账 → t4（mine→records→addmoney）
  await ev(`location.hash = 'records'; 'ok'`);
  await sleep(600);
  await ev(`document.querySelector('[data-addmoney]').click(); 'ok'`);
  await sleep(400);
  await ev(`document.querySelector('#money-amount').value = '100'; document.querySelector('[data-save]').click(); 'ok'`);
  await sleep(700);
  st = await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins:h.coins, tasks:h.tasks }; })()`);
  console.log('记账后:', JSON.stringify(st));

  // 6) 加入打卡 → t3
  await ev(`location.hash = ''; 'ok'`);
  await sleep(600);
  await ev(`document.querySelector('[data-track]').click(); 'ok'`);
  await sleep(600);
  st = await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins:h.coins, tasks:h.tasks }; })()`);
  console.log('加入打卡后:', JSON.stringify(st));

  // 7) streak 改为 3 → reload → t6
  await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); h.streak = 3; localStorage.setItem('luzi_app_v1', JSON.stringify(h)); 'ok'; })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2200);
  st = await ev(`(() => { const h=JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins:h.coins, tasks:h.tasks }; })()`);
  console.log('streak=3 后:', JSON.stringify(st));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
