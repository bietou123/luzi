#!/usr/bin/env node
/** CDP 验证 v4.5.0：自定义打卡项（添加/勾选/进度联动/删除索引迁移/上限拦截） */
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
  const state = async () => await ev(`JSON.parse(localStorage.getItem('luzi_app_v1'))`);
  const seed = async (custom) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:100, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t4','t5','t2','t3','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:${JSON.stringify(custom||{})} })); return 'ok'; })()`);
  const goLib = async () => { await ev(`location.hash='library'; location.reload(); 'ok'`); await sleep(2000); };
  const openD001 = async () => { await click('.route-card[data-open="d001"]'); await sleep(600); };
  const prog = async () => await ev(`(() => { const els = [...document.querySelectorAll('.detail-sec div')].filter(x => x.textContent.indexOf('已完成') >= 0 && /[0-9]/.test(x.textContent)); if (!els.length) return null; const hit = els[els.length - 1]; const parts = hit.textContent.trim().split(' ')[0].split('/'); return parts.length === 2 ? parts : null; })()`);

  // ===== 场景 1：detail 添加自定义项 + 空输入拦截 =====
  await seed({});
  await goLib();
  await openD001();
  const addBtn = await ev(`!!document.querySelector('.cc-add[data-add-custom-check="d001"]')`);
  await click('.cc-add[data-add-custom-check="d001"]');
  await sleep(300);
  const sheetH3 = await ev(`(() => { const s = document.querySelector('.modal-mask'); const h = s && s.querySelector('h3'); return h ? h.textContent : 'null'; })()`);
  await click('[data-save-custom-check]');
  await sleep(200);
  const emptyToast = await ev(`document.querySelector('#toast').textContent`);
  await ev(`(() => { const i = document.querySelector('#custom-check-input'); i.value = '每天聊 3 个客户'; document.querySelector('[data-save-custom-check]').click(); return 'ok'; })()`);
  await sleep(600);
  let st = await state();
  const custom1 = st.customChecks.d001;
  const ccCount1 = await ev(`document.querySelectorAll('.cc-item').length`);
  const prog1 = await prog();
  console.log('1添加:', JSON.stringify({ addBtn, sheetH3, emptyToast, custom1, ccCount1, prog1 }));

  // 再添加一条
  await click('.cc-add[data-add-custom-check="d001"]');
  await sleep(300);
  await ev(`(() => { const i = document.querySelector('#custom-check-input'); i.value = '多写 1 条笔记'; document.querySelector('[data-save-custom-check]').click(); return 'ok'; })()`);
  await sleep(600);
  st = await state();
  const custom2 = st.customChecks.d001;
  const ccCount2 = await ev(`document.querySelectorAll('.cc-item').length`);
  const texts = await ev(`[...document.querySelectorAll('.cc-item .ck-text')].map(x => x.textContent)`);
  // 勾第一个自定义项（索引 7）
  await click('.cc-item[data-dcheck="7"]');
  await sleep(600);
  const done1 = await ev(`!!document.querySelector('.cc-item[data-dcheck="7"].done')`);
  const prog2 = await prog();
  console.log('2两条+勾选:', JSON.stringify({ custom2, ccCount2, texts, done1, prog2 }));

  // ===== 场景 2：track 页联动 =====
  await ev(`location.hash='home'; location.hash='track'; 'ok'`);
  await sleep(700);
  const trackCc = await ev(`(() => { const card = document.querySelector('.check-card'); if (!card) return null; const its = [...card.querySelectorAll('.cc-item')]; return { n: its.length, txt: its.map(x => x.querySelector('.ck-text').textContent), done7: !!card.querySelector('.cc-item[data-checkid="7"].done'), add: !!card.querySelector('.cc-add[data-add-custom-check="d001"]') }; })()`);
  await click('.cc-item[data-checkid="8"]');
  await sleep(600);
  const trackDone8 = await ev(`!!document.querySelector('.cc-item[data-checkid="8"].done')`);
  const ccDay = await ev(`(() => { const c = JSON.parse(localStorage.getItem('luzi_app_v1')).checks; const k = Object.keys(c).find(k => k.startsWith('d001::')); return c[k]; })()`);
  console.log('3track:', JSON.stringify({ trackCc, trackDone8, ccDay }));

  // ===== 场景 3：删除第一个 → 索引迁移（保留勾选态）=====
  await ev(`location.hash='home'; location.hash='library'; 'ok'`);
  await sleep(700);
  await openD001();
  const preDel = await ev(`(() => { const its = [...document.querySelectorAll('.cc-item')]; return { n: its.length, done: its.map(x => x.classList.contains('done')), txt: its.map(x => x.querySelector('.ck-text').textContent) }; })()`);
  await click('.cc-item[data-dcheck="7"] .cc-del');
  await sleep(600);
  const afterDel = await ev(`(() => { const its = [...document.querySelectorAll('.cc-item')]; return { n: its.length, done: its.map(x => x.classList.contains('done')), txt: its.map(x => x.querySelector('.ck-text').textContent), d7: !!document.querySelector('.cc-item[data-dcheck="7"]'), d8: !!document.querySelector('.cc-item[data-dcheck="8"]') }; })()`);
  st = await state();
  const custom3 = st.customChecks.d001;
  const migrated = await ev(`(() => { const c = JSON.parse(localStorage.getItem('luzi_app_v1')).checks; const k = Object.keys(c).find(k => k.startsWith('d001::')); return c[k]; })()`);
  console.log('4删除:', JSON.stringify({ preDel, afterDel, custom3, migrated }));

  // ===== 场景 4：超 10 条拦截 =====
  await seed({ d001: ['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10'] });
  await goLib();
  await openD001();
  await click('.cc-add[data-add-custom-check="d001"]');
  await sleep(300);
  await ev(`(() => { const i = document.querySelector('#custom-check-input'); i.value = '第11条'; document.querySelector('[data-save-custom-check]').click(); return 'ok'; })()`);
  await sleep(300);
  const overToast = await ev(`document.querySelector('#toast').textContent`);
  st = await state();
  const custom5 = st.customChecks.d001;
  console.log('5超限:', JSON.stringify({ overToast, len: custom5.length }));

  const pass = addBtn === true
    && sheetH3.includes('添加自定义打卡项')
    && emptyToast.includes('请输入打卡内容')
    && JSON.stringify(custom1) === '["每天聊 3 个客户"]'
    && ccCount1 === 1 && prog1 && prog1[0] === '0' && prog1[1] === '8'
    && ccCount2 === 2 && texts && texts.length === 2
    && done1 === true && prog2 && prog2[0] === '1' && prog2[1] === '9'
    && trackCc && trackCc.n === 2 && trackCc.done7 === true && trackCc.add === true
    && trackDone8 === true && ccDay && ccDay['8'] === true
    && preDel.n === 2 && preDel.done[0] === true
    && afterDel.n === 1 && afterDel.txt[0] === '多写 1 条笔记' && afterDel.done[0] === true
    && afterDel.d7 === true && afterDel.d8 === false
    && JSON.stringify(custom3) === '["多写 1 条笔记"]'
    && migrated && migrated['7'] === true && migrated['8'] === undefined
    && overToast.includes('最多 10 条') && custom5.length === 10;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
