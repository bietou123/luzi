#!/usr/bin/env node
/** CDP 验证 v1.9.0：今日执行复盘 */
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

  // ①种子干净状态 + 回 home
  await ev(`(() => { localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, coins:0, liked:{}, checks:{}, records:[], reviews:{} })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2500);

  // ②未复盘卡 + 三按钮 + 问题文案含今日路子
  const init = await ev(`(() => {
    const card = document.querySelector('.today-review');
    const trTitle = (document.querySelector('.tr-title')||{}).textContent || '';
    const btns = [...document.querySelectorAll('.today-review [data-review]')].map(b => b.dataset.review);
    const q = (document.querySelector('.trv-q')||{}).textContent || '';
    return { hasCard: !!card, btns, qHasTitle: q.includes(trTitle), trTitle };
  })()`);
  console.log('①未复盘卡:', JSON.stringify(init));
  const todayTitle = init.trTitle;

  // ③点「✅做了」→ done 态 + 记账弹窗预选今日路子
  await click('[data-review="done"]');
  await sleep(1100);
  const afterDone = await ev(`(() => {
    const card = document.querySelector('.today-review');
    const status = (document.querySelector('.trv-status')||{}).textContent || '';
    const modal = document.querySelector('.modal-mask');
    const rec = document.querySelector('.trv-btn.record');
    return { doneCls: card ? card.classList.contains('done') : false, status, modalOpen: !!modal, recordBtn: !!rec };
  })()`);
  const afterDone2 = await ev(`(() => {
    const modal = document.querySelector('.modal-mask');
    const sel = modal ? modal.querySelector('#money-route') : null;
    const selText = sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex].text : '';
    return { modalOpen: !!modal, selText };
  })()`);
  console.log('②点做了:', JSON.stringify(afterDone), '预选:', JSON.stringify(afterDone2));
  const doneStatus = afterDone.status;

  // ④关弹窗 → 复盘卡已 done + 记一笔按钮
  await click('.modal-mask [data-close]');
  await sleep(400);
  const afterClose = await ev(`(() => ({
    modalGone: !document.querySelector('.modal-mask'),
    doneCls: (document.querySelector('.today-review')||{}).classList ? document.querySelector('.today-review').classList.contains('done') : false,
    recordBtn: !!document.querySelector('.trv-btn.record'),
    status: (document.querySelector('.trv-status')||{}).textContent || ''
  }))()`);
  console.log('③关弹窗后:', JSON.stringify(afterClose));

  // ⑤重新选择 → 回到未复盘
  await click('[data-review-repick]');
  await sleep(500);
  const repick = await ev(`(() => ({ btns: document.querySelectorAll('.today-review [data-review]').length, q: (document.querySelector('.trv-q')||{}).textContent || '' }))()`);
  console.log('④重新选择:', JSON.stringify(repick));

  // ⑥点「🔁做了一半」→ partial 态
  await click('[data-review="partial"]');
  await sleep(500);
  const partial = await ev(`(() => {
    const card = document.querySelector('.today-review');
    return { partialCls: card ? card.classList.contains('partial') : false, status: (document.querySelector('.trv-status')||{}).textContent || '' };
  })()`);
  console.log('⑤做了一半:', JSON.stringify(partial));

  // ⑦我的页 → 执行战绩卡
  await ev(`location.hash='mine'; location.reload(); 'ok'`);
  await sleep(2200);
  const mine = await ev(`(() => {
    const st = document.querySelector('.review-stats');
    const nums = st ? [...st.querySelectorAll('.rs-num')].map(n => n.textContent.trim()) : [];
    const subs = st ? [...st.querySelectorAll('.rs-lb')].map(n => n.textContent.trim()) : [];
    return { hasStats: !!st, nums, subs };
  })()`);
  console.log('⑥我的页战绩:', JSON.stringify(mine));

  // ⑧成就含执行力MAX（第10项，未解锁）
  const ach = await ev(`(() => {
    const items = [...document.querySelectorAll('.as-item')];
    const names = items.map(i => i.querySelector('.as-name').textContent);
    return { count: items.length, names };
  })()`);
  console.log('⑦成就列表:', JSON.stringify(ach));

  const pass = init.hasCard && init.btns.length === 3 && init.qHasTitle
    && afterDone.doneCls && afterDone.status.includes('今天做了') && afterDone.modalOpen && afterDone2.modalOpen && afterDone2.selText.includes(todayTitle)
    && afterClose.modalGone && afterClose.recordBtn && afterClose.doneCls
    && repick.btns === 3
    && partial.partialCls && partial.status.includes('做了一半')
    && mine.hasStats && mine.nums.length === 3
    && ach.count === 11 && ach.names.includes('执行力MAX');
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
