#!/usr/bin/env node
/** CDP 验证 v4.47.0：省钱攻略模块（首页入口条 / 攻略库搜索筛选排序 / 详情资格状态机 / 记一笔省钱台账） */
'use strict';
const net = require('node:net'); const http = require('node:http'); const crypto = require('node:crypto');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: 9222, path: p }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b))); }).on('error', rej); });

function connect(wsUrl) {
  const u = new URL(wsUrl); const sock = net.connect(Number(u.port), u.hostname);
  const handlers = new Map(); const events = []; let id = 0, buf = Buffer.alloc(0), open = false;
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
        const s = buf.subarray(off, off + len).toString('utf8');
        buf = buf.subarray(off + len);
        let m; try { m = JSON.parse(s); } catch { continue; }
        if (m.id && handlers.has(m.id)) { handlers.get(m.id)(m); handlers.delete(m.id); }
        else if (m.method) events.push(m);
      }
    });
  });
  const frame = (text) => {
    const d = Buffer.from(text, 'utf8'); const mask = crypto.randomBytes(4); let h;
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
  return { send, events, close: () => sock.destroy() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await getJSON('/json');
  const page = list.find((x) => x.type === 'page' && /5173/.test(x.url)) || list.find((x) => x.type === 'page');
  if (!page) throw new Error('没有找到可调试的页面，检查 9222 是否已打开测试页');
  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };

  const seed = async (extra) => await ev(`(function(){
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({
      checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, reviewNotes:{},
      badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[100,500,1000], tasks:['t1','t2','t3','t4','t5','t6'],
      coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[],
      weekGoal:0, weekGoalCelebrated:'', monthGoal:1000, challenges:{}, challengeRewarded:[],
      saveGoal:0, saveGoalCelebrated:false,
      dealStatus:{}, dealLiked:{}, dealLog:[], dealRewarded:[], dealSearchHist:[]
    }, ${JSON.stringify(extra || {})})));
    location.hash='home'; location.reload(); return 'ok';
  })()`);

  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); };

  await seed({});
  await sleep(4000);

  // 1. 首页入口条
  const r1 = await ev(`(() => {
    const w = document.querySelector('.home-deals');
    return { has: !!w, chips: w ? w.querySelectorAll('.hd-chip').length : 0, more: w ? !!w.querySelector('[data-deal-more]') : false, head: w ? w.querySelector('.hd-head').textContent.trim() : '' };
  })()`);
  check('首页省钱入口条', r1.has && r1.chips > 0 && r1.more, r1);

  // 2. 点「全部攻略」进攻略库
  await ev(`(() => { const m=document.querySelector('[data-deal-more]'); if(m) m.click(); return !!m; })()`);
  await sleep(900);
  const r2 = await ev(`(() => {
    const cards = document.querySelectorAll('.deal-card');
    return { view: (location.hash||''), cards: cards.length, filters: document.querySelectorAll('[data-deal-filter]').length, sorts: document.querySelectorAll('[data-deal-sort]').length, hasSearch: !!document.querySelector('#deal-search-input'), hasSummary: !!document.querySelector('.save-summary') };
  })()`);
  check('攻略库渲染（46 条全量）', r2.cards === 46 && r2.filters === 14 && r2.sorts === 4 && r2.hasSearch && r2.hasSummary, r2);

  // 3. 搜索
  const r3 = await ev(`(() => {
    const i = document.querySelector('#deal-search-input');
    i.value = '外卖'; i.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(700);
  const r3b = await ev(`(() => {
    const cards = document.querySelectorAll('.deal-card');
    const texts = [...cards].map(c => (c.querySelector('.dc-title')||{}).textContent || '');
    const input = document.querySelector('#deal-search-input');
    return { cards: cards.length, focused: document.activeElement === input, allMatch: texts.every(t => t.includes('外卖') || t.includes('美团') || t.includes('饿了么')), first: texts[0] ? texts[0].trim() : '' };
  })()`);
  check('搜索「外卖」过滤 + 焦点保持', r3b.cards > 0 && r3b.cards < 46 && r3b.focused && r3b.allMatch, r3b);

  // 4. 清空搜索 + 今日可做筛选
  await ev(`(() => { const c=document.querySelector('[data-deal-search-clear]'); if(c) c.click(); return !!c; })()`);
  await sleep(500);
  const r4 = await ev(`(() => { const c=document.querySelector('[data-deal-filter="today"]'); if(c) c.click(); return !!c; })()`);
  await sleep(700);
  const r4b = await ev(`(() => {
    const cards = [...document.querySelectorAll('.deal-card')];
    return { count: cards.length, usedInList: cards.filter(c => c.classList.contains('used')).length, active: !!document.querySelector('[data-deal-filter="today"].active') };
  })()`);
  check('今日可做筛选（不含已用完）', r4b.count > 0 && r4b.usedInList === 0 && r4b.active, r4b);

  // 5. 进入详情
  await ev(`(() => { const c=document.querySelector('.deal-card'); if(c) c.click(); return !!c; })()`);
  await sleep(700);
  const r5 = await ev(`(() => {
    const t = document.querySelector('.detail-hero');
    const btns = document.querySelectorAll('[data-deal-status]');
    return { hasHero: !!t, title: t ? t.querySelector('.detail-title').textContent.trim() : '', statusBtns: btns.length, hasLogBtn: !!document.querySelector('[data-deal-log]'), steps: document.querySelectorAll('.deal-step').length, tips: !!document.querySelector('.deal-actions') };
  })()`);
  check('攻略详情页', r5.hasHero && r5.title.length > 0 && r5.statusBtns === 2 && r5.hasLogBtn && r5.steps > 0, r5);

  // 6. 标记「已用完」
  const r6a = await ev(`(() => { const b=document.querySelector('[data-deal-status][data-st="used"]'); if(b) b.click(); return !!b; })()`);
  await sleep(800);
  const r6 = await ev(`(() => {
    const cur = document.querySelector('.dsc-cur');
    const on = document.querySelector('[data-deal-status][data-st="used"]');
    return { cur: cur ? cur.textContent.trim() : null, onCls: on ? on.className : null };
  })()`);
  check('资格状态机：标记已用完', r6.cur === '已用完' && /on/.test(r6.onCls || ''), r6);

  // 7. 记一笔省钱
  await ev(`(() => { const b=document.querySelector('[data-deal-log]'); if(b) b.click(); return !!b; })()`);
  await sleep(600);
  const r7a = await ev(`(() => {
    const amt = document.querySelector('#deal-log-amount');
    const quick = document.querySelector('[data-quick-amt="20"]');
    if (quick) quick.click();
    return { hasSheet: !!document.querySelector('.modal-mask'), amt: amt ? amt.value : null, quickOn: quick ? quick.classList.contains('on') : false };
  })()`);
  check('记账弹窗 + 快捷金额', r7a.hasSheet && r7a.amt === '20' && r7a.quickOn, r7a);

  await ev(`(() => { const n=document.querySelector('#deal-log-note'); if(n) n.value='测试备注'; const s=document.querySelector('[data-save]'); if(s) s.click(); return !!s; })()`);
  await sleep(1200);
  const r7b = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    return { logs: (st.dealLog||[]).length, amt: (st.dealLog||[])[0] ? st.dealLog[0].amount : null, note: (st.dealLog||[])[0] ? st.dealLog[0].note : null, coins: st.coins, rewarded: (st.dealRewarded||[]).length, sheetGone: !document.querySelector('.modal-mask') };
  })()`);
  check('记账保存 + 首次 +5 金币', r7b.logs === 1 && r7b.amt === 20 && r7b.note === '测试备注' && r7b.coins >= 5 && r7b.rewarded === 1 && r7b.sheetGone, r7b);

  // 8. 台账页
  await ev(`(() => { location.hash='saveRecords'; return 'ok'; })()`);
  await sleep(900);
  const r8 = await ev(`(() => {
    const rows = document.querySelectorAll('.save-row');
    const total = document.querySelector('.st-main') ? document.querySelector('.st-main').textContent.trim() : '';
    return { rows: rows.length, total, hasTop: !!document.querySelector('.save-top'), amt: rows.length ? rows[0].querySelector('.sr-amt').textContent.trim() : '' };
  })()`);
  check('省钱台账页', r8.rows === 1 && r8.total.includes('20') && r8.hasTop && r8.amt === '¥20', r8);

  // 9. 我的页入口
  await ev(`(() => { location.hash='mine'; return 'ok'; })()`);
  await sleep(900);
  const r9 = await ev(`(() => {
    const items = [...document.querySelectorAll('.mine-item')];
    const deals = items.find(i => (i.getAttribute('data-go')||'') === 'deals');
    const logs = items.find(i => (i.getAttribute('data-go')||'') === 'saveRecords');
    return { hasDeals: !!deals, dealsVal: deals ? deals.querySelector('.mi-val').textContent.trim() : '', hasLogs: !!logs, logsVal: logs ? logs.querySelector('.mi-val').textContent.trim() : '' };
  })()`);
  check('我的页两个入口', r9.hasDeals && r9.dealsVal.includes('46') && r9.hasLogs && r9.logsVal.includes('20'), r9);

  // 10. 删除记录
  await ev(`(() => { location.hash='saveRecords'; return 'ok'; })()`);
  await sleep(800);
  await ev(`(() => { const d=document.querySelector('[data-deal-del]'); if(d) d.click(); return !!d; })()`);
  await sleep(500);
  const r10a = await ev(`(() => !!document.querySelector('[data-confirm-del]'))()`);
  await ev(`(() => { const b=document.querySelector('[data-confirm-del]'); if(b) b.click(); return !!b; })()`);
  await sleep(800);
  const r10 = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    return { confirmShown: ${!!r10a}, logs: (st.dealLog||[]).length, empty: !!document.querySelector('.empty') };
  })()`);
  check('删除省钱记录', r10.confirmShown === true && r10.logs === 0 && r10.empty === true, r10);

  // 11. 收藏
  await ev(`(() => { location.hash='deals'; return 'ok'; })()`);
  await sleep(800);
  await ev(`(() => { const h=document.querySelector('.dc-heart'); if(h) h.click(); return !!h; })()`);
  await sleep(500);
  const r11 = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const h = document.querySelector('.dc-heart');
    return { liked: Object.keys(st.dealLiked||{}).length, heartOn: h ? h.classList.contains('on') : false, heartTxt: h ? h.textContent : '' };
  })()`);
  check('收藏就地切换（不重绘）', r11.liked === 1 && r11.heartOn === true && r11.heartTxt === '♥', r11);

  // 12. JS 异常检查
  const errs = cdp.events
    .filter(m => m.method === 'Runtime.exceptionThrown')
    .map(m => m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || ''));
  check('无运行时异常', errs.length === 0, errs.slice(0, 3));

  const pass = results.every(r => r.ok);
  console.log(`\n${pass ? 'PASS ✅' : 'FAIL ❌'}  ${results.filter(r => r.ok).length}/${results.length}`);
  cdp.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
