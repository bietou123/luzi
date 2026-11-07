#!/usr/bin/env node
/** CDP 验证 v2.9.0：累计净赚里程碑奖励（¥100+20/¥500+60...）+ 我的页进度条 + 防重 */
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
  const st = async () => await ev(`(function(){ var s=JSON.parse(localStorage.getItem('luzi_app_v1')); return { coins:s.coins, er:s.earnRewards||[], net:s.records.reduce((a,r)=>a+(r.type==='in'?r.amount:-r.amount),0) }; })()`);
  const addMoney = async (amt) => { await click('.add-money-btn[data-addmoney]'); await sleep(300); await ev(`(() => { const i=document.querySelector('#money-amount'); if(i){i.value=${amt};} const n=document.querySelector('#money-note'); if(n){n.value='里程碑测试';} return 'ok'; })()`); await click('[data-save]'); await sleep(500); };

  // ① 种子净赚80 → 记+30 → 110 → ¥100里程碑 +20
  await ev(`(function(){
    function fmt(x){ var p=function(n){return n<10?'0'+n:String(n);}; return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate()); }
    var d=fmt(new Date());
    localStorage.setItem('luzi_seen_onboard','1');
    localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[{id:'a1',routeId:'d002',title:'简历精修',amount:50,type:'in',note:'',date:d},{id:'a2',routeId:'s002',title:'Excel代做',amount:30,type:'in',note:'',date:d}], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] }));
    return 'ok';
  })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  await ev(`location.hash='records'; 'ok'`);
  await sleep(700);
  await addMoney(30);
  const s1 = await st();
  console.log('①净赚110:', JSON.stringify(s1));

  // ② 再记+500 → 610 → ¥500里程碑 +60
  await addMoney(500);
  const s2 = await st();
  console.log('②净赚610:', JSON.stringify(s2));

  // ③ 我的页收入里程碑进度条（距¥1000 +120，绿色条）
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(900);
  const r3 = await ev(`(() => { const m = document.querySelector('.streak-ms'); if (!m) return { exists:false }; return { top: (m.querySelector('.ms-top')||{}).textContent || '', fill: (m.querySelector('.ms-fill.earn')||{}).style.width || '', earn: !!m.querySelector('.ms-fill.earn') }; })()`);
  console.log('③我的页里程碑条:', JSON.stringify(r3));

  // ④ reload 防重：coins 不重发
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2200);
  const s4 = await st();
  console.log('④reload防重:', JSON.stringify(s4));

  // ⑤ 空态：净赚0 → 我的页无收入里程碑条
  await ev(`(function(){ localStorage.setItem('luzi_app_v1', JSON.stringify({ checkin:{}, streak:0, lastCheckin:'', coins:0, liked:{}, checks:{}, records:[], reviews:{}, badges:{}, activeBadge:'', streakRewards:[], reviewRewarded:{}, earnRewards:[], tasks:['t1','t2','t3','t4','t5','t6','t7'], coinLog:[] })); return 'ok'; })()`);
  await ev(`location.hash='home'; location.reload(); 'ok'`);
  await sleep(2000);
  await ev(`location.hash='mine'; 'ok'`);
  await sleep(800);
  const r5 = await ev(`(() => ({ hasMs: !!document.querySelector('.streak-ms') }))()`);
  console.log('⑤空态:', JSON.stringify(r5));

  const pass = s1.coins === 20 && s1.er.length === 1 && s1.er[0] === 100 && s1.net === 110
    && s2.coins === 80 && s2.er.length === 2 && s2.er[1] === 500 && s2.net === 610
    && !!r3.top && r3.top.includes('¥1,000') && r3.top.includes('+120') && r3.earn && r3.fill === '61%'
    && s4.coins === 80 && s4.er.length === 2
    && r5.hasMs === false;
  console.log(pass ? 'PASS ✅' : 'FAIL ❌');
  cdp.close(); process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('测试失败:', e.message); process.exit(2); });
