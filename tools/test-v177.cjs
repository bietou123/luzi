#!/usr/bin/env node
/** CDP 验证 v1.7.7：新手路线图 */
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
  // 空状态种子
  await ev(`(() => { localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:0 })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2500);

  const r1 = await ev(`(() => {
    const card = document.querySelector('.roadmap-card');
    const steps = [...document.querySelectorAll('.rm-step')];
    const cur = steps.find(s => s.classList.contains('current'));
    const done = steps.filter(s => s.classList.contains('done')).length;
    return {
      has: !!card,
      stepCount: steps.length,
      doneCount: done,
      curName: cur ? cur.querySelector('.rm-name').textContent.trim() : '',
      curHasMark: cur ? !!cur.querySelector('.rm-cur') : false,
      more: (document.querySelector('.section-title') && document.querySelectorAll('.section-title')[0]) ? '' : ''
    };
  })()`);
  // 单独取路线图标题的进度
  const r1b = await ev(`(() => {
    const titles = [...document.querySelectorAll('.section-title')];
    const rm = titles.find(t => t.textContent.includes('新手路线图'));
    return { title: rm ? rm.textContent.trim() : '' };
  })()`);
  console.log('①空状态:', JSON.stringify({ ...r1, title: r1b.title }));

  // 点第 1 步 → 详情
  await ev(`document.querySelector('.rm-step').click(); 'ok'`);
  await sleep(300);
  const det = await ev(`(() => ({
    detail: !!document.querySelector('.detail-hero'),
    title: (document.querySelector('.detail-title')||{}).textContent ? document.querySelector('.detail-title').textContent.trim() : ''
  }))()`);
  console.log('②点击第1步:', JSON.stringify(det));
  await ev(`document.querySelector('[data-back]').click(); 'ok'`);
  await sleep(300);

  // 造数据：收藏 d002 + 记账 d003 → 解锁前两步
  await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    s.liked = { d002: 123 };
    const t = new Date();
    const tst = t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0');
    s.records = [{ id: 'r1', routeId: 'd003', title: '证件照修图', amount: 60, type: 'in', note: '测试', date: tst }];
    localStorage.setItem('luzi_app_v1', JSON.stringify(s));
    return 'ok';
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2500);
  const r2 = await ev(`(() => {
    const steps = [...document.querySelectorAll('.rm-step')];
    const cur = steps.find(s => s.classList.contains('current'));
    const done = steps.filter(s => s.classList.contains('done')).length;
    const foot = (document.querySelector('.rm-foot')||{}).textContent ? document.querySelector('.rm-foot').textContent.trim() : '';
    return { doneCount: done, curName: cur ? cur.querySelector('.rm-name').textContent.trim() : '', foot };
  })()`);
  console.log('③解锁两步后:', JSON.stringify(r2));

  const pass = r1.has === true && r1.stepCount === 7 && r1.doneCount === 0 && r1.curName.startsWith('先赚到第一笔') && r1.curHasMark === true && r1b.title.includes('0/7') && det.detail === true && r2.doneCount === 2 && r2.curName.startsWith('技能变现金') && r2.foot.includes('第 3 步');
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
