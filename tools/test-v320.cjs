#!/usr/bin/env node
/** CDP 验证 v3.2.0：成就系统升级（11→15 项，新增净赚/执行/打卡纵深） */
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

  // 种子：达标态（应解锁全部 15 项）
  await ev(`(function(){
    function fmt(d){ var p=function(n){return n<10?'0'+n:String(n);}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
    var today=new Date();
    var checkin={}, reviews={}, checks={}, records=[], liked={}, routeVotes={};
    for (var i=0;i<30;i++){ var d=new Date(today); d.setDate(d.getDate()-i); checkin[fmt(d)]=1; }
    for (var i=0;i<10;i++){ var d=new Date(today); d.setDate(d.getDate()-i); reviews[fmt(d)]='done'; }
    for (var i=0;i<10;i++){ var d=new Date(today); d.setDate(d.getDate()-i); var ds=fmt(d); var c={}; for(var j=0;j<6;j++) c[j]=true; checks['d002::'+ds]=c; }
    records.push({id:'r1',routeId:'d002',title:'简历精修',amount:400,type:'in',note:'',date:fmt(today)});
    records.push({id:'r2',routeId:'s002',title:'Excel代做',amount:400,type:'in',note:'',date:fmt(today)});
    records.push({id:'r3',routeId:'c010',title:'探店',amount:200,type:'in',note:'',date:fmt(today)});
    records.push({id:'r4',routeId:'',title:'买材料',amount:100,type:'out',note:'',date:fmt(today)});
    for (var i=1;i<=5;i++) liked['d00'+i]=Date.now();
    routeVotes = { d001:'like', d002:'like', d003:'like', d004:'like', d005:'like', d006:'meh' };
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:checkin, streak:30, lastCheckin:fmt(today), coins:0, liked:liked, checks:checks, records:records, reviews:reviews, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], routeHistory:{}, routeSwapHistory:{}, routeVotes:routeVotes }));
    return 'ok';
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(900);
  const r1 = await ev(`(() => {
    const count = document.querySelector('.as-count');
    const names = [...document.querySelectorAll('.as-item .as-name')].map(x=>x.textContent);
    return { count: count ? count.textContent : null, total: document.querySelectorAll('.as-item').length, names, unlocked: document.querySelectorAll('.as-item:not(.locked)').length };
  })()`);
  console.log('①达标态:', JSON.stringify(r1));

  // 空态
  await ev(`(function(){ localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[], routeHistory:{}, routeSwapHistory:{}, routeVotes:{} })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2000);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const r2 = await ev(`(() => ({ count: (document.querySelector('.as-count')||{}).textContent||null, unlocked: document.querySelectorAll('.as-item:not(.locked)').length, total: document.querySelectorAll('.as-item').length }))()`);
  console.log('②空态:', JSON.stringify(r2));

  const newNames = ['净赚小成', '打卡铁人', '行动家', '雷打不动'];
  const pass = !!r1 && r1.count === '15/15' && r1.unlocked === 15 && r1.total === 15
    && newNames.every(n => r1.names.includes(n))
    && !!r2 && r2.count === '0/15' && r2.total === 15 && r2.unlocked === 0;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
