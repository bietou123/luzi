#!/usr/bin/env node
/** CDP 验证 v3.7.0：我的页近6月收支趋势卡（收入/支出双柱 + 月份标签 + 月净额 + 图例） */
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

  // 今天 2026-08-10 → 近6月 = 03,04,05,06,07,08
  // 记录：08月 in100 / 07月 in500+out100 / 06月 in300 / 04月 in200 / 03月 05月 无
  const seed = async (withRecords) => {
    const records = withRecords ? [
      { id:'a',routeId:'',title:'R',amount:100,type:'in',note:'',date:'2026-08-10' },
      { id:'b',routeId:'',title:'R',amount:500,type:'in',note:'',date:'2026-07-20' },
      { id:'c',routeId:'',title:'R',amount:100,type:'out',note:'',date:'2026-07-15' },
      { id:'d',routeId:'',title:'R',amount:300,type:'in',note:'',date:'2026-06-08' },
      { id:'e',routeId:'',title:'R',amount:200,type:'in',note:'',date:'2026-04-12' },
    ] : [];
    await ev(`(function(){ localStorage.setItem('luzi_seen_onboard','1'); localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:${JSON.stringify(records)}, reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], firstInCelebrated:false })); return 'ok'; })()`);
  };
  const trend = async () => await ev(`(() => { const c = document.querySelector('.trend-card'); if(!c) return null; const cols=[...document.querySelectorAll('.trend-col')].map(x=>({ ym:x.dataset.ym, cur:x.classList.contains('cur'), label:(x.querySelector('.trend-label')||{}).textContent, amt:(x.querySelector('.trend-amt')||{}).textContent, ih:(x.querySelector('.trend-bar.inc')||{}).style.height, oh:(x.querySelector('.trend-bar.out')||{}).style.height })); return { head:(document.querySelector('.td-head')||{}).textContent, cols, legend:(document.querySelector('.trend-legend')||{}).textContent }; })()`);

  // 场景 A：有记录 → 卡片 6 柱
  await seed(true);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const a = await trend();
  console.log('A(有记录):', JSON.stringify(a));

  // 场景 B：无记录 → 无卡片
  await seed(false);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const b = await trend();
  console.log('B(无记录):', JSON.stringify(b));

  const expect = (ym, { inc, out, label, amt }) => { const m = a.cols.find(x => x.ym === ym); return m && m.label === label && m.amt === amt && m.ih === `${inc}px` && m.oh === `${out}px`; };
  // max=500, h=62: 03月 in0→2 out0→2 / 04月 in200→round(200/500*62)=25 out0→2 / 05月 2,2 / 06月 in300→37 out0→2 / 07月 in500→62 out100→round(12.4)=12 / 08月 in100→round(12.4)=12 out0→2
  const pass = a && a.cols.length === 6
    && a.cols[5].cur === true && a.cols[0].cur === false
    && expect('2026-03', { inc:2, out:2, label:'3月', amt:'—' })
    && expect('2026-04', { inc:25, out:2, label:'4月', amt:'¥200' })
    && expect('2026-05', { inc:2, out:2, label:'5月', amt:'—' })
    && expect('2026-06', { inc:37, out:2, label:'6月', amt:'¥300' })
    && expect('2026-07', { inc:62, out:12, label:'7月', amt:'¥400' })
    && expect('2026-08', { inc:12, out:2, label:'8月', amt:'¥100' })
    && a.head.includes('近6月') && a.legend.includes('收入') && a.legend.includes('支出')
    && b === null;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
