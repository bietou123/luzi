#!/usr/bin/env node
/**
 * make-icons.cjs —— 生成安卓启动图标
 *
 * 为什么用 Chrome 渲染：项目零第三方运行时依赖，不想为了几张 PNG 装图形库。
 * 本机已有 Chrome，用 CDP 截 SVG 是最省事且结果可预期的做法。
 *
 * 产出：
 *   mipmap-<density>/ic_launcher.png         传统方形图标（含底色）
 *   mipmap-<density>/ic_launcher_round.png   圆形图标
 *   mipmap-<density>/ic_launcher_foreground.png  自适应图标前景（透明底，图形限于中央 72/108 安全区）
 *   drawable/splash.png              启动图（如需要）
 *
 * 用法: node tools/make-icons.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(RES)) { console.error('android/ 还没生成，先跑 npx cap add android'); process.exit(1); }

const BG = '#0d0f16';      // app 深色金融风底色
const GOLD = '#f5b93c';    // 金色主调
const GOLD_HI = '#ffd97a'; // 金色高光

/** 「路」字：中文文本渲染，居中 —— 与 app 主题呼应（赚钱的路子） */
function luMark(cx, cy, size) {
  return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
    font-family="'Microsoft YaHei','微软雅黑',sans-serif" font-weight="700"
    font-size="${size}" fill="url(#g)">路</text>`;
}

const defs = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GOLD_HI}"/>
      <stop offset="1" stop-color="${GOLD}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="34%" r="62%">
      <stop offset="0" stop-color="${GOLD}" stop-opacity=".22"/>
      <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

/** 方形图标（含底色，四角圆角） */
const svgSquare = (S) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 108 108">
  ${defs}
  <rect width="108" height="108" rx="24" fill="${BG}"/>
  <rect width="108" height="108" rx="24" fill="url(#glow)"/>
  <rect x="1.5" y="1.5" width="105" height="105" rx="22.5" fill="none" stroke="${GOLD}" stroke-opacity=".3" stroke-width="1.6"/>
  ${luMark(54, 54, 56)}
</svg>`;

/** 圆形图标 */
const svgRound = (S) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 108 108">
  ${defs}
  <circle cx="54" cy="54" r="54" fill="${BG}"/>
  <circle cx="54" cy="54" r="54" fill="url(#glow)"/>
  <circle cx="54" cy="54" r="52.5" fill="none" stroke="${GOLD}" stroke-opacity=".3" stroke-width="1.6"/>
  ${luMark(54, 54, 52)}
</svg>`;

/**
 * 自适应图标前景：透明底，图形必须落在中央 72/108 的安全区内
 * （系统可能裁成圆、方、squircle 等任意形状，超出安全区会被切掉）
 */
const svgFg = (S) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 108 108">
  ${defs}
  ${luMark(54, 54, 56)}
</svg>`;

const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

// ── Chrome CDP（最小实现，和 tools/smoke.cjs 同一套） ──
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const CDP_PORT = 9444;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qigua-icon-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: p }, (r) => {
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

(async () => {
  for (let i = 0; i < 60; i++) { try { await getJSON('/json/list'); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
  const t = (await getJSON('/json/list')).find((x) => x.type === 'page');
  const cdp = connect(t.webSocketDebuggerUrl);
  await cdp.send('Page.enable');

  /** 把一段 SVG 渲染成指定像素的透明 PNG */
  async function render(svg, w, h, out) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const html = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style>${svg}`;
    await cdp.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
    await new Promise((r) => setTimeout(r, 120));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  }

  for (const [d, legacy, adaptive] of DENSITIES) {
    const dir = path.join(RES, `mipmap-${d}`);
    fs.mkdirSync(dir, { recursive: true });
    await render(svgSquare(legacy), legacy, legacy, path.join(dir, 'ic_launcher.png'));
    await render(svgRound(legacy), legacy, legacy, path.join(dir, 'ic_launcher_round.png'));
    await render(svgFg(adaptive), adaptive, adaptive, path.join(dir, 'ic_launcher_foreground.png'));
    console.log(`${d}: ic_launcher ${legacy}px · foreground ${adaptive}px`);
  }

  // 自适应图标的背景改成深底（Capacitor 默认给的是白色）
  fs.writeFileSync(
    path.join(RES, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
    'utf8'
  );
  // Capacitor 默认的矢量前景会盖掉我们生成的 PNG，删掉
  fs.rmSync(path.join(RES, 'drawable-v24', 'ic_launcher_foreground.xml'), { force: true });

  // 启动图：满幅竖屏深色底 + 金色「路」字 + 文案，避免透明圆角露出白底
  fs.mkdirSync(path.join(RES, 'drawable'), { recursive: true });
  // 删掉 Capacitor 默认的 per-density 启动图，避免更高优先级的 qualifier 盖住我们的深色启动图
  for (const sub of fs.readdirSync(RES)) {
    if (/^drawable-(port|land)-/.test(sub)) {
      fs.rmSync(path.join(RES, sub, 'splash.png'), { force: true });
    }
  }
  const SW = 540, SH = 1170; // 与 1080x2340 同比例
  const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">
  ${defs}
  <rect width="100%" height="100%" fill="${BG}"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  ${luMark(SW / 2, SH / 2 - 80, 190)}
  <text x="${SW / 2}" y="${SH / 2 + 150}" text-anchor="middle"
    font-family="'Microsoft YaHei','微软雅黑',sans-serif" font-weight="700"
    font-size="64" fill="${GOLD_HI}">路子</text>
  <text x="${SW / 2}" y="${SH / 2 + 240}" text-anchor="middle"
    font-family="'Microsoft YaHei','微软雅黑',sans-serif" font-weight="400"
    font-size="34" fill="#8a8f9c">每天一个可落地的搞钱方法</text>
</svg>`;
  await render(splash, SW, SH, path.join(RES, 'drawable', 'splash.png'));
  console.log(`splash.png ${SW}x${SH}`);

  console.log('图标背景色 →', BG);
  cdp.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 未退尽，无妨 */ }
  process.exit(0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(2); });
