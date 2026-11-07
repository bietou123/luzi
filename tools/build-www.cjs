#!/usr/bin/env node
/**
 * build-www.cjs —— 把 src/ 拷进 www/，让 www 成为自包含的可部署目录
 *
 * Capacitor 只把 webDir（= www）整个打进 apk，所以打包前必须把 src/ 复制进 www/。
 * 另外对 src/data/routes.js 做结构校验，防止内容库写坏。
 *
 * 用法: node tools/build-www.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

if (!fs.existsSync(path.join(ROOT, 'src', 'index.html'))) {
  console.error('src/index.html 不存在 —— 请先编写界面。');
  process.exit(1);
}

// 校验内容库
const routesPath = path.join(ROOT, 'src', 'data', 'routes.js');
const routesSrc = fs.readFileSync(routesPath, 'utf8');
const idCount = (routesSrc.match(/^ {2,}id: /gm) || []).length;
const checklists = (routesSrc.match(/checklist: \[/g) || []).length;
if (idCount === 0) {
  console.error('routes.js 异常：未找到任何 id 字段。');
  process.exit(1);
}
console.log(`内容库校验通过：${idCount} 条路子，${checklists} 个打卡清单`);

// 版本一致性校验：app.js 的 APP_VERSION 必须与 android/app/build.gradle 的 versionName 一致
const appJs = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
const appVer = (appJs.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
const gradleVer = (gradle.match(/versionName "([^"]+)"/) || [])[1] || '';
if (!appVer || !gradleVer) {
  console.error('版本校验：未找到 APP_VERSION 或 versionName，请检查 app.js / build.gradle');
  process.exit(1);
}
if (appVer !== gradleVer) {
  console.error(`版本不一致！app.js=${appVer}，build.gradle=${gradleVer}，请先同步后再构建。`);
  process.exit(1);
}
console.log(`版本校验通过：v${appVer}`);

// 拷贝整个 src → www
fs.rmSync(WWW, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'src'), WWW, { recursive: true });

// 用 esbuild 打包 app.js：解析 @capacitor/* 等 npm 包（无打包器的话裸导入在 www 里解析不了）
const { buildSync } = require('esbuild');
buildSync({
  entryPoints: [path.join(ROOT, 'src', 'js', 'app.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(WWW, 'js', 'app.js'),
  logLevel: 'silent',
  legalComments: 'none',
});
console.log('    js/app.js 已 esbuild 打包');

const count = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
  }
  return n;
};

console.log('OK  www/ 已自包含');
console.log('    www/src      ', count(path.join(WWW, 'src')), '个文件');
