#!/usr/bin/env node
/** CDP 验证 v1.6.9：补签卡（金币补回昨天漏签） */
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

  // 日期 helper（页面内计算，与 app todayStr 同源）
  const ds = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const T1 = ds(1), T2 = ds(2);

  // ============ 场景1：首页补签横幅 + 确认补签 ============
  // 种子：前天签、昨天漏、今天未签，coins=150（够补签）
  await ev(`(() => {
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin: { '${T2}': 1 }, coins: 150, streak: 1, lastCheckin: '${T2}' }));
    return 'seeded';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  const strip1 = await ev(`(() => { const s = document.querySelector('.makeup-strip'); return { has: !!s, text: s ? s.textContent.trim() : '' }; })()`);
  console.log('1.首页横幅:', JSON.stringify(strip1));

  await ev(`document.querySelector('.makeup-strip').click(); 'ok'`);
  await sleep(500);
  const confirm1 = await ev(`(() => { const m = document.querySelector('.modal-sheet'); return m ? m.textContent.replace(/\\s+/g,' ').trim().slice(0,60) : '无弹窗'; })()`);
  console.log('2.补签确认弹窗:', confirm1);

  await ev(`document.querySelector('[data-confirm-makeup]').click(); 'ok'`);
  await sleep(900);
  const after1 = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { coins: st.coins, hasYest: !!st.checkin['${T1}'], streak: st.streak, stripGone: !document.querySelector('.makeup-strip'), modalGone: !document.querySelector('.modal-mask') };
  })()`);
  console.log('3.补签后:', JSON.stringify(after1));

  // ============ 场景2：金币不足拦截 ============
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    st.coins = 30; delete st.checkin['${T1}'];
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    return 'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  const strip2 = await ev(`!!document.querySelector('.makeup-strip')`);
  await ev(`document.querySelector('.makeup-strip').click(); 'ok'`);
  await sleep(500);
  const poor = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { coins: st.coins, hasYest: !!st.checkin['${T1}'], toast: document.querySelector('#toast').textContent, modalOpen: !!document.querySelector('[data-confirm-makeup]') };
  })()`);
  console.log('4.金币不足:', JSON.stringify({ strip2, ...poor }));

  // ============ 场景3：签到成功弹窗内补签块 ============
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    st.coins = 200; st.streak = 1; st.lastCheckin = '${T2}'; delete st.checkin['${T1}']; delete st.checkin['${ds(0)}'];
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    return 'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  await ev(`document.querySelector('[data-checkin]').click(); 'ok'`);
  await sleep(800);
  const modal3 = await ev(`(() => ({
    hasBlock: !!document.querySelector('.makeup-block'),
    hasBtn: !!document.querySelector('.makeup-btn'),
    btnText: document.querySelector('.makeup-btn')?.textContent.trim() || '',
    streakShown: document.querySelector('.checkin-streak')?.textContent || ''
  }))()`);
  console.log('5.签到弹窗补签块:', JSON.stringify(modal3));

  await ev(`document.querySelector('.makeup-btn').click(); 'ok'`);
  await sleep(700);
  const after3 = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    return { coins: st.coins, hasYest: !!st.checkin['${T1}'], streak: st.streak, blockGone: !document.querySelector('.makeup-block'), sub: document.querySelector('.ci-sub')?.textContent || '', lbl: document.querySelector('.stat-box[data-checkin] .label')?.textContent || '' };
  })()`);
  console.log('6.弹窗内补签后:', JSON.stringify(after3));

  // ============ 场景4：正常连续签到不显示补签 ============
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1'));
    st.coins = 300; st.checkin['${T1}'] = 1; delete st.checkin['${ds(0)}']; st.lastCheckin = '${T1}';
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    return 'ok';
  })()`);
  await ev(`location.reload(); 'ok'`);
  await sleep(2500);
  const noStrip = await ev(`!!document.querySelector('.makeup-strip')`);
  await ev(`document.querySelector('[data-checkin]').click(); 'ok'`);
  await sleep(800);
  const noBlock = await ev(`(() => { const m = document.querySelector('.modal-sheet'); return { hasBlock: !!document.querySelector('.makeup-block'), ok: m?.textContent?.includes('打卡成功') || false }; })()`);
  console.log('7.正常签到无补签:', JSON.stringify({ noStrip, ...noBlock }));

  cdp.close();
  process.exit(0);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
