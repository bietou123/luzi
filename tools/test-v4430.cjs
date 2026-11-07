#!/usr/bin/env node
/** CDP 验证 v4.43.0：路子对比工具（详情页⚖️对比→选一条已收藏/打卡/记过账的路子→两列对比表·金色高亮更优） */
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
  const seed = async (extra) => await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify(Object.assign({ checkin:{}, streak:0, lastCheckin:'', coins:0, levelIdx:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[100,500,1000], tasks:['t1','t2','t3','t4','t5','t6'], coinLog:[], firstInCelebrated:true, execStreakRewards:[], customChecks:{}, achShown:[], achRewarded:[], weekGoal:0, weekGoalCelebrated:'', monthGoal:1000, challenges:{}, challengeRewarded:[], saveGoal:0, saveGoalCelebrated:false }, ${JSON.stringify(extra||{})}))); location.hash='home'; location.reload(); return 'ok'; })()`);

  // 预热：收藏 d001/d002 作为对比候选
  await seed({ liked: { d001: 1000, d002: 2000 } });
  await sleep(4000);

  // 场景 1：库页点 d001 进详情 → action-row 有 ⚖️ 对比按钮
  await ev(`(() => { location.hash='library'; return 'ok'; })()`);
  await sleep(1500);
  await ev(`(() => { const c=document.querySelector('[data-open="d001"]'); if(c) c.click(); return !!c; })()`);
  await sleep(1500);
  const r1 = await ev(`(() => { const b=document.querySelector('[data-compare]'); return b ? { id: b.dataset.compare, txt: b.textContent.trim() } : null; })()`);
  console.log('1按钮:', JSON.stringify(r1));
  const ok1 = r1 && r1.id === 'd001' && r1.txt.includes('对比');

  // 场景 2：点对比 → 弹窗（标题/当前路子卡/候选含 d002/底部按钮隐藏）
  await ev(`(() => { document.querySelector('[data-compare]').click(); return 'ok'; })()`);
  await sleep(500);
  const r2 = await ev(`(() => {
    const s=document.querySelector('.compare-sheet'); if(!s) return null;
    return { h3: (s.querySelector('h3')||{}).textContent?.trim(),
      cur: (s.querySelector('.cmp-cur .cmp-ctitle')||{}).textContent?.trim(),
      picks: [...s.querySelectorAll('.cmp-pick')].map(p=>p.dataset.cmpPick),
      hint: (s.querySelector('.cmp-hint')||{}).textContent?.trim(),
      footShown: (s.querySelector('.cmp-foot')||{}).classList?.contains('show') };
  })()`);
  console.log('2弹窗:', JSON.stringify(r2));
  const ok2 = r2 && r2.h3 === '⚖️ 路子对比' && r2.cur && r2.picks.includes('d002') && r2.footShown === false;

  // 场景 3：点选 d002 → 高亮 on + ✓ + 开始对比按钮出现
  await ev(`(() => { const p=document.querySelector('[data-cmp-pick="d002"]'); if(p) p.click(); return !!p; })()`);
  await sleep(300);
  const r3 = await ev(`(() => {
    const s=document.querySelector('.compare-sheet');
    const sel=s.querySelector('.cmp-pick.on');
    return { selId: sel ? sel.dataset.cmpPick : null,
      check: sel ? (sel.querySelector('.cmp-pcheck')||{}).textContent?.trim() : null,
      start: (s.querySelector('[data-cmp-start]')||{}).textContent?.trim(),
      footShown: (s.querySelector('.cmp-foot')||{}).classList?.contains('show') };
  })()`);
  console.log('3选中:', JSON.stringify(r3));
  const ok3 = r3 && r3.selId === 'd002' && r3.check === '✓' && r3.start && r3.footShown === true;

  // 场景 4：开始对比 → 两列表（标题/行标签/金色高亮/tip/换一条按钮）
  await ev(`(() => { document.querySelector('[data-cmp-start]').click(); return 'ok'; })()`);
  await sleep(300);
  const r4 = await ev(`(() => {
    const s=document.querySelector('.compare-sheet');
    const tbl=s.querySelector('.cmp-tbl'); if(!tbl) return null;
    const titles=[...tbl.querySelectorAll('.cmp-ctitle')].map(x=>x.textContent.trim());
    const labels=[...tbl.querySelectorAll('.cmp-tk')].map(x=>x.textContent.trim());
    return { titles, labels, wins: tbl.querySelectorAll('.cmp-tc.win').length,
      tip: (s.querySelector('.cmp-tip')||{}).textContent?.trim(),
      hasBack: !!s.querySelector('[data-cmp-back]') };
  })()`);
  console.log('4对比表:', JSON.stringify(r4));
  const need = ['分类','上手难度','启动资金','回本周期','月收入潜力','为什么能赚'];
  const ok4 = r4 && r4.titles.length === 2 && r4.titles.every(t => t && t.length) && need.every(l => r4.labels.includes(l)) && r4.wins > 0 && r4.hasBack === true;

  // 场景 5：换一条 → 返回候选列表
  await ev(`(() => { document.querySelector('[data-cmp-back]').click(); return 'ok'; })()`);
  await sleep(300);
  const r5 = await ev(`(() => { const s=document.querySelector('.compare-sheet'); return { hasList: !!s.querySelector('[data-cmp-list]'), picks: s.querySelectorAll('.cmp-pick').length }; })()`);
  console.log('5换一条:', JSON.stringify(r5));
  const ok5 = r5 && r5.hasList === true && r5.picks >= 1;

  // 场景 6：关闭弹窗
  await ev(`(() => { const c=document.querySelector('.compare-sheet [data-close]'); if(c) c.click(); return !!c; })()`);
  await sleep(300);
  const r6 = await ev(`(() => !!document.querySelector('.compare-sheet'))()`);
  console.log('6关闭:', JSON.stringify({ gone: r6 }));
  const ok6 = r6 === false;

  const pass = ok1 && ok2 && ok3 && ok4 && ok5 && ok6;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
