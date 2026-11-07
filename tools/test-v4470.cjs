#!/usr/bin/env node
/** CDP 验证 v4.48.0：省钱攻略模块（首页入口条 / 攻略库搜索筛选排序 / 资格状态机 / 省钱台账 / 编辑与月份 / 搜索历史 / 月度目标 / 本周活动 / 相关推荐 / 今日固定清单全清） */
'use strict';
const net = require('node:net'); const http = require('node:http'); const crypto = require('node:crypto');
const fs = require('node:fs'); const path = require('node:path');
const PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
const APP_ORIGIN = APP_URL.replace(/\/+$/, '');
const getJSON = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(JSON.parse(b))); }).on('error', rej); });

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
  // 只操作本项目测试页；找不到就报错，绝不回退到用户正在浏览的其他页面
  const page = list.find((x) => x.type === 'page' && x.url.startsWith(APP_ORIGIN + '/'));
  if (!page) throw new Error(`端口 ${PORT} 上没有找到 ${APP_URL} 测试页，检查无头 Chrome 是否已打开该地址`);
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
  const r1s = await ev(`(() => {
    const s = document.querySelector('.hd-stats');
    return { txt: s ? s.textContent.replace(/\\s+/g, ' ').trim() : '', saved: (s && s.querySelectorAll('.hd-stat')[1]) ? s.querySelectorAll('.hd-stat')[1].textContent.replace(/\\s+/g, ' ').trim() : '' };
  })()`);
  check('首页顺手省合计 + 本月已省', /5 分钟内的\s*\d+\s*条\s*¥\d+/.test(r1s.txt) && /本月已省\s*¥0$/.test(r1s.saved), r1s);

  // 2. 点「全部攻略」进攻略库
  await ev(`(() => { const m=document.querySelector('[data-deal-more]'); if(m) m.click(); return !!m; })()`);
  await sleep(900);
  const r2 = await ev(`(() => {
    const cards = document.querySelectorAll('.deal-card');
    return { view: (location.hash||''), cards: cards.length, filters: document.querySelectorAll('[data-deal-filter]').length, sorts: document.querySelectorAll('[data-deal-sort]').length, hasSearch: !!document.querySelector('#deal-search-input'), hasSummary: !!document.querySelector('.save-summary') };
  })()`);
  check('攻略库渲染（46 条全量）', r2.cards === 46 && r2.filters === 15 && r2.sorts === 4 && r2.hasSearch && r2.hasSummary, r2);

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

  // 10.5 编辑台账记录（v4.48 R1）
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const d = new Date();
    const ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    st.dealLog = [{ id:'edit-test', dealId:'', title:'省钱', amount:8, note:'原备注', date:ds }];
    st.coins = 0;
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.hash='saveRecords'; location.reload(); return 'ok';
  })()`);
  await sleep(4000);
  await ev(`(() => { const e=document.querySelector('[data-deal-edit]'); if(e) e.click(); return !!e; })()`);
  await sleep(600);
  const r10e = await ev(`(() => {
    const h = document.querySelector('.modal-sheet h3');
    const amt = document.querySelector('#deal-log-amount');
    const note = document.querySelector('#deal-log-note');
    const dt = document.querySelector('#deal-log-date');
    return { hasSheet: !!document.querySelector('.modal-mask'), title: h ? h.textContent.trim() : '', amt: amt ? amt.value : null, note: note ? note.value : null, date: dt ? dt.value : null };
  })()`);
  check('编辑弹窗预填原记录', r10e.hasSheet && /修改/.test(r10e.title) && r10e.amt === '8' && r10e.note === '原备注' && /^\d{4}-\d{2}-\d{2}$/.test(r10e.date || ''), r10e);
  await ev(`(() => {
    const amt=document.querySelector('#deal-log-amount'); amt.value='12';
    const note=document.querySelector('#deal-log-note'); note.value='改过的备注';
    document.querySelector('[data-save]').click(); return 'ok';
  })()`);
  await sleep(900);
  const r10f = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const x = (st.dealLog||[])[0] || {};
    return { logs: (st.dealLog||[]).length, amt: x.amount, note: x.note, coins: st.coins, rowAmt: document.querySelector('.sr-amt') ? document.querySelector('.sr-amt').textContent.trim() : '' };
  })()`);
  check('编辑保存（不重复发金币）', r10f.logs === 1 && r10f.amt === 12 && r10f.note === '改过的备注' && r10f.coins === 0 && r10f.rowAmt === '¥12', r10f);

  // 10.6 台账月份筛选（v4.48 R2）
  const prevYm = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const d = new Date();
    const ym = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const ds = ym+'-'+String(d.getDate()).padStart(2,'0');
    const pd = new Date(d.getFullYear(), d.getMonth()-1, 15);
    const pym = pd.getFullYear()+'-'+String(pd.getMonth()+1).padStart(2,'0');
    st.dealLog = [
      { id:'m1', dealId:'', title:'本月记录', amount:30, note:'', date:ds },
      { id:'p1', dealId:'', title:'上月记录', amount:50, note:'', date:pym+'-15' }
    ];
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.hash='saveRecords'; location.reload(); return pym;
  })()`);
  await sleep(4000);
  const r2m = await ev(`(() => ({
    rows: document.querySelectorAll('.save-row').length,
    total: document.querySelector('.st-main') ? document.querySelector('.st-main').textContent.trim() : '',
    chips: document.querySelectorAll('[data-save-month]').length,
    active: document.querySelector('[data-save-month].active') ? document.querySelector('[data-save-month].active').dataset.saveMonth : ''
  }))()`);
  check('台账默认只看本月', r2m.rows === 1 && r2m.total.includes('30') && r2m.chips === 7 && r2m.active !== 'all', r2m);
  await ev(`(() => { const c=document.querySelector('[data-save-month="all"]'); if(c) c.click(); return !!c; })()`);
  await sleep(600);
  const r2all = await ev(`(() => ({
    rows: document.querySelectorAll('.save-row').length,
    total: document.querySelector('.st-main') ? document.querySelector('.st-main').textContent.trim() : '',
    top: document.querySelectorAll('.stp-row').length
  }))()`);
  check('台账切到全部', r2all.rows === 2 && r2all.total.includes('80') && r2all.top === 2, r2all);
  await ev(`(() => { const c=document.querySelector('[data-save-month="${prevYm}"]'); if(c) c.click(); return !!c; })()`);
  await sleep(600);
  const r2prev = await ev(`(() => ({
    rows: document.querySelectorAll('.save-row').length,
    total: document.querySelector('.st-main') ? document.querySelector('.st-main').textContent.trim() : '',
    title: document.querySelector('.sr-title') ? document.querySelector('.sr-title').textContent.trim() : ''
  }))()`);
  check('台账切到上月', r2prev.rows === 1 && r2prev.total.includes('50') && r2prev.title === '上月记录', r2prev);

  // 10.7 详情页「我在这条已省多少」（v4.48 R3）
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    st.dealLog = []; st.dealRewarded = [];
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.hash='deals'; location.reload(); return 'ok';
  })()`);
  await sleep(4000);
  await ev(`(() => { const c=document.querySelector('.deal-card'); if(c) c.click(); return !!c; })()`);
  await sleep(800);
  const d3a = await ev(`(() => ({
    hasMine: !!document.querySelector('.deal-mine-card'),
    btn: document.querySelector('[data-deal-log]') ? document.querySelector('[data-deal-log]').textContent.trim() : ''
  }))()`);
  check('详情页初始无省钱统计', !d3a.hasMine && d3a.btn.includes('记一笔省下的钱'), d3a);

  await ev(`(() => { document.querySelector('[data-deal-log]').click(); return 'ok'; })()`);
  await sleep(600);
  await ev(`(() => { const q=document.querySelector('[data-quick-amt="20"]'); if(q) q.click(); document.querySelector('[data-save]').click(); return 'ok'; })()`);
  await sleep(1000);
  const d3b = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const card = document.querySelector('.deal-mine-card');
    return {
      logs: (st.dealLog||[]).length,
      dealId: (st.dealLog||[])[0] ? st.dealLog[0].dealId : '',
      hasCard: !!card,
      main: card ? card.querySelector('.dmc-main').textContent.trim() : '',
      sub: card ? card.querySelector('.dmc-sub').textContent.trim() : '',
      btn: document.querySelector('[data-deal-log]') ? document.querySelector('[data-deal-log]').textContent.trim() : ''
    };
  })()`);
  check('详情页显示已省金额', d3b.logs === 1 && !!d3b.dealId && d3b.hasCard && d3b.main.includes('¥20') && d3b.sub.includes('1 次记录') && d3b.btn.includes('再记一笔'), d3b);

  await ev(`(() => { document.querySelector('[data-deal-log]').click(); return 'ok'; })()`);
  await sleep(600);
  await ev(`(() => {
    const a=document.querySelector('#deal-log-amount'); if(a) a.value='15';
    document.querySelector('[data-save]').click(); return 'ok';
  })()`);
  await sleep(1000);
  const d3c = await ev(`(() => {
    const card = document.querySelector('.deal-mine-card');
    return { main: card ? card.querySelector('.dmc-main').textContent.trim() : '', sub: card ? card.querySelector('.dmc-sub').textContent.trim() : '' };
  })()`);
  check('详情页累计两条记录', d3c.main.includes('¥35') && d3c.sub.includes('2 次记录'), d3c);




  // 10.8 搜索历史与分场景空态（v4.48 R4）
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    st.dealSearchHist = []; st.dealLiked = {};
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.hash='deals'; location.reload(); return 'ok';
  })()`);
  await sleep(4000);
  await ev(`(() => { const i=document.querySelector('#deal-search-input'); i.value='话费'; i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`);
  await sleep(1300);
  const d4a = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    return { hist: st.dealSearchHist || [], hasClear: !!document.querySelector('.sb-clear'), cards: document.querySelectorAll('.deal-card').length };
  })()`);
  check('搜索后记入历史', d4a.hist[0] === '话费' && d4a.hasClear && d4a.cards > 0 && d4a.cards < 46, d4a);

  await ev(`(() => { const c=document.querySelector('[data-deal-search-clear]'); if(c) c.click(); return !!c; })()`);
  await sleep(700);
  const d4b = await ev(`(() => ({
    bar: !!document.querySelector('.search-hist'),
    chips: [...document.querySelectorAll('[data-deal-hist]')].map(c => c.textContent.trim()),
    cards: document.querySelectorAll('.deal-card').length
  }))()`);
  check('清空后显示最近搜索', d4b.bar && d4b.chips.includes('话费') && d4b.cards === 46, d4b);

  await ev(`(() => { const c=[...document.querySelectorAll('[data-deal-hist]')].find(x => x.textContent.trim()==='话费'); if(c) c.click(); return !!c; })()`);
  await sleep(700);
  const d4c = await ev(`(() => ({ val: document.querySelector('#deal-search-input') ? document.querySelector('#deal-search-input').value : null, cards: document.querySelectorAll('.deal-card').length }))()`);
  check('点历史 chip 回填搜索', d4c.val === '话费' && d4c.cards > 0 && d4c.cards < 46, d4c);

  await ev(`(() => { const i=document.querySelector('#deal-search-input'); i.value='zzzzzz'; i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; })()`);
  await sleep(700);
  const d4d = await ev(`(() => {
    const btn = document.querySelector('.empty-btn');
    return { hasEmpty: !!document.querySelector('.empty'), btn: btn ? btn.textContent.trim() : '', cards: document.querySelectorAll('.deal-card').length };
  })()`);
  check('搜索无结果空态', d4d.hasEmpty && d4d.btn.includes('清空搜索') && d4d.cards === 0, d4d);

  await ev(`(() => { const b=document.querySelector('.empty-btn'); if(b) b.click(); return !!b; })()`);
  await sleep(700);
  const d4e = await ev(`(() => ({ cards: document.querySelectorAll('.deal-card').length, val: document.querySelector('#deal-search-input') ? document.querySelector('#deal-search-input').value : null }))()`);
  check('空态按钮清空搜索', d4e.cards === 46 && d4e.val === '', d4e);

  await ev(`(() => { const c=document.querySelector('[data-deal-filter="liked"]'); if(c) c.click(); return !!c; })()`);
  await sleep(700);
  const d4f = await ev(`(() => {
    const btn = document.querySelector('.empty-btn');
    const t = document.querySelector('.e-text');
    return { empty: !!document.querySelector('.empty'), txt: t ? t.textContent : '', btn: btn ? btn.textContent.trim() : '' };
  })()`);
  check('收藏为空空态', d4f.empty && d4f.txt.includes('还没有收藏') && d4f.btn.includes('全部'), d4f);
  await ev(`(() => { const b=document.querySelector('.empty-btn'); if(b) b.click(); return !!b; })()`);
  await sleep(600);


  // 10.9 本月省钱目标（v4.48 R5）
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    const d = new Date();
    const ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    st.dealLog = [{ id:'g1', dealId:'', title:'本月省钱', amount:30, note:'', date:ds }];
    st.dealSaveGoal = 100; st.dealSaveGoalCelebrated = ''; st.coins = 0; st.dealSearchHist = [];
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.hash='saveRecords'; location.reload(); return 'ok';
  })()`);
  await sleep(4000);
  const d5a = await ev(`(() => {
    const c = document.querySelector('.deal-goal-card');
    const bar = c ? c.querySelector('.dgc-bar i') : null;
    return { card: !!c, nums: c && c.querySelector('.dgc-nums') ? c.querySelector('.dgc-nums').textContent.trim() : '', sub: c && c.querySelector('.dgc-sub') ? c.querySelector('.dgc-sub').textContent.trim() : '', width: bar ? bar.style.width : '', done: c ? c.classList.contains('done') : false };
  })()`);
  check('目标卡显示进度', d5a.card && d5a.nums.includes('30') && d5a.nums.includes('100') && d5a.sub.includes('还差') && d5a.sub.includes('70') && d5a.width === '30%' && !d5a.done, d5a);

  await ev(`(() => { const b=document.querySelector('[data-deal-goal]'); if(b) b.click(); return !!b; })()`);
  await sleep(600);
  const d5b = await ev(`(() => ({
    sheet: !!document.querySelector('.modal-mask'),
    presets: document.querySelectorAll('[data-goal-preset]').length,
    val: document.querySelector('#deal-goal-input') ? document.querySelector('#deal-goal-input').value : ''
  }))()`);
  check('目标设置弹窗', d5b.sheet && d5b.presets === 4 && d5b.val === '100', d5b);

  await ev(`(() => { const p=document.querySelector('[data-goal-preset="50"]'); if(p) p.click(); document.querySelector('[data-save]').click(); return 'ok'; })()`);
  await sleep(1000);
  const d5c = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1')||'{}');
    const c = document.querySelector('.deal-goal-card');
    return { goal: st.dealSaveGoal, width: c ? c.querySelector('.dgc-bar i').style.width : '', sub: c ? c.querySelector('.dgc-sub').textContent.trim() : '', coins: st.coins };
  })()`);
  check('调低目标后进度更新', d5c.goal === 50 && d5c.width === '60%' && d5c.sub.includes('还差') && d5c.coins === 0, d5c);

  await ev(`(() => { document.querySelector('[data-deal-goal]').click(); return 'ok'; })()`);
  await sleep(600);
  await ev(`(() => { const i=document.querySelector('#deal-goal-input'); i.value='10'; document.querySelector('[data-save]').click(); return 'ok'; })()`);
  await sleep(1200);
  const d5d = await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1')||'{}');
    const c = document.querySelector('.deal-goal-card');
    return { goal: st.dealSaveGoal, coins: st.coins, celebrated: st.dealSaveGoalCelebrated, done: c ? c.classList.contains('done') : false, sub: c ? c.querySelector('.dgc-sub').textContent.trim() : '' };
  })()`);
  check('达成目标 +50 金币', d5d.goal === 10 && d5d.coins === 50 && !!d5d.celebrated && d5d.done && d5d.sub.includes('已达成'), d5d);

  await ev(`(() => { const b=document.querySelector('.page-head [data-deal-log]'); if(b) b.click(); return !!b; })()`);
  await sleep(600);
  await ev(`(() => { const a=document.querySelector('#deal-log-amount'); a.value='5'; document.querySelector('[data-save]').click(); return 'ok'; })()`);
  await sleep(1200);
  const d5e = await ev(`(() => { const st=JSON.parse(localStorage.getItem('luzi_app_v1')||'{}'); return { coins: st.coins, celebrated: st.dealSaveGoalCelebrated }; })()`);
  check('目标奖励每月只发一次', d5e.coins === 50, d5e);

  // 10.9b 首页显示本月目标进度（v4.48 R7）
  await ev(`(() => { location.hash='home'; return 'ok'; })()`);
  await sleep(900);
  const d7a = await ev(`(() => {
    const s=document.querySelectorAll('.hd-stats .hd-stat');
    return { stats: s.length, saved: s[1] ? s[1].textContent.replace(/\\s+/g,' ').trim() : '', ok: !!document.querySelector('.hd-stat.ok'), done: !!document.querySelector('.hd-goal-ok') };
  })()`);
  check('首页显示本月目标进度', d7a.stats === 2 && /\/10/.test(d7a.saved) && d7a.ok && d7a.done, d7a);

  // 10.9c 详情页相关推荐（v4.48 R8）
  await ev(`(() => { location.hash='home'; return 'ok'; })()`);
  await sleep(600);
  await ev(`(() => { const c=document.querySelector('[data-deal-open]'); if(c) c.click(); return !!c; })()`);
  await sleep(900);
  const d8a = await ev(`(() => {
    const w=document.querySelector('.deal-related');
    const items=[...document.querySelectorAll('.dr-item')];
    return { has:!!w, n:items.length, ids:items.map(x=>x.dataset.dealOpen), head: w?w.querySelector('.dr-head').textContent.trim():'', firstTitle: items[0] ? items[0].querySelector('.dr-title').textContent.replace('已用完','').trim() : '', curTitle: (document.querySelector('.detail-title')||{}).textContent || '' };
  })()`);
  check('详情页相关推荐', d8a.has && d8a.n === 3 && new Set(d8a.ids).size === 3, d8a);
  const relTarget = (d8a.ids || [])[0];
  await ev(`(() => { const it=document.querySelector('.dr-item'); if(it) it.click(); return !!it; })()`);
  await sleep(900);
  const d8b = await ev(`(() => ({ hash: location.hash, hasRelated: !!document.querySelector('.deal-related'), title: (document.querySelector('.detail-title')||{}).textContent || '' }))()`);
  check('相关推荐可跳转', !!relTarget && d8b.hasRelated && d8b.title === d8a.firstTitle && d8b.title !== d8a.curTitle, { target: relTarget, firstTitle: d8a.firstTitle, curTitle: d8a.curTitle, ...d8b });

  // 10.9d 今日固定清单进度 + 全清奖励（v4.48 R9）
  const dealsSrc = fs.readFileSync(path.join(__dirname, '..', 'src/data/deals.js'), 'utf8');
  const dealObjs = dealsSrc.split(/\n  \{\n/).slice(1).map(b => ({
    id: (b.match(/^    id: '([^']+)'/m) || [])[1],
    cycle: (b.match(/cycle: '([^']+)'/) || [])[1],
    wd: Number((b.match(/weekday: (\d+)/) || [])[1]),
    day: Number((b.match(/day: (\d+)/) || [])[1]),
  })).filter(x => x.id);
  const todayD = new Date();
  const fixedIds = dealObjs.filter(x => x.cycle === 'daily'
    || (x.cycle === 'weekly' && x.wd === todayD.getDay())
    || (x.cycle === 'monthly' && x.day === todayD.getDate())).map(x => x.id);

  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    st.dealStatus = {}; st.coins = 0; st.dealDayCleared = '';
    ${JSON.stringify(fixedIds.slice(0, 3))}.forEach(id => st.dealStatus[id] = 'used');
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.hash='deals'; location.reload(); return 'ok';
  })()`);
  await sleep(4000);
  const d9a = await ev(`(() => {
    const c=document.querySelector('.deal-day-card');
    return { has:!!c, num: c?c.querySelector('.ddc-num').textContent.trim():'', sub: c?c.querySelector('.ddc-sub').textContent.trim():'', width: c?c.querySelector('.ddc-bar i').style.width:'' };
  })()`);
  check('今日固定清单进度', d9a.has && d9a.num === `3 / ${fixedIds.length}` && d9a.sub.includes('还差'), { expected: `3 / ${fixedIds.length}`, ...d9a });

  const lastFixed = fixedIds[fixedIds.length - 1];
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    st.dealStatus = {}; st.coins = 0; st.dealDayCleared = '';
    ${JSON.stringify(fixedIds.slice(0, -1))}.forEach(id => st.dealStatus[id] = 'used');
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.hash='deals'; location.reload(); return 'ok';
  })()`);
  await sleep(4000);
  await ev(`(() => { const c=document.querySelector('[data-deal-open="${lastFixed}"]'); if(!c) return 'no-card'; c.click(); return 'ok'; })()`);
  await sleep(900);
  await ev(`(() => { const b=document.querySelector('[data-deal-status="${lastFixed}"][data-st="used"]'); if(b) b.click(); return 'ok'; })()`);
  await sleep(1200);
  const d9b = await ev(`(() => { const st=JSON.parse(localStorage.getItem('luzi_app_v1')||'{}'); const t=new Date(); const today=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); return { coins: st.coins, cleared: st.dealDayCleared, today }; })()`);
  check('全清固定清单 +100 金币', d9b.coins === 100 && d9b.cleared === d9b.today, d9b);

  await ev(`(() => { location.hash='home'; return 'ok'; })()`);
  await sleep(400);
  await ev(`(() => { location.hash='deals'; return 'ok'; })()`);
  await sleep(800);
  const d9c = await ev(`(() => {
    const c=document.querySelector('.deal-day-card');
    return { done: c?c.classList.contains('done'):false, num: c?c.querySelector('.ddc-num').textContent.trim():'', sub: c?c.querySelector('.ddc-sub').textContent.trim():'', width: c?c.querySelector('.ddc-bar i').style.width:'' };
  })()`);
  check('全清后进度卡满格', d9c.done && d9c.num === `${fixedIds.length} / ${fixedIds.length}` && d9c.sub.includes('全清'), d9c);

  // 取消再标记一次，当天不重复发奖
  await ev(`(() => { const c=document.querySelector('[data-deal-open="${lastFixed}"]'); if(c) c.click(); return 'ok'; })()`);
  await sleep(800);
  await ev(`(() => { const b=document.querySelector('[data-deal-status="${lastFixed}"][data-st="used"]'); if(b) b.click(); return 'ok'; })()`);
  await sleep(700);
  await ev(`(() => { const b=document.querySelector('[data-deal-status="${lastFixed}"][data-st="used"]'); if(b) b.click(); return 'ok'; })()`);
  await sleep(900);
  const d9d = await ev(`(() => { const st=JSON.parse(localStorage.getItem('luzi_app_v1')||'{}'); return { coins: st.coins }; })()`);
  check('全清奖励每天只发一次', d9d.coins === 100, d9d);


  // 10.10 本周活动筛选（v4.48 R6）
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    st.dealStatus = {}; st.dealSearchHist = [];
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.hash='deals'; location.reload(); return 'ok';
  })()`);
  await sleep(4000);
  const d6a = await ev(`(() => {
    const c=document.querySelector('[data-deal-filter="week"]');
    return { chip: c ? c.textContent.trim() : '', filters: document.querySelectorAll('[data-deal-filter]').length };
  })()`);
  check('本周活动筛选入口', !!d6a.chip && /本周活动\s*\d+/.test(d6a.chip) && d6a.filters === 15, d6a);

  await ev(`(() => { document.querySelector('[data-deal-filter="week"]').click(); return 'ok'; })()`);
  await sleep(700);
  const d6b = await ev(`(() => {
    const cards = [...document.querySelectorAll('.deal-card')];
    const chips = [...document.querySelectorAll('.dc-when')].map(x => x.textContent.trim());
    return { cards: cards.length, hasWhen: chips.length === cards.length, ids: cards.map(c => c.dataset.dealOpen), chips, used: cards.filter(c => c.classList.contains('used')).length, active: !!document.querySelector('[data-deal-filter="week"].active') };
  })()`);
  const d6nums = (d6b.chips || []).map(t => t.includes('今天') ? 0 : parseInt(String(t).replace(/\D/g, ''), 10));
  const d6sorted = d6nums.every((n, i) => i === 0 || n >= d6nums[i - 1]);
  check('本周活动列表按天数排序', d6b.cards > 0 && d6b.hasWhen && d6b.used === 0 && d6b.active && d6sorted, { cards: d6b.cards, chips: d6b.chips.slice(0, 5), used: d6b.used });

  const firstWeekId = (d6b.ids || [])[0];
  await ev(`(() => {
    const st = JSON.parse(localStorage.getItem('luzi_app_v1') || '{}');
    st.dealStatus = st.dealStatus || {};
    st.dealStatus[${JSON.stringify(firstWeekId)}] = 'used';
    localStorage.setItem('luzi_app_v1', JSON.stringify(st));
    location.reload(); return 'ok';
  })()`);
  await sleep(4000);
  await ev(`(() => { document.querySelector('[data-deal-filter="week"]').click(); return 'ok'; })()`);
  await sleep(700);
  const d6c = await ev(`(() => ({ ids: [...document.querySelectorAll('.deal-card')].map(c=>c.dataset.dealOpen) }))()`);
  check('已用完的从本周活动移除', !d6c.ids.includes(firstWeekId), { removed: firstWeekId, left: d6c.ids.length });

  // 11. 收藏
  await ev(`(() => { location.hash='home'; return 'ok'; })()`);
  await sleep(300);
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
