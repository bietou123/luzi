import { ROUTES } from '../data/routes.js';
import { DEALS, DEAL_CATS, DEAL_TIPS } from '../data/deals.js';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

// ============ 常量与配置 ============
const CATS = {
  digital:   { name: '数字服务', icon: '💻', color: '#4f8cff', bg: 'rgba(79,140,255,.15)' },
  ecommerce: { name: '电商',     icon: '🛍️', color: '#f08a24', bg: 'rgba(240,138,36,.15)' },
  content:   { name: '内容创作', icon: '✍️', color: '#a06bff', bg: 'rgba(160,107,255,.15)' },
  skill:     { name: '技能变现', icon: '🛠️', color: '#2ecc71', bg: 'rgba(46,204,113,.15)' },
  local:     { name: '线下',     icon: '📍', color: '#ff5b6a', bg: 'rgba(255,91,106,.15)' },
  platform:  { name: '平台补贴', icon: '🎁', color: '#f5b93c', bg: 'rgba(245,185,60,.15)' },
  finance:   { name: '理财',     icon: '📈', color: '#17a2b8', bg: 'rgba(23,162,184,.15)' },
  freelance: { name: '自由职业', icon: '🧑‍💻', color: '#e84393', bg: 'rgba(232,67,147,.15)' },
};

const STORAGE_KEY = 'luzi_app_v1';
const REMOTE_URL_KEY = 'luzi_remote_url';
// 版本号需与 android/app/build.gradle 的 versionName 保持一致（build-www.cjs 会校验）
const APP_VERSION = '4.47.0';

// ============ 工具函数 ============
const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const fmt = (n) => n >= 10000 ? (n/10000).toFixed(1)+'w' : n.toLocaleString();
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// 基于日期的伪随机（同一日期同一结果）
function seededRand(seed) {
  // FNV-1a 字符串 hash：对相邻日期（仅末尾字符不同）也能雪崩出完全不同的种子，
  // 避免同一个月每天都随机出同一条路子。Math.imul 保证精确的 32 位乘法。
  let s = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    s ^= seed.charCodeAt(i);
    s = Math.imul(s, 16777619) >>> 0;
  }
  return function() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ============ 本地存储 ============
function defaultState() {
  return {
    checkin: {},          // { '2026-08-10': 1 }
    streak: 0,            // 连续签到天数
    lastCheckin: null,    // 上次签到日期
    coins: 0,             // 金币
    levelIdx: 0,          // 已庆祝过的金币等级序号（防重复弹升级）
    liked: {},            // { id: true }
    checks: {},           // { 'id::2026-08-10': { 0:true, 1:false } }
    records: [],          // [{ id, routeId, title, amount, type:'in'|'out', note, date }]
    progress: {},         // { id: 当前做到第几步 }
    guideStage: 0,        // 教程进度
    guideRewarded: false, // 学完教程是否已发金币奖励
    routeHistory: {},     // 每天推荐过的路子 { date: routeId }
    routeSwapHistory: {}, // 当天换掉的路子栈 { date: [routeId...] }（支持撤销，越往后越新）
    routeVotes: {},       // { id: 'like'|'meh' } 用户对路子的反馈
    monthGoal: 1000,      // 本月收入目标（元）
    goalCelebratedMonth: '', // 已庆祝达标的月份 'YYYY-MM'
    saveGoal: 0,          // 攒钱目标（元），0 = 未设置
    saveGoalCelebrated: false, // 攒钱目标是否已发过达标奖励
    achShown: [],         // 已 toast 过的成就名（用于实时解锁提示）
    tasks: [],            // 已完成的新手任务 id（自动发奖）
    coinLog: [],          // 金币收支明细 [{ d:'YYYY-MM-DD', amt, note }]
    makeupDays: {},       // 补签过的日期 { 'YYYY-MM-DD': 1 }（日历特殊标记）
    reviews: {},          // 每日执行复盘 { 'YYYY-MM-DD': 'done'|'partial'|'miss' }
    badges: {},           // 已兑换称号 { '称号名': true }
    activeBadge: '',      // 当前使用中的称号名
    luckyCount: 0,        // 累计开盲盒次数（每 5 次保底必出称号）
    streakRewards: [],    // 已发过的连续签到里程碑（防重复）
    reviewRewarded: {},   // 当天执行复盘已发金币的日期 { 'YYYY-MM-DD': 1 }（防重复）
    reviewNotes: {},      // 当天执行复盘心得 { 'YYYY-MM-DD': '文字' }（限 60 字）
    execStreakRewards: [], // 已发过的连续执行里程碑（防重复）
    earnRewards: [],      // 已发过的累计净赚里程碑（防重复）
    remoteUrl: '',
    remoteUpdatedAt: null,
    lastRemoteFetch: null,
    searchHistory: [],    // 最近搜索词（最多 6 个，新的在前）
    firstInCelebrated: false, // 首单庆祝横幅是否已收起
    customChecks: {},     // 用户自定义打卡项 { routeId: ['自定义内容'...] }
    achRewarded: [],      // 已发过金币的成就名（防重复）
    weekGoal: 0,          // 本周目标（元），0 = 用月目标推算
    weekGoalCelebrated: '', // 已庆祝达标的周一日期 'YYYY-MM-DD'（防重复）
    todayStepsRewarded: '', // 已发过金币的三步走完成日期 'YYYY-MM-DD'（防重复）
    stepsStreakRewards: [], // 已发过的连续三步走闭环里程碑（防重复）
    roadmapRewarded: false, // 新手路线图 7 步全解锁奖励是否已发（防重复）
    challenges: {},   // 30 天挑战 { routeId: { start:'YYYY-MM-DD', days:{date:1}, done:false } }
    challengeRewarded: [], // 已发过金币的 30 天挑战 routeId（防重复）
    notifMorning: '08:30', // 晨间路子提醒时间 'HH:MM'
    notifEvening: '20:30', // 晚间打卡提醒时间 'HH:MM'
    guardRead: false,     // 是否已读完避坑指南（防重，读完全册 +30 金币）
    // —— 省钱攻略模块 ——
    dealStatus: {},       // 资格状态 { dealId: 'used'|'ready' }，未记录视为没做过
    dealLiked: {},        // 收藏的省钱攻略 { id: true }
    dealLog: [],          // 省钱台账 [{ id, dealId, title, amount, note, date }]
    dealRewarded: [],     // 已发过金币的攻略 id（防重复）
    dealSearchHist: [],   // 攻略搜索历史
  };
}

let state = loadState();
// v1.5.5：老用户升级后首次加载，静默记录已解锁成就，避免误报「解锁新成就」
(function() {
  const cur = getAchievements();
  if (cur.unlocked > 0 && state.achShown.length === 0) {
    state.achShown = cur.list.filter(a => a.got).map(a => a.name);
    saveState();
  }
})();
// v2.9.0：老用户已有累计净赚达标的直接补发收入里程碑金币（延迟到 EARN_REWARDS 初始化后执行，避免 TDZ）
setTimeout(() => checkEarnMilestone(), 0);
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) { return defaultState(); }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

// ============ 远程内容更新 ============
// 可配置远程 URL：返回 JSON，格式 { version: 1, routes: [...] }
// 远程路子会合并进本地内容库，id 冲突时远程覆盖内置。
let remoteRoutes = [];
let remoteLoaded = false;
async function loadRemoteRoutes() {
  if (remoteLoaded) return remoteRoutes;
  remoteLoaded = true;
  const url = state.remoteUrl;
  if (!url) return remoteRoutes;
  // 避免每次启动都拉，至少间隔 6 小时
  if (state.lastRemoteFetch && Date.now() - state.lastRemoteFetch < 6*3600*1000) {
    return remoteRoutes;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return remoteRoutes;
    const data = await res.json();
    if (data && Array.isArray(data.routes) && data.routes.length) {
      remoteRoutes = data.routes;
      state.lastRemoteFetch = Date.now();
      state.remoteUpdatedAt = Date.now();
      saveState();
    }
  } catch (e) { /* 静默失败，用内置内容 */ }
  return remoteRoutes;
}

function allRoutes() {
  const base = [...ROUTES];
  const idMap = {};
  remoteRoutes.forEach(r => { idMap[r.id] = r; });
  return base.map(r => idMap[r.id] ? { ...r, ...idMap[r.id] } : r).concat(
    remoteRoutes.filter(r => !base.some(b => b.id === r.id))
  );
}

// ============ 今日路子推荐 ============
function todayRoute() {
  const today = todayStr();
  const routes = allRoutes();
  if (!routes.length) return null;
  const rand = seededRand('luzi' + today);
  // 规则：如果今天已推荐过，用回同一批；否则根据日期随机 + 用户偏好调整
  const candidates = [...routes];
  // 优先推荐用户点过"喜欢"的类目，避免完全随机
  const likedIds = Object.keys(state.routeVotes).filter(k => state.routeVotes[k] === 'like');
  if (likedIds.length && rand() < 0.3) {
    const likedRoute = routes.find(r => likedIds.includes(r.id));
    if (likedRoute) return likedRoute;
  }
  const idx = Math.floor(rand() * candidates.length);
  return candidates[idx];
}

function routeForDate(dateStr) {
  if (state.routeHistory[dateStr]) {
    const r = allRoutes().find(x => x.id === state.routeHistory[dateStr]);
    if (r) return r;
  }
  const rand = seededRand('luzi' + dateStr);
  const routes = allRoutes();
  if (!routes.length) return null;
  const idx = Math.floor(rand() * routes.length);
  const r = routes[idx];
  state.routeHistory[dateStr] = r.id;
  saveState();
  return r;
}

// 用户不喜欢今天的路子 → 换一条（标记 meh，避免当天重复推荐；旧路子压入撤销栈）
function swapTodayRoute() {
  const today = todayStr();
  const cur = state.routeHistory[today];
  if (cur) {
    state.routeVotes[cur] = 'meh';
    const stack = state.routeSwapHistory[today] || [];
    if (!stack.includes(cur)) stack.push(cur);
    state.routeSwapHistory[today] = stack;
  }
  const stack = state.routeSwapHistory[today] || [];
  let others = allRoutes().filter(r => r.id !== cur && !stack.includes(r.id));
  if (!others.length) others = allRoutes().filter(r => r.id !== cur);
  const r = others[Math.floor(Math.random() * others.length)];
  state.routeHistory[today] = r.id;
  saveState();
  notifyNewAchievements();
  toast('已为你换一条，今天看这条 👌');
  render('home');
}

// 撤销换路：回到上一条换掉的路子（也恢复它的热度标记）
function undoSwapTodayRoute() {
  const today = todayStr();
  const stack = state.routeSwapHistory[today];
  if (!stack || !stack.length) return;
  const restoredId = stack.pop();
  if (stack.length) state.routeSwapHistory[today] = stack;
  else delete state.routeSwapHistory[today];
  state.routeHistory[today] = restoredId;
  delete state.routeVotes[restoredId];
  saveState();
  notifyNewAchievements();
  toast('已撤销，回到刚才那条 👌');
  render('home');
}

// 记录库页搜索历史（去重、上限 6，新的在前）
function pushSearchHist(q) {
  q = (q || '').trim();
  if (!q) return;
  const h = (state.searchHistory || []).filter(w => w !== q);
  h.unshift(q);
  state.searchHistory = h.slice(0, 6);
  saveState();
}

// 受欢迎度：赞+收藏加分，换掉(meh)减分 → 决定首页「热门路子」排序
function routePopularity(r) {
  let s = 0;
  if (state.routeVotes[r.id] === 'like') s += 3;
  if (state.liked[r.id]) s += 2;
  if (state.routeVotes[r.id] === 'meh') s -= 2;
  return s;
}

// ============ 渲染引擎 ============
let currentView = 'home';
let currentDetailId = null;
let currentPreview = false; // 详情页处于「明日预览」模式（隐藏今日专属操作）
const view = $('#view');

function render(viewName) {
  currentView = viewName;
  window.scrollTo(0, 0);
  updateTabbar();
  const routes = allRoutes();
  switch (viewName) {
    case 'home': view.innerHTML = renderHome(routes); break;
    case 'library': view.innerHTML = renderLibrary(routes); break;
    case 'detail': break; // detail 单独处理
    case 'guide': view.innerHTML = renderGuide(); break;
    case 'today': view.innerHTML = renderGuide(); break; // 教程 tab（data-view="today"）
    case 'track': view.innerHTML = renderTrack(routes); break;
    case 'mine': view.innerHTML = renderMine(routes); break;
    case 'records': view.innerHTML = renderRecords(); break;
    case 'likes': view.innerHTML = renderLikes(routes); break;
    case 'about': view.innerHTML = renderAbout(); break;
    case 'guard': view.innerHTML = renderGuard(); break;
    case 'deals': view.innerHTML = renderDeals(); break;
    case 'dealDetail': break; // 省钱攻略详情单独处理
    case 'saveRecords': view.innerHTML = renderSaveRecords(); break;
    default: view.innerHTML = renderHome(routes);
  }
  bindViewEvents(viewName);
}

function updateTabbar() {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === currentView);
  });
}

// ============ 首页 ============
// 今日行动：给小白每天的 3 个小动作
function renderDailyAction(tr) {
  if (!tr) return '';
  const today = todayStr();
  const dayC = state.checks[`${tr.id}::${today}`] || {};
  const joined = !!state.checks[`${tr.id}::${today}`];
  const doneCount = tr.checklist.filter((_, i) => dayC[i]).length;
  const allDone = totalCheckDone(tr);
  const todayIn = state.records.some(r => r.date === today && r.type === 'in');
  const items = [
    { a: 1, icon: '📋', text: '把今日路子加入打卡', done: joined },
    { a: 2, icon: '🎯', text: '完成今日打卡清单', done: allDone },
    { a: 3, icon: '💰', text: '记一笔今天的收入', done: todayIn },
  ];
  const doneN = items.filter(i => i.done).length;
  const all = doneN >= items.length;
  return `
    <div class="daily-action ${all ? 'all' : ''}">
      <div class="da-head"><span>📝 今日行动</span><span class="da-prog">${doneN}/3</span></div>
      ${items.map(i => `
        <div class="da-item ${i.done ? 'done' : ''}" ${i.done ? '' : `data-daily-action="${i.a}"`}>
          <div class="da-ico">${i.done ? '✅' : i.icon}</div>
          <div class="da-text">${i.text}</div>
          <div class="da-check">${i.done ? '✓' : '›'}</div>
        </div>`).join('')}
      ${all ? '<div class="da-done">🎉 今日行动全部完成，可以安心休息了</div>' : '<div class="da-tip">跟着清单走，一天一步，搞钱不慌</div>'}
    </div>`;
}

// 昨日回顾：新的一天打开 app，先看昨天赚了多少、执行如何（留存钩子，有昨日数据才显示）
function yesterdayReview() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  const yStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const recs = state.records.filter(r => r.date === yStr);
  const inSum = recs.filter(r => r.type === 'in').reduce((s, r) => s + r.amount, 0);
  const outSum = recs.filter(r => r.type === 'out').reduce((s, r) => s + r.amount, 0);
  const net = inSum - outSum;
  const rev = state.reviews[yStr];
  const checksDone = Object.entries(state.checks).filter(([k, v]) => k.split('::')[1] === yStr).reduce((s, [, v]) => s + Object.values(v).filter(Boolean).length, 0);
  if (net === 0 && !rev && checksDone === 0) return '';
  const revTxt = rev === 'done' ? '执行了 ✅' : rev === 'partial' ? '做了一半 🔁' : rev === 'miss' ? '没执行 ❌' : '没执行 ⏳';
  const tip = net > 0 ? `昨天净赚 ¥${fmt(net)}，今天继续冲！` : net < 0 ? `昨天支出 ¥${fmt(Math.abs(net))}，今天多赚点回来` : rev === 'done' ? '昨天执行得不错，今天保持住' : rev ? '昨天没记收入，今天赚了记得记一笔' : '昨天还没开始，今天就从今日路子动手';
  return `
    <div class="yesterday-review">
      <div class="yr-head"><span>📅 昨日回顾 · ${d.getMonth()+1}月${d.getDate()}日</span></div>
      <div class="yr-grid">
        <div class="yr-cell"><div class="yr-num ${net >= 0 ? 'inc' : 'out'}">${net >= 0 ? '+' : '-'}¥${fmt(Math.abs(net))}</div><div class="yr-lb">昨日净赚</div></div>
        <div class="yr-cell"><div class="yr-txt">${revTxt}</div><div class="yr-lb">执行复盘</div></div>
        <div class="yr-cell"><div class="yr-num">${checksDone}</div><div class="yr-lb">昨日打卡</div></div>
      </div>
      <div class="yr-tip">${tip}</div>
    </div>`;
}

// 今日收益速览：今天记过账才显示（首页即时净赚反馈）
function todayIncomeCard() {
  const today = todayStr();
  const ti = state.records.filter(r => r.date === today && r.type === 'in').reduce((s, r) => s + r.amount, 0);
  const to = state.records.filter(r => r.date === today && r.type === 'out').reduce((s, r) => s + r.amount, 0);
  if (ti === 0 && to === 0) return '';
  const net = ti - to;
  const d = new Date(today);
  return `
    <div class="today-income ${net >= 0 ? 'pos' : 'neg'}">
      <div class="tdi-head"><span>💰 今日账本</span><span class="tdi-date">${d.getMonth()+1}月${d.getDate()}日</span></div>
      <div class="tdi-grid">
        <div class="tdi-cell"><div class="tdi-num inc">+¥${fmt(ti)}</div><div class="tdi-lb">今日收入</div></div>
        <div class="tdi-cell"><div class="tdi-num out">-¥${fmt(to)}</div><div class="tdi-lb">今日支出</div></div>
        <div class="tdi-cell"><div class="tdi-num net ${net >= 0 ? 'inc' : 'out'}">${net >= 0 ? '+' : '-'}¥${fmt(Math.abs(net))}</div><div class="tdi-lb">今日净赚</div></div>
      </div>
    </div>`;
}

// 新手友好：难度低、启动资金少、见效快
const isNewbieFriendly = (r) => r.diff <= 3 && r.capital <= 500 && r.cycle <= 7;

// 连续签到里程碑进度：首页常驻条，距下一里程碑还差几天 → 持续激励坚持
function renderStreakMile() {
  const st = state.streak || 0;
  if (st < 1) return '';
  const keys = Object.keys(STREAK_REWARDS).map(Number).sort((a, b) => a - b);
  const next = keys.find(k => k > st);
  if (!next) {
    return `<div class="streak-ms done"><span>🏆 全部签到里程碑已解锁（${st} 天）</span></div>`;
  }
  const bonus = STREAK_REWARDS[next];
  const pct = Math.min(100, Math.round(st / next * 100));
  return `
    <div class="streak-ms">
      <div class="ms-top"><span>🔥 连续签到 <b>${st}</b> 天</span><span class="ms-next">距 <b>${next}</b> 天 · 奖励 <b>+${bonus}</b> 🪙</span></div>
      <div class="ms-bar"><div class="ms-fill" style="width:${pct}%"></div></div>
    </div>`;
}

// 「今日三步走」：签到→执行今日路子→记一笔账，每日闭环聚合引导
function renderTodaySteps(tr) {
  const today = todayStr();
  const signed = !!state.checkin[today];
  const exec = !!state.reviews[today];
  const booked = state.records.some(r => r.date === today);
  const steps = [
    { k: 'sign', icon: '☀️', label: '今日签到', sub: '开始攒金币' },
    { k: 'exec', icon: '⚡', label: '执行今日路子', sub: tr ? esc(tr.title) : '' },
    { k: 'book', icon: '💰', label: '记一笔账', sub: booked ? '' : '赚了别忘记' },
  ];
  const done = [signed, exec, booked];
  const allDone = done.every(Boolean);
  return `
    <div class="today-steps ${allDone ? 'all-done' : ''}">
      <div class="ts-head"><span>👣 今日三步走</span><span class="ts-count">${done.filter(Boolean).length}/3</span></div>
      <div class="ts-row">
        ${steps.map((s, i) => `
          <div class="ts-item ${done[i] ? 'done' : ''}" data-ts="${s.k}">
            <div class="ts-ico">${done[i] ? '✅' : s.icon}</div>
            <div class="ts-body"><div class="ts-label">${s.label}</div>${s.sub ? `<div class="ts-sub">${s.sub}</div>` : ''}</div>
            <div class="ts-btn">${done[i] ? '✓' : 'GO'}</div>
          </div>`).join('')}
      </div>
      ${allDone ? '<div class="ts-complete">🎉 今天的三步走完成，闭环了！</div>' : ''}
      ${allDone ? `<div class="ts-streak">🔥 已连续闭环 <b>${stepsStreakDays()}</b> 天</div>` : ''}
    </div>`;
}
// 签到后轻量刷新三步卡（只重建这一张卡，不整页重渲染）
function refreshTodaySteps() {
  if (currentView !== 'home') return;
  const card = document.querySelector('.today-steps');
  if (!card) return;
  card.outerHTML = renderTodaySteps(routeForDate(todayStr()));
  checkTodayStepsReward();
}

// v4.30.0：今日三步走（签到+执行+记账）全完成 → 发金币 + 全屏庆祝（防重）
// v4.31.0：命中连续闭环里程碑时只弹里程碑庆祝（更强的仪式），否则弹三步走庆祝
function checkTodayStepsReward() {
  const today = todayStr();
  const signed = !!state.checkin[today];
  const exec = !!state.reviews[today];
  const booked = state.records.some(r => r.date === today);
  if (signed && exec && booked && state.todayStepsRewarded !== today) {
    state.todayStepsRewarded = today;
    addCoins(STEPS_REWARD, '今日三步走完成');
    const st = stepsStreakDays();
    if (STEPS_STREAK_REWARDS[st] && !(state.stepsStreakRewards || []).includes(st)) {
      (state.stepsStreakRewards = state.stepsStreakRewards || []).push(st);
      addCoins(STEPS_STREAK_REWARDS[st], `连续闭环 ${st} 天里程碑`);
      setTimeout(() => showStepsStreakCel(st, STEPS_STREAK_REWARDS[st]), 500);
    } else {
      setTimeout(() => showStepsCel(), 500);
    }
  }
}

// v4.32.0：新手路线图 7 步全部解锁 → 发金币 + 全屏庆祝（终局仪式，防重）
function checkRoadmapReward() {
  if (state.roadmapRewarded) return;
  if (!ROADMAP.every(s => roadmapDone(s.routeId))) return;
  state.roadmapRewarded = true;
  addCoins(ROADMAP_REWARD, '新手路线图全部解锁');
  setTimeout(() => showRoadmapCel(), 500);
}

// 路线图终局庆祝：复用 .exec-cel/.ec-* 视觉
function showRoadmapCel() {
  if (document.querySelector('.exec-cel')) return;
  const mask = el(`
    <div class="exec-cel">
      <div class="ec-card">
        <div class="ec-icon">🚀</div>
        <div class="ec-title">新手路线图全部解锁！</div>
        <div class="ec-coins">+${ROADMAP_REWARD} 🪙</div>
        <div class="ec-sub">7 条新手路子全跑通，<br>你已经不是小白了</div>
        <button class="ec-btn" data-close>继续冲！</button>
      </div>
    </div>`);
  const emojis = ['🚀', '✨', '💰', '🌟', '🎊', '🤑', '💪', '🎓'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  setTimeout(() => toast(`🚀 新手路线图全部解锁，+${ROADMAP_REWARD} 金币 🪙`), 300);
}

// v4.34.0：30 天挑战——把一条路子坚持 30 天（每日打卡推进、按天去重累计），完成发大赏
const CHALLENGE_REWARD = 300;

function challengeState(routeId) {
  const ch = state.challenges[routeId];
  if (!ch) return null;
  return { start: ch.start, days: Object.keys(ch.days || {}).length, done: !!ch.done };
}

function startChallenge(routeId) {
  const st = challengeState(routeId);
  if (st) {
    if (st.done) toast('✅ 这条路子的 30 天挑战已完成过');
    else toast('🔥 已在这条路子的挑战中，继续打卡推进');
    return;
  }
  state.challenges[routeId] = { start: todayStr(), days: {}, done: false };
  saveState();
  toast('🔥 开始 30 天挑战！每天完成打卡清单即推进一天');
  if (currentView === 'detail') openDetail(routeId, currentPreview);
}

// 打卡后推进：今天打卡清单有任意完成 → 记入 days；累计满 30 天 → 发奖 + 庆祝
function challengeTick(routeId) {
  const ch = state.challenges[routeId];
  if (!ch || ch.done) return;
  const today = todayStr();
  const dayChecks = state.checks[routeId + '::' + today] || {};
  if (!Object.values(dayChecks).some(Boolean)) return;
  ch.days = ch.days || {};
  ch.days[today] = 1;
  if (Object.keys(ch.days).length >= 30) {
    ch.done = true;
    if (!(state.challengeRewarded || []).includes(routeId)) {
      (state.challengeRewarded = state.challengeRewarded || []).push(routeId);
      addCoins(CHALLENGE_REWARD, '30天挑战完成');
      setTimeout(() => showChallengeCel(), 500);
    }
  }
}

// 30 天挑战完成庆祝：复用 .exec-cel/.ec-* 视觉
function showChallengeCel() {
  if (document.querySelector('.exec-cel')) return;
  const mask = el(`
    <div class="exec-cel">
      <div class="ec-card">
        <div class="ec-icon">🔥</div>
        <div class="ec-title">30 天挑战完成！</div>
        <div class="ec-coins">+${CHALLENGE_REWARD} 🪙</div>
        <div class="ec-sub">把一条路子坚持 30 天，<br>钱开始追着你跑</div>
        <button class="ec-btn" data-close>收下奖励</button>
      </div>
    </div>`);
  const emojis = ['🔥', '✨', '💰', '🌟', '🎊', '🤑', '💪', '🏆'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  setTimeout(() => toast(`🔥 30 天挑战完成，+${CHALLENGE_REWARD} 金币 🪙`), 300);
}

// 我的页 30 天挑战卡：显示进行中的挑战进度
function renderChallengeCard() {
  const active = Object.entries(state.challenges || {}).filter(([, ch]) => !ch.done);
  if (!active.length) return '';
  const rows = active.map(([rid, ch]) => {
    const r = allRoutes().find(x => x.id === rid);
    if (!r) return '';
    const days = Object.keys(ch.days || {}).length;
    const cat = CATS[r.cat] || { icon: '💰', bg: 'rgba(245,185,60,.15)' };
    const pct = Math.min(100, Math.round(days / 30 * 100));
    return `
      <div class="ch-row" data-open="${rid}">
        <div class="ch-ico" style="background:${cat.bg}">${cat.icon}</div>
        <div class="ch-main">
          <div class="ch-title">${esc(r.title)}</div>
          <div class="ch-sub">🔥 坚持第 <b>${days}</b>/30 天</div>
          <div class="ch-bar"><div class="ch-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="ch-arrow">›</div>
      </div>`;
  }).join('');
  if (!rows) return '';
  return `
    <div class="challenge-card">
      <div class="ch-head"><span>🔥 我的 30 天挑战</span><span class="ch-count">坚持满 30 天 +${CHALLENGE_REWARD} 🪙</span></div>
      ${rows}
    </div>`;
}

// 从今天往前数连续「三步走」完成天数（今天必须完成才从今天数）
function stepsStreakDays() {
  const rv = state.reviews || {};
  const recs = state.records || [];
  let s = 0;
  const d = new Date();
  for (let i = 0; i < 366; i++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (state.checkin[ds] && rv[ds] && recs.some(r => r.date === ds)) { s++; d.setDate(d.getDate() - 1); } else break;
  }
  return s;
}

// 连续闭环里程碑全屏庆祝：复用 .exec-cel/.ec-* 视觉
function showStepsStreakCel(streak, bonus) {
  if (document.querySelector('.exec-cel')) return;
  const mask = el(`
    <div class="exec-cel">
      <div class="ec-card">
        <div class="ec-icon">🏅</div>
        <div class="ec-title">连续闭环 <b>${streak}</b> 天！</div>
        <div class="ec-coins">+${bonus} 🪙</div>
        <div class="ec-sub">签到、执行、记账一天不落，<br>钱就是这么攒下的</div>
        <button class="ec-btn" data-close>太棒了，继续冲！</button>
      </div>
    </div>`);
  const emojis = ['🏅', '✨', '💰', '🌟', '🎊', '🤑', '💪', '👣'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  setTimeout(() => toast(`🏅 连续闭环 ${streak} 天里程碑，+${bonus} 金币 🪙`), 300);
}

// 三步走完成全屏庆祝：复用 .exec-cel/.ec-* 视觉
function showStepsCel() {
  if (document.querySelector('.exec-cel')) return;
  const mask = el(`
    <div class="exec-cel">
      <div class="ec-card">
        <div class="ec-icon">👣</div>
        <div class="ec-title">今日三步走完成！</div>
        <div class="ec-coins">+${STEPS_REWARD} 🪙</div>
        <div class="ec-sub">签到 → 执行 → 记账，<br>闭环的一天从今天开始</div>
        <button class="ec-btn" data-close>明天继续！</button>
      </div>
    </div>`);
  const emojis = ['👣', '✨', '💰', '🌟', '🎊', '🤑', '💪', '✅'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  setTimeout(() => toast(`👣 今日三步走完成，+${STEPS_REWARD} 金币 🪙`), 300);
}

// 首页月目标进度条：每天打开就看到还差多少达标，激励坚持记账
function renderHomeGoal() {
  const goal = state.monthGoal || 1000;
  const income = monthIncome();
  const pct = Math.min(100, Math.round(income / goal * 100));
  const done = income >= goal;
  const ym = todayStr().slice(0, 7);
  if (done && state.goalCelebratedMonth !== ym) {
    state.goalCelebratedMonth = ym;
    addCoins(GOAL_REWARD, '月度目标达成');
    setTimeout(() => showGoalCel('month', GOAL_REWARD), 500);
    setTimeout(() => toast(`🎉 本月目标达成！奖励 ${GOAL_REWARD} 金币 🪙`), 900);
  }
  // 周目标：以本周一为起点，weekGoalCelebrated 记周一防重复发奖
  const now = new Date();
  const wk = weekStats(0);
  const wkGoal = state.weekGoal || Math.round((state.monthGoal || 1000) / 4.35);
  const wkIncome = wk.income;
  const wkKey = wk.days[0].ds;
  if (wkIncome >= wkGoal && state.weekGoalCelebrated !== wkKey) {
    state.weekGoalCelebrated = wkKey;
    addCoins(WEEK_GOAL_REWARD, '本周目标达成');
    setTimeout(() => showGoalCel('week', WEEK_GOAL_REWARD), 600);
    setTimeout(() => toast(`🎯 本周目标达成！奖励 ${WEEK_GOAL_REWARD} 金币 🪙`), 1000);
  }
  const wkPct = wkGoal ? Math.max(0, Math.min(100, Math.round(wkIncome / wkGoal * 100))) : 0;
  const wkDone = wkIncome >= wkGoal;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const perDay = done ? 0 : Math.ceil((goal - income) / daysLeft);
  const tIn = state.records.filter(r => r.type === 'in' && r.date === todayStr()).reduce((s, r) => s + r.amount, 0);
  const todayOk = !done && tIn >= perDay;
  const todayLine = !done ? `<div class="hg-today ${todayOk ? 'done' : ''}">今日需赚 <b>¥${fmt(perDay)}</b> · 已赚 <b>¥${fmt(tIn)}</b> ${todayOk ? '· 今日达标 ✅' : `· 还差 ¥${fmt(Math.max(0, perDay - tIn))}`}</div>` : '';
  // 月目标达成预测：按本月至今日均净收入推算月底
  const mNet = state.records.filter(r => r.date && r.date.startsWith(ym)).reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
  const dayOfMonth = now.getDate();
  let forecastLine = '';
  if (!done) {
    if (mNet > 0) {
      const forecast = Math.round(mNet / dayOfMonth * daysInMonth);
      forecastLine = forecast >= goal
        ? `<div class="hg-forecast ok">🔮 按当前日均，本月预计 <b>¥${fmt(forecast)}</b> · 有望达标 🎯</div>`
        : `<div class="hg-forecast">🔮 按当前日均，月底预计 <b>¥${fmt(forecast)}</b> · 还差 ¥${fmt(goal - forecast)}</div>`;
    } else {
      forecastLine = `<div class="hg-forecast warn">🔮 本月还没记净收入，记一笔让预测动起来</div>`;
    }
  }
  return `
    <div class="home-goal ${done ? 'done' : ''}" data-goal-go>
      <div class="hg-top">
        <span class="hg-title">🎯 本月目标</span>
        <span class="hg-pct">${done ? '已达标 🎉' : pct + '%'}</span>
      </div>
      <div class="hg-bar"><div class="hg-fill ${done ? 'full' : ''}" style="width:${pct}%"></div></div>
      <div class="hg-sub">已赚 <b>¥${fmt(income)}</b> / 目标 ¥${fmt(goal)} · ${done ? `超出 ¥${fmt(income - goal)}` : `还差 ¥${fmt(goal - income)} 达标`}</div>
      ${!done ? `<div class="hg-pace">📅 剩 ${daysLeft} 天，每天需赚 <b>¥${fmt(perDay)}</b></div>` : ''}
      ${todayLine}
      ${forecastLine}
      ${done ? '' : '<div class="hg-hint">达标奖励 <b>+200</b> 金币 🪙 · 点我看详情</div>'}
      <div class="hg-week ${wkDone ? 'done' : ''}">
        <div class="hw-top"><span class="hw-title">📅 本周目标</span><span class="hw-pct">${wkDone ? '已达标 🎉' : wkPct + '%'}</span></div>
        <div class="hw-bar"><div class="hw-fill ${wkDone ? 'full' : ''}" style="width:${wkPct}%"></div></div>
        <div class="hw-sub">已赚 <b>¥${fmt(wkIncome)}</b> / 目标 ¥${fmt(wkGoal)} · ${wkDone ? `超出 ¥${fmt(wkIncome - wkGoal)}` : `还差 ¥${fmt(wkGoal - wkIncome)} · 达标 +${WEEK_GOAL_REWARD} 🪙`}</div>
      </div>
    </div>`;
}

// v4.42.0 每日一句搞钱箴言：与日期绑定确定性轮换（seededRand），给小白每天打开 app 的仪式感
const DAILY_QUOTES = [
  '钱是攒出来的，更是执行出来的',
  '今天的 100 块，是明天 1000 块的起点',
  '别等准备好了再开始，边做边学才走得快',
  '先把手头这条路走通，再想下一条',
  '记录每一笔收入，你会看见坚持的复利',
  '小钱看不上，大钱轮不到你',
  '把一件事重复做，钱会自己找上门',
  '执行力是普通人最便宜的护城河',
  '省下来的每一分，都是赚到的',
  '一条路子走 30 天，比试 30 条路子强',
  '搞钱先搞习惯，习惯攒成复利',
  '今天多做一点，明天就少焦虑一点',
  '你不需要很厉害才开始，但需要开始才很厉害',
  '副业不是想出来的，是做出来的',
  '记账是最便宜的理财课',
  '坚持本身就是一种搞钱能力',
  '先完成，再完美',
  '每一笔小收入，都在给你铺路',
  '少刷一小时视频，多赚一单小钱',
  '别让「等等再说」偷走你的第一桶金',
  '本金小不可怕，怕的是不动',
  '从今天开始，把路走起来',
  '与其焦虑没钱，不如动手赚一块',
  '你的时间就是本金，别贱卖',
];
function renderDailyQuote() {
  const q = DAILY_QUOTES[Math.floor(seededRand('luzi_quote_' + todayStr())() * DAILY_QUOTES.length)];
  return `<div class="daily-quote"><span class="dq-mark">❝</span><span class="dq-text">${q}</span><span class="dq-mark">❞</span></div>`;
}

function renderHome(routes) {
  const today = todayStr();
  const d = new Date();
  const week = ['日','一','二','三','四','五','六'][d.getDay()];
  const tr = routeForDate(today);
  checkTodayStepsReward(); // 兜底：进入首页时若三步已完成（如执行/记账在他页完成）补发奖励
  checkRoadmapReward(); // 兜底：路线图 7 步全解锁时补发终局奖励
  const tomD = new Date(); tomD.setDate(tomD.getDate() + 1);
  const tomStr = `${tomD.getFullYear()}-${String(tomD.getMonth()+1).padStart(2,'0')}-${String(tomD.getDate()).padStart(2,'0')}`;
  const tomRoute = routeForDate(tomStr);
  const totalIn = state.records.filter(r => r.type === 'in').reduce((s,r) => s+r.amount, 0);
  const doneCount = Object.values(state.checks).reduce((s, dayChecks) => s + Object.values(dayChecks).filter(Boolean).length, 0);

  const catItems = Object.entries(CATS).map(([k, v]) => `
    <div class="cat-item" data-cat="${k}">
      <div class="ico" style="background:${v.bg}">${v.icon}</div>
      <div class="nm">${v.name}</div>
    </div>`).join('');

  const isCheckedIn = !!state.checkin[today];
  return `
    <div class="hero">
      <div class="date-label">${d.getMonth()+1}月${d.getDate()}日 · 星期${week}</div>
      <div class="slogan">今天也做一个<br>能<strong>落地</strong>的搞钱动作</div>
      <div class="stats-row">
        <div class="stat-box" data-checkin><div class="num ${isCheckedIn?'green':''}">${isCheckedIn ? '✓' : '签到'}</div><div class="label">${isCheckedIn ? `已签 ${state.streak} 天` : '赚金币'}</div></div>
        <div class="stat-box"><div class="num green">¥${fmt(totalIn)}</div><div class="label">累计收入</div></div>
        <div class="stat-box"><div class="num">${doneCount}</div><div class="label">已打卡项</div></div>
      </div>
      ${renderStreakMile()}
    </div>

    ${renderDailyQuote()}

    ${renderTodaySteps(tr)}

    ${tr ? `
    <div class="today-route" data-open="${tr.id}">
      <div class="tr-top">
        <span class="tag">今日路子</span>
        <span class="idx">第 ${routes.indexOf(tr)+1}/${routes.length} 条</span>
      </div>
      <div class="tr-body">
        <div class="tr-title">${esc(tr.title)}</div>
        <div class="tr-tagline">${esc(tr.tag)}</div>
        <div class="tr-meta">
          <span class="meta-chip">难度 <b>${'●'.repeat(tr.diff)}${'○'.repeat(5-tr.diff)}</b></span>
          <span class="meta-chip">启动 <b>¥${tr.capital}</b></span>
          <span class="meta-chip">月收入 <b>¥${tr.monthly[0]}-${tr.monthly[1]}</b></span>
        </div>
        ${(() => {
          const trRecs = state.records.filter(x => x.routeId === tr.id);
          if (!trRecs.length) return '';
          const tin = trRecs.filter(x => x.type === 'in').reduce((s, x) => s + x.amount, 0);
          const tout = trRecs.filter(x => x.type === 'out').reduce((s, x) => s + x.amount, 0);
          const net = tin - tout;
          if (net > 0) return `<div class="tr-earn">💰 这条路子为你净赚 <b>¥${fmt(net)}</b></div>`;
          return `<div class="tr-earn neg">已投入 <b>¥${fmt(tout)}</b>，还差 <b>¥${fmt(-net)}</b> 回本</div>`;
        })()}
        <div class="tr-first"><span class="lb">👣 今天就做这一步</span>${esc(tr.firstStep)}</div>
        ${(() => {
          const tk = `${tr.id}::${today}`;
          const joined = !!state.checks[tk];
          if (!joined) return '';
          const dayDone = Object.values(state.checks[tk] || {}).filter(Boolean).length;
          const dayTotal = routeChecklistTotal(tr.id);
          const all = dayDone >= dayTotal;
          return `<div class="tr-progress">
            <div class="tp-bar"><div class="tp-fill ${all ? 'full' : ''}" style="width:${dayTotal ? dayDone / dayTotal * 100 : 0}%"></div></div>
            <span class="tp-label">${all ? '✅ 今日全部完成' : `今日已打卡 ${dayDone}/${dayTotal}`}</span>
          </div>`;
        })()}
        <button class="tr-cta" data-open="${tr.id}">查看完整步骤 →</button>
        <div class="tr-actions">
          <button class="tr-swap" data-swap-today>↻ 换一条</button>
          ${(state.routeSwapHistory[today] || []).length ? `<button class="tr-swap undo" data-undo-swap>↺ 撤销</button>` : ''}
          <button class="tr-track ${state.checks[tr.id + '::' + today] ? 'joined' : ''}" data-track="${tr.id}">${state.checks[tr.id + '::' + today] ? '✅ 已加入' : '✅ 加入打卡'}</button>
        </div>
        ${tomRoute ? `<div class="tr-tomorrow" data-open-tomorrow="${tomRoute.id}"><span class="tt-lb">🌅 明日路子</span><span class="tt-title">${esc(tomRoute.title)}</span><span class="tt-tag">${esc(tomRoute.tag)}</span><span class="tt-arrow">›</span></div>` : ''}
      </div>
    </div>` : ''}

    ${renderTodayReview(tr)}

    ${renderExecMile()}

    ${renderDailyAction(tr)}

    ${renderHomeDealStrip()}

    ${todayIncomeCard()}

    ${yesterdayReview()}

    ${renderHomeGoal()}

    ${renderMakeupStrip()}

    ${renderTaskBanner()}

    <div class="section-title">路子分类 <span class="more"></span></div>
    <div class="cat-grid">${catItems}</div>

    ${(() => {
      const nb = routes.filter(isNewbieFriendly).sort((a, b) => routePopularity(b) - routePopularity(a)).slice(0, 3);
      if (!nb.length) return '';
      return `
      <div class="section-title">🌱 新手起步 <span class="more"></span></div>
      <div class="newbie-strip">
        ${nb.map(r => `
          <div class="nb-item" data-open="${r.id}">
            <span class="nb-ico" style="background:${(CATS[r.cat]||{}).bg || 'rgba(245,185,60,.15)'}">${(CATS[r.cat]||{}).icon || '💰'}</span>
            <span class="nb-name">${esc(r.title)}</span>
            <span class="nb-meta">难度${'●'.repeat(r.diff)}${'○'.repeat(5-r.diff)} · ¥${fmt(r.monthly[1])}</span>
          </div>`).join('')}
      </div>`;
    })()}

    ${renderRoadmap(routes)}

    <div class="section-title">热门路子 <span class="more"></span></div>
    ${routes.slice().sort((a,b) => routePopularity(b) - routePopularity(a)).slice(0, 5).map((r, i) => routeCard(r, i+1)).join('')}
  `;
}

// ============ 今日执行复盘 ============
// 每天执行完今日路子后，花 3 秒打个分：做了 / 做了一半 / 没做
const REVIEW_LABEL = {
  done:    { icon: '✅', label: '今天做了',    tip: '真棒，行动力拉满！记得把收入记一笔，战绩会更好看' },
  partial: { icon: '💪', label: '做了一半',    tip: '先完成一半已经是很棒的开始，明天接着把它做完' },
  miss:    { icon: '🌅', label: '今天没做',    tip: '没关系，搞钱是长期的事，明天又有一条新路子等你' },
};
function renderTodayReview(tr) {
  if (!tr) return '';
  const today = todayStr();
  const st = (state.reviews || {})[today];
  if (st) {
    const m = REVIEW_LABEL[st] || REVIEW_LABEL.miss;
    const note = (state.reviewNotes || {})[today] || '';
    return `
    <div class="today-review ${st}">
      <div class="trv-top">
        <span class="trv-label">📊 今日执行复盘</span>
        <span class="trv-status">${m.icon} ${m.label}</span>
      </div>
      <div class="trv-tip">${m.tip}</div>
      ${st === 'done'
        ? `<button class="trv-btn record" data-review-record="${tr.id}">💰 记一笔今天的收入</button>`
        : ''}
      ${(st === 'done' || st === 'partial') ? `
        ${note
          ? `<div class="rv-note saved" data-rv-note-edit>
              <div class="rv-note-ico">📝</div>
              <div class="rv-note-txt">${esc(note)}</div>
              <div class="rv-note-act">✎ 修改</div>
            </div>`
          : `<div class="rv-note">
              <textarea class="rv-note-input" data-rv-note-input maxlength="60" rows="2" placeholder="写下今天执行的心得，比如：接到了第一单，赚了 50（限 60 字）"></textarea>
              <button class="rv-note-save" data-rv-note-save>💾 保存心得</button>
            </div>`}
      ` : ''}
      <div class="trv-repick" data-review-repick>↺ 重新选择</div>
    </div>`;
  }
  return `
    <div class="today-review">
      <div class="trv-top"><span class="trv-label">📊 今日执行复盘</span></div>
      <div class="trv-q">今天把「${esc(tr.title)}」执行得怎么样？</div>
      <div class="trv-actions">
        <button class="trv-btn done" data-review="done">✅ 做了</button>
        <button class="trv-btn partial" data-review="partial">🔁 做了一半</button>
        <button class="trv-btn miss" data-review="miss">❌ 没做</button>
      </div>
    </div>`;
}
// 连续执行里程碑：达到 7/30/60 天且未发过奖 → 发金币 + 全屏庆祝
function checkExecStreakReward() {
  const streak = reviewStats().streak;
  if (!streak) return;
  const bonus = EXEC_STREAK_REWARDS[streak];
  if (bonus && !(state.execStreakRewards || []).includes(streak)) {
    (state.execStreakRewards = state.execStreakRewards || []).push(streak);
    addCoins(bonus, `连续执行 ${streak} 天里程碑`);
    setTimeout(() => showExecCel(streak, bonus), 500);
  }
}

// 执行里程碑全屏庆祝弹窗：强化「执行」的仪式感
function showExecCel(streak, bonus) {
  if (document.querySelector('.exec-cel')) return;
  const mask = el(`
    <div class="exec-cel">
      <div class="ec-card">
        <div class="ec-icon">🏆</div>
        <div class="ec-title">连续执行 <b>${streak}</b> 天！</div>
        <div class="ec-coins">+${bonus} 🪙</div>
        <div class="ec-sub">把路子执行成肌肉记忆，<br>钱才会追着你跑</div>
        <button class="ec-btn" data-close>太棒了，继续冲！</button>
      </div>
    </div>`);
  const emojis = ['🎉', '✨', '💰', '🌟', '🎊', '🤑', '💪', '🔥'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  setTimeout(() => toast(`🔥 连续执行 ${streak} 天里程碑，+${bonus} 金币 🪙`), 300);
}

// 签到里程碑全屏庆祝弹窗：与执行里程碑对称，双引擎都全屏庆祝
function showSignCel(streak, bonus) {
  if (document.querySelector('.exec-cel')) return;
  const mask = el(`
    <div class="exec-cel">
      <div class="ec-card">
        <div class="ec-icon">🔥</div>
        <div class="ec-title">连续签到 <b>${streak}</b> 天！</div>
        <div class="ec-coins">+${bonus} 🪙</div>
        <div class="ec-sub">每天打卡不缺席，<br>把习惯慢慢变成本金</div>
        <button class="ec-btn" data-close>收下奖励</button>
      </div>
    </div>`);
  const emojis = ['🔥', '✨', '💰', '🌟', '🎊', '🤑', '💪', '⚡'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
}

// 执行统计：复盘天数 / 执行率 / 连续执行天数（从今天或昨天往前数连续 done）
function reviewStats() {
  const rv = state.reviews || {};
  const days = Object.keys(rv);
  const done = days.filter(d => rv[d] === 'done').length;
  let streak = 0;
  const d = new Date();
  if (rv[todayStr()] !== 'done') d.setDate(d.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (rv[ds] === 'done') { streak++; d.setDate(d.getDate() - 1); } else break;
  }
  return { days: days.length, done, rate: days.length ? Math.round(done / days.length * 100) : 0, streak };
}
// 连续执行里程碑首页进度条：与 hero 内签到里程碑条对称，强化「签到+执行」双引擎
function renderExecMile() {
  const st = reviewStats().streak;
  if (st < 1) return '';
  const keys = Object.keys(EXEC_STREAK_REWARDS).map(Number).sort((a, b) => a - b);
  const next = keys.find(k => k > st);
  if (!next) return `<div class="streak-ms exec done"><span>🏆 全部连续执行里程碑已解锁（${st} 天）</span></div>`;
  const bonus = EXEC_STREAK_REWARDS[next];
  const pct = Math.min(100, Math.round(st / next * 100));
  return `
    <div class="streak-ms exec">
      <div class="ms-top"><span>💪 连续执行 <b>${st}</b> 天</span><span class="ms-next">距 <b>${next}</b> 天 · 奖励 <b>+${bonus}</b> 🪙</span></div>
      <div class="ms-bar"><div class="ms-fill" style="width:${pct}%"></div></div>
    </div>`;
}
// 执行×收入关联：执行完成(done)且当天记过收入的日子，平均每天赚多少
function execIncomeStats() {
  const rv = state.reviews || {};
  const recByDate = {};
  state.records.forEach(r => { if (r.type === 'in' && r.date) recByDate[r.date] = (recByDate[r.date] || 0) + r.amount; });
  let total = 0, n = 0;
  Object.keys(rv).forEach(ds => { if (rv[ds] === 'done' && recByDate[ds]) { total += recByDate[ds]; n++; } });
  return { n, total, avg: n ? Math.round(total / n) : 0, doneDays: Object.keys(rv).filter(d => rv[d] === 'done').length };
}
function renderReviewStats() {
  const s = reviewStats();
  if (s.days === 0) return '';
  const nextKey = Object.keys(EXEC_STREAK_REWARDS).map(Number).sort((a,b) => a-b)
    .find(k => k > s.streak && !(state.execStreakRewards || []).includes(k));
  const nextLine = nextKey
    ? `<div class="rs-next">🔥 距连续执行 <b>${nextKey} 天</b> · 奖励 <b>+${EXEC_STREAK_REWARDS[nextKey]} 🪙</b></div>`
    : (s.streak >= 60 ? `<div class="rs-next done">🏆 全部连续执行里程碑已解锁</div>` : '');
  const ei = execIncomeStats();
  const incomeLine = ei.doneDays > 0
    ? (ei.n > 0
        ? `<div class="rs-income">💸 执行过的 <b>${ei.n}</b> 天里，平均每天赚 <b>¥${fmt(ei.avg)}</b></div>`
        : `<div class="rs-income hint">💡 执行过的 ${ei.doneDays} 天还没有收入记录，记得把赚到的钱记一笔</div>`)
    : '';
  return `
    <div class="review-stats">
      <div class="rs-head"><span>📊 执行战绩</span><span class="rs-sub">坚持执行，路子才会长钱</span></div>
      <div class="rs-grid">
        <div class="rs-cell"><div class="rs-num">${s.days}<small>天</small></div><div class="rs-lb">执行复盘</div></div>
        <div class="rs-cell"><div class="rs-num">${s.rate}<small>%</small></div><div class="rs-lb">执行率</div></div>
        <div class="rs-cell"><div class="rs-num">${s.streak}<small>天</small></div><div class="rs-lb">连续执行</div></div>
      </div>
      ${incomeLine}
      ${nextLine}
    </div>`;
}
function masteryStats() {
  const routes = allRoutes();
  const total = routes.length;
  const mastered = routes.filter(r => roadmapDone(r.id)).length;
  const pct = total ? Math.round(mastered / total * 100) : 0;
  return { total, mastered, pct };
}
function rewardLadder() {
  const signRewarded = state.streakRewards || [];
  const execRewarded = state.execStreakRewards || [];
  const mk = (keys, rewarded, coinsMap) => {
    const items = keys.map(k => ({ k, coins: coinsMap[k], done: rewarded.includes(k) }));
    const next = items.find(i => !i.done);
    return items.map(i => ({ ...i, current: !i.done && i === next }));
  };
  return {
    sign: mk([7, 30, 60], signRewarded, STREAK_REWARDS),
    exec: mk([7, 30, 60], execRewarded, EXEC_STREAK_REWARDS)
  };
}
function nextRewardLine() {
  const cands = [];
  const sKeys = [7, 30, 60].filter(k => !(state.streakRewards || []).includes(k));
  if (state.streak > 0 && sKeys.length) {
    const k = sKeys[0];
    cands.push({ pct: Math.min(100, Math.round(state.streak / k * 100)), label: `连续签到再坚持 ${k - state.streak} 天`, reward: STREAK_REWARDS[k], emoji: '🔥' });
  }
  const eStreak = reviewStats().streak;
  const eKeys = [7, 30, 60].filter(k => !(state.execStreakRewards || []).includes(k));
  if (eStreak > 0 && eKeys.length) {
    const k = eKeys[0];
    cands.push({ pct: Math.min(100, Math.round(eStreak / k * 100)), label: `连续执行再坚持 ${k - eStreak} 天`, reward: EXEC_STREAK_REWARDS[k], emoji: '💪' });
  }
  const net = state.records.reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
  const eMs = Object.keys(EARN_REWARDS).map(Number).sort((a, b) => a - b).filter(k => net < k && !(state.earnRewards || []).includes(k));
  if (net > 0 && eMs.length) {
    const k = eMs[0];
    cands.push({ pct: Math.min(100, Math.round(net / k * 100)), label: `累计净赚还差 ¥${fmt(k - net)}`, reward: EARN_REWARDS[k], emoji: '💰' });
  }
  const mGoal = state.monthGoal || 1000;
  const mInc = monthIncome();
  if (mInc > 0 && mInc < mGoal) {
    cands.push({ pct: Math.min(100, Math.round(mInc / mGoal * 100)), label: `本月目标还差 ¥${fmt(mGoal - mInc)}`, reward: GOAL_REWARD, emoji: '🎯' });
  }
  const wk = weekStats(0).income;
  const wGoal = state.weekGoal || Math.round((state.monthGoal || 1000) / 4.35);
  if (wk > 0 && wk < wGoal) {
    cands.push({ pct: Math.max(0, Math.min(100, Math.round(wk / wGoal * 100))), label: `本周目标还差 ¥${fmt(wGoal - wk)}`, reward: WEEK_GOAL_REWARD, emoji: '📅' });
  }
  if (!cands.length) return null;
  const next = cands.reduce((a, b) => (b.pct > a.pct ? b : a));
  return { ...next, pct: Math.max(1, next.pct) };
}
function setTodayReview(st) {
  const today = todayStr();
  const tr = routeForDate(today);
  state.reviews = state.reviews || {};
  state.reviewRewarded = state.reviewRewarded || {};
  const first = !state.reviewRewarded[today];
  state.reviews[today] = st;
  const bonus = first && st !== 'miss' ? (REVIEW_REWARD[st] || 0) : 0;
  if (bonus) {
    state.reviewRewarded[today] = 1;
    addCoins(bonus, st === 'done' ? '今日执行复盘：做了' : '今日执行复盘：做了一半');
  }
  saveState();
  notifyNewAchievements();
  if (st === 'done') {
    checkExecStreakReward();
    toast(`🎉 太棒了！执行是赚钱的第一步${bonus ? ` +${bonus} 金币` : ''}`);
    render('home');
    if (tr) setTimeout(() => openMoneySheet(tr.id), 450);
  } else if (st === 'partial') {
    toast(`💪 先完成一半，已经比躺平强了！明天继续${bonus ? ` +${bonus} 金币` : ''}`);
    render('home');
  } else {
    toast('🌅 没关系，明天还有新路子，别错过签到哦');
    render('home');
  }
}

// ============ 新手路线图 ============
// 7 条新手路子组成的成长路径：先跑通一单 → 练手艺 → 变现 → 本地口碑 → 理财增值
const ROADMAP = [
  { routeId: 'd002', icon: '🌱', name: '先赚到第一笔', desc: '简历精修 · 零门槛接单' },
  { routeId: 'd003', icon: '📝', name: '练好一门手艺', desc: '证件照修图 · 快速上手' },
  { routeId: 's002', icon: '💻', name: '技能变现金', desc: 'Excel 代做 · 服务变现' },
  { routeId: 'c010', icon: '📷', name: '用内容接流量', desc: '探店笔记 · 图文获客' },
  { routeId: 'd004', icon: '🛍️', name: '学做小生意', desc: '闲鱼倒卖 · 低买高卖' },
  { routeId: 'l001', icon: '🐱', name: '经营本地口碑', desc: '宠物喂养 · 信任复购' },
  { routeId: 'f002', icon: '💰', name: '让钱开始生钱', desc: '货币基金 · 稳健增值' },
];

// 阶段解锁判定：记账过 / 加入过打卡 / 收藏过，任一即算解锁
function roadmapDone(id) {
  if (state.liked[id]) return true;
  if (state.records.some(r => r.routeId === id)) return true;
  if (Object.keys(state.checks).some(k => k.startsWith(id + '::'))) return true;
  return false;
}

function renderRoadmap(routes) {
  const doneCount = ROADMAP.filter(s => roadmapDone(s.routeId)).length;
  const pct = Math.round(doneCount / ROADMAP.length * 100);
  return `
    <div class="section-title">🗺️ 新手路线图 <span class="more">${doneCount}/${ROADMAP.length}</span></div>
    <div class="roadmap-card">
      <div class="rm-progress"><div class="rm-fill" style="width:${pct}%"></div></div>
      ${ROADMAP.map((s, i) => {
        const done = roadmapDone(s.routeId);
        const isCurrent = !done && !ROADMAP.slice(0, i).some(p => !roadmapDone(p.routeId));
        const r = routes.find(x => x.id === s.routeId);
        return `
        <div class="rm-step ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}" data-rm-open="${s.routeId}">
          <div class="rm-no">${done ? '✓' : i + 1}</div>
          <div class="rm-ico">${s.icon}</div>
          <div class="rm-main">
            <div class="rm-name">${s.name}${isCurrent ? ' <span class="rm-cur">· 就做这条</span>' : ''}</div>
            <div class="rm-desc">${s.desc}${r ? ' · ' + esc(r.tag) : ''}</div>
          </div>
          <div class="rm-arrow">›</div>
        </div>`;
      }).join('')}
      <div class="rm-foot">${doneCount === ROADMAP.length
        ? '🎉 已走完新手路线，现在可以挑战更难的路子！'
        : `跟着路线一步一步走，第 ${doneCount + 1} 步：${ROADMAP[doneCount].name}`}</div>
    </div>`;
}

// ============ 新手任务系统 ============
const TASKS = [
  { id: 't1', icon: '👋', name: '迈出第一步', desc: '开启你的搞钱之路', reward: 20, ready: () => true },
  { id: 't2', icon: '☀️', name: '第一次签到', desc: '点首页右上角签到', reward: 30, ready: () => Object.keys(state.checkin).length > 0 },
  { id: 't3', icon: '📋', name: '加入打卡', desc: '把今日路子加入打卡', reward: 30, ready: () => Object.keys(state.checks).length > 0 },
  { id: 't4', icon: '💰', name: '第一笔收入', desc: '记一笔收入账', reward: 40, ready: () => state.records.some(r => r.type === 'in') },
  { id: 't5', icon: '❤️', name: '收藏一条路子', desc: '看到合适的点 ♡', reward: 20, ready: () => Object.keys(state.liked).length > 0 },
  { id: 't6', icon: '🔥', name: '连续打卡 3 天', desc: '坚持就是胜利', reward: 50, ready: () => (state.streak || 0) >= 3 },
  { id: 't7', icon: '🏁', name: '完成今日清单', desc: '今日路子全部勾完', reward: 60, ready: () => {
    const tr = routeForDate(todayStr());
    return tr ? totalCheckDone(tr) : false;
  } },
];

// 检测并自动发放新手任务奖励（在关键动作后调用）
function checkTasks() {
  let changed = false;
  TASKS.forEach(t => {
    if (!state.tasks.includes(t.id) && t.ready()) {
      state.tasks.push(t.id);
      addCoins(t.reward, `新手任务：${t.name}`);
      changed = true;
      toast(`🎖️ 新手任务完成：${t.name} +${t.reward} 金币`);
    }
  });
  if (changed) saveState();
  return changed;
}

function taskProgress() {
  const done = TASKS.filter(t => state.tasks.includes(t.id)).length;
  return { done, total: TASKS.length, pct: Math.round(done / TASKS.length * 100) };
}

function renderTaskBanner() {
  if (taskProgress().done >= TASKS.length) {
    return `<div class="task-banner done" data-open-tasks>
      <div class="tb-left"><div class="tb-title">🏆 新手任务全完成</div><div class="tb-sub">太棒了，继续冲！</div></div>
    </div>`;
  }
  const tp = taskProgress();
  return `<div class="task-banner" data-open-tasks>
    <div class="tb-left">
      <div class="tb-title">🎯 新手任务</div>
      <div class="tb-sub">完成小任务赚金币，点开查看</div>
    </div>
    <div class="tb-prog">
      <div class="tb-num">${tp.done}/${tp.total}</div>
      <div class="tb-bar"><div class="tb-fill" style="width:${tp.pct}%"></div></div>
    </div>
    <div class="tb-arrow">›</div>
  </div>`;
}

function openTasksSheet() {
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>🎯 新手任务</h3>
        <p style="font-size:12px;color:var(--text3);margin:-4px 0 12px">完成任务自动发金币，金币用于升级等级</p>
        ${TASKS.map(t => {
          const done = state.tasks.includes(t.id);
          const ready = !done && t.ready();
          return `<div class="task-item ${done ? 'done' : ready ? 'ready' : ''}">
            <div class="ti-ico">${done ? '✅' : t.icon}</div>
            <div class="ti-main">
              <div class="ti-name">${t.name}</div>
              <div class="ti-desc">${t.desc}</div>
            </div>
            <div class="ti-reward">+${t.reward}</div>
            <div class="ti-state">${done ? '已领取' : ready ? '去完成' : '未完成'}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('[data-close]').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
}

// ============ 路子卡片 ============
function routeCard(r, rank, badge) {
  const cat = CATS[r.cat] || { icon:'💰', color:'#f5b93c' };
  const liked = state.liked[r.id];
  return `
    <div class="route-card ${liked ? 'liked' : ''}" data-open="${r.id}">
      ${rank ? `<div class="rc-rank ${rank === 1 ? 'top' : ''}">TOP${rank}</div>` : ''}
      <div class="rc-ico" style="background:${cat.bg}; color:${cat.color}">${cat.icon}</div>
      <div class="rc-main">
        <div class="rc-title">${badge ? `<span class="rc-badge ${badge.k}">${badge.t}</span>` : ''}${esc(r.title)}</div>
        <div class="rc-tag">${esc(r.tag)}</div>
        <div class="rc-bottom">
          <span class="rc-num">¥<b>${r.monthly[0]}-${r.monthly[1]}</b>/月</span>
          <span class="rc-num">启动 ¥${r.capital}</span>
          <div class="rc-diff">${[1,2,3,4,5].map(i => `<div class="diff-dot ${i<=r.diff?'on':''}"></div>`).join('')}</div>
        </div>
      </div>
      <div class="rc-heart ${liked ? 'liked' : ''}" data-like="${r.id}">${liked ? '♥' : '♡'}</div>
    </div>`;
}

// ============ 路子库 ============
let libFilter = 'all';
let libSearch = '';
let libSort = 'default';
let likesFilter = 'all';
let likesSort = 'time';

function renderLibrary(routes) {
  let list = routes;
  if (libFilter === 'newbie') list = list.filter(isNewbieFriendly);
  else if (libFilter !== 'all') list = list.filter(r => r.cat === libFilter);
  if (libSearch) {
    const q = libSearch.toLowerCase();
    list = list.filter(r => (r.title + r.tag + (r.audience||'') + (r.why||'')).toLowerCase().includes(q));
  }
  if (libSort === 'money') list = [...list].sort((a,b) => (b.monthly[1] - a.monthly[1]));
  if (libSort === 'easy') list = [...list].sort((a,b) => (a.diff - b.diff));
  if (libSort === 'capital') list = [...list].sort((a,b) => (a.capital - b.capital));

  // 今日/明日路子角标
  const tomD2 = new Date(); tomD2.setDate(tomD2.getDate() + 1);
  const tomStr2 = `${tomD2.getFullYear()}-${String(tomD2.getMonth()+1).padStart(2,'0')}-${String(tomD2.getDate()).padStart(2,'0')}`;
  const todayId = state.routeHistory[todayStr()] || ((routeForDate(todayStr()) || {}).id);
  const tomorrowId = state.routeHistory[tomStr2] || ((routeForDate(tomStr2) || {}).id);

  const chips = [{k:'all', name:'全部'}, {k:'newbie', name:'🌱新手'}, ...Object.entries(CATS).map(([k,v]) => ({k, name:v.name}))]
    .map(c => `<div class="filter-chip ${libFilter===c.k?'active':''}" data-filter="${c.k}">${c.name}</div>`).join('');

  const sortChips = [
    {k:'default', name:'默认'},
    {k:'money', name:'收入高'},
    {k:'easy', name:'易上手'},
    {k:'capital', name:'成本低'},
  ].map(c => `<div class="filter-chip ${libSort===c.k?'active':''}" data-sort="${c.k}">${c.name}</div>`).join('');

  // 高收入 TOP 榜：按月收入潜力 top 8 横向滚动推荐
  const topRoutes = [...routes].sort((a,b) => b.monthly[1] - a.monthly[1]).slice(0, 8);
  const topStrip = `
    <div class="top-income">
      <div class="ti-head"><span>💰 高收入 TOP</span><span class="ti-sub">收入潜力最高 · 点开看看</span></div>
      <div class="ti-scroll">
        ${topRoutes.map((r, i) => {
          const cat = CATS[r.cat] || { icon:'💰', bg:'rgba(245,185,60,.15)' };
          return `
          <div class="ti-item" data-open="${r.id}">
            <div class="ti-rank">TOP ${i + 1}</div>
            <div class="ti-ico" style="background:${cat.bg}">${cat.icon}</div>
            <div class="ti-name">${esc(r.title)}</div>
            <div class="ti-m">¥${fmt(r.monthly[1])}/月</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  // v4.38.0 每日路子档案：最近 14 天每天教过的路子（routeForDate 确定性回放）
  const arcRows = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const r = routeForDate(ds);
    if (!r) continue;
    const w = ['日','一','二','三','四','五','六'][d.getDay()];
    const cat = CATS[r.cat] || { icon:'💰', bg:'rgba(245,185,60,.15)' };
    arcRows.push(`<div class="da-row" data-open="${r.id}">
      <div class="da-date"><b>${d.getMonth()+1}/${d.getDate()}</b><em>周${w}</em>${i === 0 ? '<span class="da-today">今日</span>' : ''}</div>
      <div class="da-ico" style="background:${cat.bg}">${cat.icon}</div>
      <div class="da-title">${esc(r.title)}</div>
      <div class="da-arrow">›</div>
    </div>`);
  }
  const arcBlock = arcRows.length ? `
    <div class="daily-archive">
      <div class="da-head"><span>📅 每日路子</span><span class="da-sub">最近 14 天教过你什么 · 点开回顾</span></div>
      ${arcRows.join('')}
    </div>` : '';

  return `
    <div class="page-head">
      <div>
        <div class="page-title">路子<strong class="gold">库</strong></div>
        <div class="page-sub">共 ${routes.length} 条可落地的方法</div>
      </div>
      <button class="random-btn" data-random-route>🎲 随机</button>
    </div>
    ${topStrip}
    ${arcBlock}
    <div class="search-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input id="search-input" placeholder="搜方法、关键词，如「PPT」「闲鱼」" value="${esc(libSearch)}">
    </div>
    ${!libSearch && (state.searchHistory || []).length ? `
      <div class="search-hist">
        <span class="sh-lb">最近搜</span>
        ${state.searchHistory.map(w => `<span class="sh-chip" data-search-hist="${esc(w)}">${esc(w)}</span>`).join('')}
        <span class="sh-clear" data-clear-search-hist>清空</span>
      </div>` : ''}
    <div class="filter-bar">${chips}</div>
    <div class="filter-bar" style="padding-top:0">${sortChips}</div>
    ${list.length ? list.map(r => routeCard(r, 0, r.id === todayId ? {k:'today', t:'今日'} : r.id === tomorrowId ? {k:'tomorrow', t:'明日'} : null)).join('') :
      `<div class="empty"><div class="e-ico">🔍</div><div class="e-text">没找到相关路子，换个关键词试试</div></div>`}
  `;
}

// ============ 详情页 ============
function renderEarnBlock(r) {
  const recs = state.records.filter(x => x.routeId === r.id);
  if (!recs.length) return '';
  const inSum = recs.filter(x => x.type === 'in').reduce((s, x) => s + x.amount, 0);
  const outSum = recs.filter(x => x.type === 'out').reduce((s, x) => s + x.amount, 0);
  const net = inSum - outSum;
  const inCount = recs.filter(x => x.type === 'in').length;
  const days = new Set(recs.map(x => x.date)).size;
  const cat = CATS[r.cat] || {};
  const sorted = [...recs].filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const rows = sorted.map(x => `
    <div class="ebd-row">
      <span class="ebd-date">${x.date.slice(5)}</span>
      <span class="ebd-title">${esc(x.title || r.title)}</span>
      <span class="ebd-amt ${x.type === 'out' ? 'red' : ''}">${x.type === 'out' ? '-' : '+'}¥${x.amount}</span>
    </div>`).join('');
  // v4.35.0 成本核算：总投入 / 已回款 / 回本率（未投入成本则显示零成本起步）
  const foot = outSum > 0
    ? `<div class="eb-foot"><span>总投入 <b>¥${fmt(outSum)}</b></span><span>已回款 <b>¥${fmt(inSum)}</b></span><span class="${net < 0 ? 'red' : 'ok'}">${net < 0 ? `还差 ¥${fmt(-net)} 回本` : `回本率 <b>${Math.round(inSum / outSum * 100)}%</b>`}</span></div>`
    : `<div class="eb-foot"><span>累计收入 <b>¥${fmt(inSum)}</b></span><span class="ok">零成本起步 🎉</span></div>`;
  // v4.47.0 执行评估：坚持天数 × 净赚 双维度判断「这条路子值不值继续」
  const chkDays = Object.keys(state.checks).filter(k => k.split('::')[0] === r.id).length;
  const doing = Math.max(days, chkDays);
  let verdict = '';
  if (doing >= 3 && net > 0) {
    verdict = `<div class="eb-verdict ok"><span class="ev-ico">🔥</span><div class="ev-main"><b>路子走通了，继续深耕</b><span>坚持 ${doing} 天 · 净赚 ¥${fmt(net)}，复利越滚越大，别停</span></div></div>`;
  } else if (doing >= 3 && net <= 0) {
    verdict = `<div class="eb-verdict warn"><span class="ev-ico">⚖️</span><div class="ev-main"><b>检查一下执行是否到位</b><span>坚持 ${doing} 天还没赚到钱，先跑通首单，再想怎么变现</span></div></div>`;
  } else if (doing < 3 && net > 0) {
    verdict = `<div class="eb-verdict pot"><span class="ev-ico">💎</span><div class="ev-main"><b>刚起步就有回报，有搞头</b><span>才 ${doing} 天就净赚 ¥${fmt(net)}，乘胜追击加大投入</span></div></div>`;
  } else if (doing > 0 && net <= 0) {
    verdict = `<div class="eb-verdict new"><span class="ev-ico">🌱</span><div class="ev-main"><b>路子需要时间，别急着放弃</b><span>刚开始 ${doing} 天，先按打卡清单坚持 7 天再看结果</span></div></div>`;
  }
  return `
    <div class="earn-block">
      <div class="ebx-head">
        <div class="eb-ico" style="background:${cat.bg || 'rgba(245,185,60,.15)'}">💰</div>
        <div class="eb-main">
          <div class="eb-t">这条路子为你赚到</div>
          <div class="eb-amt">¥${fmt(net)} <span class="eb-note">· ${inCount} 笔收入</span></div>
          <div class="eb-sub">执行 ${days} 天 · ${net > 0 ? '复利会越滚越大，继续做' : '再坚持一下，先跑通首单'}</div>
        </div>
        <button class="eb-btn" data-earn="${r.id}">记一笔</button>
      </div>
      ${rows ? `<div class="eb-list">${rows}</div>` : ''}
      ${foot}
      ${verdict}
    </div>`;
}
function renderDetail(r) {
  const cat = CATS[r.cat] || { name:'', icon:'💰', color:'#f5b93c', bg:'rgba(245,185,60,.15)' };
  const liked = state.liked[r.id];
  const today = todayStr();
  const dayChecks = state.checks[`${r.id}::${today}`] || {};
  const doneCount = routeDoneTotal(r.id);
  const totalCount = routeChecklistTotal(r.id);

  // 进度：从打卡和历史步骤推断
  const prog = state.progress[r.id] || 0;

  return `
    <div class="detail-hero">
      <div class="back" data-back><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>返回</div>
      <div class="detail-title">${esc(r.title)}</div>
      <div class="detail-tag">${esc(r.tag)}</div>
      <div class="meta-grid">
        <div class="meta-cell"><div class="v">${'●'.repeat(r.diff)}${'○'.repeat(5-r.diff)}</div><div class="k">难度</div></div>
        <div class="meta-cell"><div class="v green">¥${r.capital}</div><div class="k">启动资金</div></div>
        <div class="meta-cell"><div class="v">¥${fmt(r.monthly[0])}-${fmt(r.monthly[1])}</div><div class="k">月收入潜力</div></div>
      </div>
      <div class="meta-grid" style="grid-template-columns: repeat(2,1fr)">
        <div class="meta-cell"><div class="v">${r.cycle} 天</div><div class="k">见效周期</div></div>
        <div class="meta-cell"><div class="v green">${esc(r.audience || '所有人')}</div><div class="k" style="font-size:10px;word-break:break-all">适合人群</div></div>
      </div>
    </div>

    ${currentPreview ? `<div class="preview-banner"><span>🌅 明日路子</span>明天开始执行，先提前了解步骤与避坑点</div>` : ''}

    ${renderEarnBlock(r)}

    <div class="card" style="margin-bottom:14px">
      <div class="sec-num" style="margin-bottom:8px;background:rgba(79,140,255,.2);color:var(--blue)">为什么能赚</div>
      <div style="font-size:14px;color:var(--text2);line-height:1.8">${esc(r.why)}</div>
    </div>

    <div class="step-progress-wrap">
      <div class="sp-bar"><div class="fill" style="width:${prog/r.steps.length*100}%"></div></div>
      <div class="sp-label"><span>你的进度</span><span>${prog}/${r.steps.length} 步</span></div>
    </div>

    <div class="detail-sec">
      <div class="sec-h"><div class="sec-num">1</div>完整实施步骤</div>
      ${r.steps.map((s, i) => `
        <div class="step-item ${i < prog ? 'done' : ''}" data-step="${i}">
          <div class="step-no">${i + 1}</div>
          <div>
            <div class="st-do">${esc(s.do)}</div>
            ${s.note ? `<div class="st-note">${esc(s.note)}</div>` : ''}
          </div>
          <div class="step-check">${i < prog ? '✓' : ''}</div>
        </div>`).join('')}
    </div>

    <div class="detail-sec">
      <div class="sec-h"><div class="sec-num green">2</div>避坑指南</div>
      ${r.pitfalls.map(p => `
        <div class="pitfall-item"><div class="w">⚠️</div><div>${esc(p)}</div></div>`).join('')}
    </div>

    <div class="detail-sec">
      <div class="sec-h"><div class="sec-num">3</div>今天就做第一步</div>
      <div class="first-block"><span class="lb">👣 ${esc(r.firstStep)}</span></div>
    </div>

    <div class="detail-sec">
      <div class="sec-h"><div class="sec-num green">4</div>7 天打卡计划</div>
      <div class="card" style="margin:0;padding:14px">
        ${r.checklist.map((c, i) => {
          const done = dayChecks[i] || Object.keys(state.checks).some(k =>
            k.startsWith(r.id + '::') && state.checks[k][i]);
          return `<div class="check-item ${done?'done':''}" data-dcheck="${i}">
            <div class="check-box ${done?'done':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
            <div class="ck-text">${esc(c)}</div>
          </div>`;
        }).join('')}
        ${customChecksFor(r.id).map((cc, j) => {
          const i = r.checklist.length + j;
          const done = dayChecks[i] || Object.keys(state.checks).some(k =>
            k.startsWith(r.id + '::') && state.checks[k][i]);
          return `<div class="check-item cc-item ${done?'done':''}" data-dcheck="${i}">
            <div class="check-box ${done?'done':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
            <div class="ck-text">${esc(cc)}</div>
            <button class="cc-del" data-del-custom-check="${j}" data-del-custom-route="${r.id}" title="删除这项">✕</button>
          </div>`;
        }).join('')}
        <button class="cc-add" data-add-custom-check="${r.id}">＋ 添加自定义打卡项</button>
        <div class="cc-progress"><div class="bar" style="width:${totalCount?doneCount/totalCount*100:0}%"></div></div>
        <div style="font-size:11px;color:var(--text3);margin-top:6px;text-align:right">${doneCount}/${totalCount} 已完成</div>
      </div>
    </div>

    <div style="padding:0 16px">
      <div class="like-row">
        <button class="vote-btn ${state.routeVotes[r.id]==='like'?'active':''}" data-vote="${r.id}">${state.routeVotes[r.id]==='like' ? '已赞 ✓' : '有用 👍'}</button>
        <button class="secondary" data-like2="${r.id}">${liked ? '已收藏 ♥' : '收藏 ♡'}</button>
        <button class="primary" data-track="${r.id}">${currentPreview ? '🌅 明天开始' : '加入打卡'}</button>
      </div>
      <div class="action-row">
        <button class="act-btn gold" data-share="${r.id}">📤 分享</button>
        <button class="act-btn" data-compare="${r.id}">⚖️ 对比</button>
        <button class="act-btn" data-share-card="${r.id}">🖼️ 图片</button>
        <button class="act-btn" data-copy-first="${r.id}">复制首步</button>
        <button class="act-btn" data-copy-list="${r.id}">复制清单</button>
      </div>
      <div style="height:16px"></div>
    </div>

    ${(() => {
      const ch = challengeState(r.id);
      if (ch && ch.done) {
        return `<div class="challenge-box done"><span class="cb-ico">🏆</span><span>这条路子 30 天挑战已完成，奖励已领取</span></div>`;
      }
      if (ch) {
        const pct = Math.min(100, Math.round(ch.days / 30 * 100));
        return `
          <div class="challenge-box">
            <div class="cb-head"><span class="cb-t">🔥 30 天挑战 · 第 <b>${ch.days}</b>/30 天</span><span class="cb-pct">${pct}%</span></div>
            <div class="cb-bar"><div class="cb-fill" style="width:${pct}%"></div></div>
            <div class="cb-sub">每天完成打卡清单即推进一天，坚持满 30 天 +${CHALLENGE_REWARD} 🪙</div>
          </div>`;
      }
      return `
        <div class="challenge-box idle">
          <button class="ch-start" data-challenge-start="${r.id}">🔥 开始 30 天挑战</button>
          <div class="cb-sub">把这条路子坚持 30 天，每天打卡推进，满 30 天 +${CHALLENGE_REWARD} 金币</div>
        </div>`;
    })()}

    ${(() => {
      const rel = allRoutes().filter(x => x.id !== r.id && x.cat === r.cat).slice(0, 3);
      if (!rel.length) return '';
      return `
      <div class="detail-sec">
        <div class="sec-h"><div class="sec-num gold">⚡</div>同类路子推荐</div>
        ${rel.map(rc => `
          <div class="rel-item" data-open="${rc.id}">
            <div class="rel-ico" style="background:${(CATS[rc.cat]||{}).bg || 'rgba(245,185,60,.15)'}">${(CATS[rc.cat]||{}).icon || '💰'}</div>
            <div class="rel-main">
              <div class="rel-title">${esc(rc.title)}</div>
              <div class="rel-tag">${esc(rc.tag)}</div>
            </div>
            <div class="rel-arrow">›</div>
          </div>`).join('')}
      </div>`;
    })()}
  `;
}

// ============ 教程页 ============
const GUIDE = [
  {
    title: '心态：先想清楚再动手',
    body: `搞钱最大的坑不是能力不够，而是<strong>乱跟风</strong>。看到别人做啥赚到钱就冲，结果三分钟热度，什么都没做成。<br><br>记住三个原则：<br><b>1. 从自己能做的开始</b>——别一上来就做跨境电商、搞课程，先做门槛低、能快速见到钱的。<br><b>2. 先跑通一次</b>——不管赚多少，先完整跑通一单，建立正反馈。<br><b>3. 坚持 30 天</b>——绝大多数路子，前 30 天都是积累期，别在 29 天放弃。`,
    tip: '给自己定个小目标：30 天内靠副业赚到第一笔 100 元。'
  },
  {
    title: '选择：三条路子挑一条',
    body: `从「路子库」里挑 1-3 条，然后用三个标准筛：<br><b>资金</b>——启动资金是不是你能承受的？<br><b>时间</b>——你每天能投入 1 小时还是 5 小时？<br><b>兴趣</b>——这活儿你能坚持吗？<br><br>建议新手优先选：难度 ≤ 3、启动资金 ≤ 500、见效周期 ≤ 7 天的路子。`,
    tip: '推荐起步：PPT代做、简历精修、闲鱼倒卖、宠物上门喂养。'
  },
  {
    title: '行动：今天就做第一步',
    body: `每条路子都给了你「今天就做这一步」。别等到周末、别等到准备充分——<strong>今天就做</strong>。<br><br>行动的原则：<br><b>1. 先做完再完美</b>——第一版丑没关系，先发出去。<br><b>2. 拆成小任务</b>——用「打卡」功能，每天做一小步，连续 7 天。<br><b>3. 记录过程</b>——每赚一笔就记到「记账」里，看着数字涨起来是最大的动力。`,
    tip: '先做完，再做好。完美主义是搞钱的天敌。'
  },
  {
    title: '坚持：建立正反馈循环',
    body: `搞钱是复利游戏。第 1 单可能只有几块钱，但流程跑通后，你的时薪会越来越高。<br><br><b>打卡</b>——每天完成任务打勾，7 天养成习惯。<br><b>记账</b>——每笔收入都记下来，月末复盘。<br><b>收藏</b>——把适合你的路子收藏起来，定期回看。<br><br>当你坚持到第二个月，回头看第一个月的记录，会发现自己进步巨大。`,
    tip: '一个月后再来学「进阶」，现在先把第一步走完。'
  },
];

function renderGuide() {
  const stage = Math.min(state.guideStage, GUIDE.length);
  const g = GUIDE[stage];
  const stepsHtml = GUIDE.map((item, i) => `
    <div class="gh-step ${i===stage?'active':''}">
      <div class="gh-dot">${i+1}</div>
      <div class="gh-lb">${i===0?'心态':i===1?'选择':i===2?'行动':'坚持'}</div>
    </div>`).join('');
  const jump = stage === 0 ? null : stage === 1 ? { txt: '📚 去路子库挑一条', to: 'library' }
    : stage === 2 ? { txt: '🏠 去看今日路子', to: 'home' }
    : { txt: '📅 查看我的坚持记录', to: 'mine' };
  return `
    <div class="guide-hero">
      <div class="gh-tag">新手手把手</div>
      <div class="gh-title">小白搞钱 4 步走</div>
      <div class="gh-sub">跟着节奏来，别跳步</div>
      <div class="gh-steps">${stepsHtml}</div>
    </div>
    <div class="guide-card">
      <h3>${esc(g.title)}</h3>
      ${g.body.split('\n').map(p => `<p>${p}</p>`).join('')}
      <div class="gc-tip ${stage>=3?'gc-green':''}">💡 ${esc(g.tip)}</div>
    </div>
    ${jump ? `<button class="guide-cta" data-guide-jump="${jump.to}">${jump.txt}</button>` : ''}
    <button class="guide-next ${stage>=GUIDE.length-1?'':''}" data-guide-next>
      ${stage >= GUIDE.length - 1 ? '🎉 全部学完，去打卡吧' : '下一步 →'}
    </button>
    <button class="guard-entry" data-guard-entry>🛡️ 先学会躲坑，再开始搞钱 · 避坑指南</button>
  `;
}

// ============ 打卡日历 ============
let calCursor = null; // { y, m } 1-12，null=当前月
function shiftCalCursor(delta) {
  const now = new Date();
  let y = calCursor ? calCursor.y : now.getFullYear();
  let m = calCursor ? calCursor.m : now.getMonth() + 1;
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  calCursor = { y, m };
  render(currentView);
}
function signDoneDays() {
  const done = new Set();
  Object.keys(state.checks).forEach(k => {
    const date = k.split('::')[1];
    if (date && Object.values(state.checks[k]).some(Boolean)) done.add(date);
  });
  const sign = new Set(Object.keys(state.checkin).filter(d => state.checkin[d]));
  return { done, sign };
}
function checkinStreak() {
  const { done, sign } = signDoneDays();
  const today = todayStr();
  let streak = 0;
  const cur = new Date(today);
  while (done.has(cur.toISOString().slice(0,10)) || sign.has(cur.toISOString().slice(0,10))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}
function renderCheckinCalendar() {
  const now = new Date();
  const y = calCursor ? calCursor.y : now.getFullYear();
  const m = calCursor ? calCursor.m : now.getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const { done, sign } = signDoneDays();
  const todayStr2 = todayStr();
  const isCurMonth = y === now.getFullYear() && m === now.getMonth() + 1;
  const rv = state.reviews || {};
  let cells = '';
  for (let i = 0; i < firstWeekday; i++) cells += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isFuture = ds > todayStr2;
    const isToday = ds === todayStr2;
    const isDone = done.has(ds);
    const isSign = sign.has(ds);
    const isMakeup = !!state.makeupDays[ds];
    const r = rv[ds];
    const rvCls = r === 'done' ? 'rv-done' : r === 'partial' ? 'rv-partial' : r === 'miss' ? 'rv-miss' : '';
    const cls = ['cal-cell', isToday ? 'today' : '', isDone ? 'done' : '', isSign && !isDone ? 'sign' : '', isMakeup ? 'makeup' : '', rvCls, isFuture ? 'future' : ''].filter(Boolean).join(' ');
    cells += `<div class="${cls}" ${isFuture ? '' : `data-cal-day="${ds}"`} title="${r ? '执行复盘：' + (r === 'done' ? '做了' : r === 'partial' ? '做了一半' : '没做') : ''}"><span>${d}</span>${r ? `<i class="c-rv ${r}"></i>` : ''}${isSign && !isDone ? '<i class="c-tick">' + (isMakeup ? '🔁' : '✓') + '</i>' : ''}</div>`;
  }
  const streak = checkinStreak();
  const monthTotal = [...done].filter(ds => ds.startsWith(`${y}-${String(m).padStart(2, '0')}`)).length;
  const monthSign = [...sign].filter(ds => ds.startsWith(`${y}-${String(m).padStart(2, '0')}`)).length;
  const monthRv = Object.keys(rv).filter(ds => ds.startsWith(`${y}-${String(m).padStart(2, '0')}`) && rv[ds] === 'done').length;
  return `
    <div class="cal-card">
      <div class="cal-head">
        <button class="cal-nav" data-cal-prev>‹</button>
        <div class="cal-title">${y}年${m}月</div>
        <button class="cal-nav" data-cal-next>›</button>
      </div>
      <div class="cal-grid">
        ${['日','一','二','三','四','五','六'].map(d => `<div class="cal-wd">${d}</div>`).join('')}
        ${cells}
      </div>
      <div class="cal-stats">
        <span>🔥 连续 <b>${streak}</b> 天</span>
        <span>📅 本月完成 <b>${monthTotal}</b> 天</span>
        <span>✅ 签到 <b>${monthSign}</b> 天</span>
        <span>📊 执行 <b>${monthRv}</b> 天</span>
      </div>
    </div>`;
}

// 打卡日历点某天 → 查看当天签到/收入/打卡详情
function openDayDetail(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(y, m - 1, d).getDay()];
  const signed = !!state.checkin[ds];
  const makeup = !!state.makeupDays[ds];
  const isToday = ds === todayStr();
  const dayIn = state.records.filter(r => r.date === ds && r.type === 'in').reduce((s, r) => s + r.amount, 0);
  const dayOut = state.records.filter(r => r.date === ds && r.type === 'out').reduce((s, r) => s + r.amount, 0);
  const checkKeys = Object.keys(state.checks).filter(k => k.endsWith('::' + ds));
  const checkRows = checkKeys.map(k => {
    const id = k.split('::')[0];
    const r = allRoutes().find(x => x.id === id);
    const dc = state.checks[k] || {};
    const doneN = Object.values(dc).filter(Boolean).length;
    const totalN = r ? routeChecklistTotal(id) : Object.keys(dc).length;
    return `<div class="dd-row"><span class="dd-lb">📋 ${r ? esc(r.title) : id}</span><b class="${doneN === totalN ? 'green' : ''}">${doneN}/${totalN}</b></div>`;
  }).join('');
  const statRows = `
    <div class="dd-row"><span class="dd-lb">📅 签到</span><b class="${signed ? 'green' : ''}">${signed ? (makeup ? '🔁 补签' : '✅ 已签') : '⭕ 未签'}${isToday ? ' · 今天' : ''}</b></div>
    <div class="dd-row"><span class="dd-lb">💰 收入</span><b class="${dayIn ? 'green' : ''}">${dayIn ? '¥' + fmt(dayIn) : '¥0'}</b></div>
    ${dayOut ? `<div class="dd-row"><span class="dd-lb">🛒 支出</span><b class="red">-¥${fmt(dayOut)}</b></div>` : ''}
    ${(() => {
      const r = (state.reviews || {})[ds];
      if (!r) return '';
      const map = { done: ['✅ 做了', 'green'], partial: ['🔁 做了一半', 'gold'], miss: ['❌ 没做', 'gray'] };
      const [txt, cls] = map[r] || ['', 'gray'];
      return `<div class="dd-row"><span class="dd-lb">📊 执行复盘</span><b class="${cls}">${txt}</b></div>`;
    })()}
    ${(() => {
      const n = (state.reviewNotes || {})[ds];
      if (!n) return '';
      return `<div class="dd-row"><span class="dd-lb">📝 心得</span><b style="font-weight:400;color:var(--text2);text-align:right">${esc(n)}</b></div>`;
    })()}
    ${checkRows || `<div class="dd-row"><span class="dd-lb">📋 打卡</span><b class="gray">无记录</b></div>`}`;
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet day-sheet">
        <div class="sheet-close" data-close>✕</div>
        <div class="dd-title">${y} 年 ${m} 月 ${d} 日 <span class="dd-wd">${wd}</span></div>
        <div class="dd-body">${statRows}</div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-close]')) mask.remove();
  });
}

// ============ 打卡页 ============
function renderTrack(routes) {
  const today = todayStr();
  // 收集正在打卡的路子（今天有记录或曾收藏）
  const activeIds = new Set();
  Object.keys(state.checks).forEach(k => activeIds.add(k.split('::')[0]));
  Object.keys(state.liked).forEach(k => activeIds.add(k));
  let active = [...activeIds].map(id => routes.find(r => r.id === id)).filter(Boolean);

  if (!active.length) {
    return `
      <div class="page-head">
        <div><div class="page-title">打卡<strong class="gold">本</strong></div>
        <div class="page-sub">把路子拆成每日小任务，连续完成</div></div>
      </div>
      ${renderCheckinCalendar()}
      <div class="empty">
        <div class="e-ico">📋</div>
        <div class="e-text">还没有打卡项目<br>去「路子库」选一条，加入打卡吧</div>
      </div>
    `;
  }

  return `
    <div class="page-head">
      <div><div class="page-title">打卡<strong class="gold">本</strong></div>
      <div class="page-sub">${today} · 每天完成一小步</div></div>
    </div>
    ${renderCheckinCalendar()}
    ${active.map(r => {
      const dayChecks = state.checks[`${r.id}::${today}`] || {};
      const doneTotal = routeDoneTotal(r.id);
      const total = routeChecklistTotal(r.id);
      const cat = CATS[r.cat] || {};
      return `
        <div class="check-card">
          <div class="cc-head">
            <div class="rc-ico" style="width:38px;height:38px;font-size:19px;background:${cat.bg};color:${cat.color}">${cat.icon||'💰'}</div>
            <div class="cc-title">${esc(r.title)}</div>
            <div class="cc-day">${doneTotal}/${total}</div>
          </div>
          <div class="check-list">
            ${r.checklist.map((c, i) => {
              // 已勾选过任一日期即视为完成
              const isDone = dayChecks[i] || Object.keys(state.checks).some(k =>
                k.startsWith(r.id + '::') && state.checks[k][i]);
              return `<div class="check-item ${isDone?'done':''}" data-check="${r.id}" data-checkid="${i}">
                <div class="check-box ${isDone?'done':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
                <div class="ck-text">${esc(c)}</div>
              </div>`;
            }).join('')}
            ${customChecksFor(r.id).map((cc, j) => {
              const i = r.checklist.length + j;
              const isDone = dayChecks[i] || Object.keys(state.checks).some(k =>
                k.startsWith(r.id + '::') && state.checks[k][i]);
              return `<div class="check-item cc-item ${isDone?'done':''}" data-check="${r.id}" data-checkid="${i}">
                <div class="check-box ${isDone?'done':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
                <div class="ck-text">${esc(cc)}</div>
                <button class="cc-del" data-del-custom-check="${j}" data-del-custom-route="${r.id}" title="删除这项">✕</button>
              </div>`;
            }).join('')}
            <button class="cc-add" data-add-custom-check="${r.id}">＋ 添加自定义打卡项</button>
          </div>
          <div class="cc-progress"><div class="bar" style="width:${total?doneTotal/total*100:0}%"></div></div>
          <div style="display:flex;gap:10px;margin-top:12px">
            <button class="cc-goto" style="flex:1;padding:9px;border-radius:10px;border:none;background:var(--card2);color:var(--text2);font-size:13px;cursor:pointer" data-open="${r.id}">查看路子</button>
            <button class="cc-goto" style="flex:1;padding:9px;border-radius:10px;border:none;background:var(--grad-gold);color:#241a03;font-size:13px;font-weight:700;cursor:pointer" data-money="${r.id}">记一笔收入</button>
          </div>
        </div>`;
    }).join('')}
  `;
}

// ============ 金币等级 ============
const COIN_LEVELS = [
  { need: 0, name: '搞钱学徒', icon: '🌱' },
  { need: 100, name: '搞钱新手', icon: '🎯' },
  { need: 300, name: '稳步上手中', icon: '🚀' },
  { need: 800, name: '搞钱达人', icon: '💎' },
  { need: 2000, name: '搞钱王者', icon: '👑' },
  { need: 5000, name: '搞钱宗师', icon: '🐉' },
];
// ============ 金币明细 ============
const GOAL_REWARD = 200; // 月度目标达成奖励金币
const SAVE_GOAL_REWARD = 300; // 攒钱目标达成奖励金币
const WEEK_GOAL_REWARD = 150; // 本周目标达成奖励金币
const STEPS_REWARD = 50; // 今日三步走（签到+执行+记账）全完成奖励金币
const STEPS_STREAK_REWARDS = { 7: 80, 30: 200, 60: 400 }; // 连续三步走闭环里程碑奖励金币
const ROADMAP_REWARD = 100; // 新手路线图 7 步全部解锁奖励金币
const SAVE_GOAL_PRESETS = [1000, 3000, 5000, 10000]; // 攒钱目标快捷预设金额
const STREAK_REWARDS = { 7: 50, 30: 150, 60: 300 }; // 连续签到里程碑奖励
const REVIEW_REWARD = { done: 10, partial: 5 }; // 每日执行复盘奖励（miss 不奖）
const EXEC_STREAK_REWARDS = { 7: 60, 30: 150, 60: 300 }; // 连续执行里程碑奖励（只算 done）
const EARN_REWARDS = { 100: 20, 500: 60, 1000: 120, 5000: 300, 10000: 500 }; // 累计净赚里程碑奖励
function logCoin(amt, note) {
  state.coinLog.push({ d: todayStr(), amt, note });
  if (state.coinLog.length > 200) state.coinLog = state.coinLog.slice(-200);
}
function addCoins(amt, note) {
  state.coins += amt;
  logCoin(amt, note);
  const ni = coinLevel().idx;
  if (ni > (state.levelIdx || 0)) {
    const lvl = COIN_LEVELS[ni - 1];
    const wasZero = (state.levelIdx || 0) === 0; // 老用户/新用户首载：静默校准到当前等级，不弹
    state.levelIdx = ni;
    if (!wasZero && amt > 0) setTimeout(() => showLevelUp(lvl), 600);
  }
  saveState();
  if (amt > 0) flyCoins(amt, note);
}

// 金币等级升级全屏庆祝弹窗：跨过等级门槛时隆重祝贺
function showLevelUp(lvl) {
  if (document.querySelector('.lvl-up')) return;
  const idx = COIN_LEVELS.indexOf(lvl);
  const next = COIN_LEVELS[idx + 1];
  const needLine = next
    ? `再攒 <b>${fmt(next.need - state.coins)}</b> 金币 → 下一级 ${next.icon} ${next.name}`
    : '🎉 已是最高金币等级！';
  const mask = el(`
    <div class="lvl-up">
      <div class="lu-card">
        <div class="lu-icon">${lvl.icon}</div>
        <div class="lu-title">🎖️ 等级提升！</div>
        <div class="lu-name">${lvl.name}</div>
        <div class="lu-coins">当前 ${fmt(state.coins)} 🪙</div>
        <div class="lu-next">${needLine}</div>
        <button class="lu-btn" data-close>继续搞钱</button>
      </div>
    </div>`);
  const emojis = ['🪙', '✨', '💰', '🌟', '🎊', '🤑', '💪', '🔥'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  setTimeout(() => toast(`🎉 升级啦：${lvl.icon} ${lvl.name}！`), 300);
}
// 金币飘飞动效：全屏中央弹 +N 金币（加分时给强烈正反馈）
function flyCoins(amt, note) {
  if (typeof document === 'undefined' || !document.body) return;
  const old = document.querySelector('.coin-fly');
  if (old) old.remove();
  const label = note ? note.split(/[·「」]/)[0].slice(0, 10) : '';
  const fly = el(`<div class="coin-fly"><div class="cf-num">+${amt}</div><div class="cf-coins">🪙🪙🪙</div>${label ? `<div class="cf-lb">${label}</div>` : ''}</div>`);
  document.body.appendChild(fly);
  setTimeout(() => { if (fly.isConnected) fly.remove(); }, 1500);
}
const COIN_SOURCE_DEFS = [
  { key: 'sign', icon: '🔥', label: '签到', match: n => n.includes('签到') },
  { key: 'task', icon: '📋', label: '新手任务', match: n => n.includes('新手任务') },
  { key: 'ach', icon: '🏆', label: '成就', match: n => n.includes('成就') },
  { key: 'goal', icon: '🎯', label: '目标达成', match: n => n.includes('目标达成') },
  { key: 'mile', icon: '🚀', label: '里程碑', match: n => n.includes('里程碑') },
  { key: 'review', icon: '💪', label: '执行复盘', match: n => n.includes('执行复盘') },
  { key: 'lucky', icon: '🎁', label: '盲盒', match: n => n.includes('盲盒') },
  { key: 'spend', icon: '🛍️', label: '消费', match: n => n.includes('兑换') || n.includes('补签') },
];
// 金币来源分析：按 note 归类 coinLog，占比以收入总和为分母（消费负值按绝对值计宽）
function coinSourceStats() {
  const sum = {}; let total = 0;
  for (const l of state.coinLog) {
    const def = COIN_SOURCE_DEFS.find(d => d.match(l.note));
    const k = def ? def.key : 'other';
    sum[k] = (sum[k] || 0) + l.amt;
    if (l.amt > 0) total += l.amt;
  }
  const items = COIN_SOURCE_DEFS.filter(d => sum[d.key]).map(d => {
    const amt = sum[d.key];
    return Object.assign({}, d, { amt, pct: total > 0 ? Math.round(Math.abs(amt) / total * 100) : 0 });
  }).sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
  return { items, total };
}
function openCoinLedger() {
  const log = state.coinLog.slice().reverse(); // 最新在前
  const rows = log.length ? log.map(l => `
      <div class="cl-row">
        <div class="cl-note">${l.note}</div>
        <div class="cl-date">${l.d}</div>
        <div class="cl-amt ${l.amt >= 0 ? 'in' : 'out'}">${l.amt >= 0 ? '+' : ''}${l.amt}</div>
      </div>`).join('') : `<div class="cl-empty">暂无金币记录<br>签到、完成新手任务都能赚金币 🪙</div>`;
  const src = coinSourceStats();
  const srcHtml = (log.length && src.items.length) ? `
    <div class="cl-sources">
      <div class="cl-s-title">📊 金币来源 · 看金币从哪来</div>
      ${src.items.map(i => `
        <div class="cl-s-row">
          <span class="cl-s-ico">${i.icon}</span>
          <span class="cl-s-name">${i.label}</span>
          <div class="cl-s-bar"><div class="cl-s-fill" style="width:${i.pct}%"></div></div>
          <span class="cl-s-amt ${i.amt >= 0 ? 'in' : 'out'}">${i.amt >= 0 ? '+' : ''}${i.amt}</span>
        </div>`).join('')}
    </div>` : '';
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet coin-ledger">
        <div class="sheet-close" data-close>✕</div>
        <h3>金币明细</h3>
        <div class="cl-balance">当前余额 <b>${state.coins}</b> 金币</div>
        ${srcHtml}
        <div class="cl-list">${rows}</div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
}

// ============ 金币商城（称号） ============
const SHOP_BADGES = [
  { name: '搞钱新手', icon: '🌱', price: 100, desc: '攒到第一笔小钱' },
  { name: '路子学徒', icon: '🎯', price: 200, desc: '认认真真跟路子' },
  { name: '行动达人', icon: '💪', price: 300, desc: '说干就干不拖延' },
  { name: '日进斗金', icon: '💰', price: 500, desc: '每天都有进账' },
  { name: '搞钱老司机', icon: '🚗', price: 800, desc: '路子熟门熟路' },
  { name: '路子收藏家', icon: '📚', price: 1200, desc: '把好路子都收下' },
];
function openCoinShop() {
  const owned = state.badges || {};
  const rows = SHOP_BADGES.map(b => {
    const has = !!owned[b.name];
    const affordable = state.coins >= b.price;
    return `
      <div class="shop-item ${has ? 'owned' : ''} ${!has && !affordable ? 'poor' : ''}" ${has ? `data-badge-activate="${b.name}"` : affordable ? `data-badge-buy="${b.name}"` : ''}>
        <div class="shop-ico">${b.icon}</div>
        <div class="shop-main">
          <div class="shop-name">${b.name}</div>
          <div class="shop-desc">${b.desc}</div>
        </div>
        <div class="shop-price">${has ? (state.activeBadge === b.name ? '✓ 使用中' : '已拥有') : `${b.price} 🪙`}</div>
      </div>`;
  }).join('');
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet coin-shop">
        <div class="sheet-close" data-close>✕</div>
        <h3>🛍️ 金币商城</h3>
        <p class="shop-balance">我的金币 <b>${state.coins}</b> 🪙 · 签到、做任务、达标月目标都能赚</p>
        <div class="shop-list">${rows}</div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelectorAll('[data-badge-buy]').forEach(b => {
    b.onclick = () => {
      const bg = SHOP_BADGES.find(x => x.name === b.dataset.badgeBuy);
      if (!bg || state.coins < bg.price) { toast('金币不足，先去签到赚点 🪙'); return; }
      state.badges = state.badges || {};
      state.badges[bg.name] = true;
      state.activeBadge = bg.name;
      addCoins(-bg.price, `兑换「${bg.name}」称号`);
      close();
      render('mine');
      toast(`🎖️ 已获得「${bg.name}」称号！`);
    };
  });
  mask.querySelectorAll('[data-badge-activate]').forEach(b => {
    b.onclick = () => {
      state.activeBadge = b.dataset.badgeActivate;
      saveState();
      close();
      render('mine');
      toast(`🎖️ 已切换为「${b.dataset.badgeActivate}」`);
    };
  });
}

// ============ 金币盲盒 ============
const LUCKY_COST = 50;
const LUCKY_COINS = [20, 30, 50, 80, 100, 150];
const LUCKY_BOX_PITY = 5; // 每开 5 次必出一次称号（保底）
function luckyPity() {
  const pos = (state.luckyCount || 0) % LUCKY_BOX_PITY;
  return {
    count: state.luckyCount || 0,
    filled: (state.luckyCount || 0) === 0 ? 0 : (pos || LUCKY_BOX_PITY),
    toPity: pos === 0 ? LUCKY_BOX_PITY : LUCKY_BOX_PITY - pos,
    force: pos === 0 && (state.luckyCount || 0) > 0
  };
}
function openLuckyBox() {
  const pity = luckyPity();
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet lucky-box">
        <div class="sheet-close" data-close>✕</div>
        <h3>🎁 金币盲盒</h3>
        <p class="lb-desc">花 <b>${LUCKY_COST} 🪙</b> 开一次，能开出金币或稀有称号！<br>有 <b>40%</b> 概率直接开出称号，比商城买划算！</p>
        <div class="lb-balance">我的金币 <b>${state.coins}</b> 🪙</div>
        <div class="lb-stage">
          <button class="lb-btn" data-lucky-open>🎁 开盲盒<span class="lb-cost">${LUCKY_COST} 🪙</span></button>
        </div>
        <div class="lb-pity" data-pity>
          <div class="lb-pity-txt">🎯 保底进度：已开 <b data-pity-count>${pity.count}</b> 次 · 再开 <b data-pity-left>${pity.toPity}</b> 次必出称号</div>
          <div class="lb-pity-bar">${Array.from({ length: LUCKY_BOX_PITY }, (_, i) => `<span class="lp-cell${i < pity.filled ? ' on' : ''}"></span>`).join('')}</div>
        </div>
        <div class="lb-tip">💡 开盒需消耗金币，金币可从签到、做任务、达标目标获得</div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  const stage = mask.querySelector('.lb-stage');
  const balance = mask.querySelector('.lb-balance b');
  const openBtn = mask.querySelector('[data-lucky-open]');
  openBtn.onclick = () => {
    if (state.coins < LUCKY_COST) { toast('金币不足，先去签到赚点 🪙'); return; }
    state.coins -= LUCKY_COST;
    state.luckyCount = (state.luckyCount || 0) + 1;
    logCoin(-LUCKY_COST, '金币盲盒');
    saveState();
    balance.textContent = state.coins;
    stage.innerHTML = `<div class="lucky-shake">🎁</div>`;
    setTimeout(() => {
      const owned = state.badges || {};
      const unowned = SHOP_BADGES.filter(b => !owned[b.name]);
      const force = state.luckyCount % LUCKY_BOX_PITY === 0 && unowned.length > 0;
      const hit = force || (Math.random() < 0.4 && unowned.length > 0);
      if (hit) {
        const bg = unowned[Math.floor(Math.random() * unowned.length)];
        state.badges = state.badges || {};
        state.badges[bg.name] = true;
        state.activeBadge = bg.name;
        saveState();
        stage.innerHTML = `
          <div class="lucky-reveal">
            <div class="lr-ico">${bg.icon}</div>
            <div class="lr-title">${force ? '🎯 保底必出！' : '🎖️ 开出稀有称号！'}</div>
            <div class="lr-name">「${bg.name}」</div>
            <div class="lr-sub">${force ? '连开保底触发，百分百中称号' : '已自动佩戴 · 在「我的」页显示'}</div>
          </div>
          <button class="lb-btn" data-lucky-again>🎁 再开一次<span class="lb-cost">${LUCKY_COST} 🪙</span></button>`;
      } else {
        const amt = LUCKY_COINS[Math.floor(Math.random() * LUCKY_COINS.length)];
        state.coins += amt;
        logCoin(amt, '盲盒开出金币');
        saveState();
        balance.textContent = state.coins;
        stage.innerHTML = `
          <div class="lucky-reveal">
            <div class="lr-ico">🪙</div>
            <div class="lr-title">🎉 开出金币</div>
            <div class="lr-name in">+${amt}</div>
            <div class="lr-sub">已存入你的金币账户</div>
          </div>
          <button class="lb-btn" data-lucky-again>🎁 再开一次<span class="lb-cost">${LUCKY_COST} 🪙</span></button>`;
      }
      const p = luckyPity();
      const pc = mask.querySelector('[data-pity-count]'); if (pc) pc.textContent = p.count;
      const pl = mask.querySelector('[data-pity-left]'); if (pl) pl.textContent = p.toPity;
      mask.querySelectorAll('.lp-cell').forEach((c, i) => c.classList.toggle('on', i < p.filled));
      const again = stage.querySelector('[data-lucky-again]');
      if (again) again.onclick = openBtn.onclick;
    }, 1300);
  };
}

// ============ 金币等级 ============
function coinLevel() {
  const c = state.coins;
  let idx = 0;
  for (let i = 0; i < COIN_LEVELS.length; i++) if (c >= COIN_LEVELS[i].need) idx = i;
  const cur = COIN_LEVELS[idx];
  const next = COIN_LEVELS[idx + 1];
  const pct = next ? Math.min(100, Math.round((c - cur.need) / (next.need - cur.need) * 100)) : 100;
  return { cur, next, pct, c, idx: idx + 1 };
}

// ============ 成就系统 ============
function getAchievements() {
  const signDays = Object.keys(state.checkin).length;
  const doneTotal = Object.values(state.checks).reduce((s, dc) => s + Object.values(dc).filter(Boolean).length, 0);
  const totalIn = state.records.filter(r => r.type === 'in').reduce((s, r) => s + r.amount, 0);
  const totalOut = state.records.filter(r => r.type === 'out').reduce((s, r) => s + r.amount, 0);
  const net = totalIn - totalOut;
  const execDays = Object.values(state.reviews || {}).filter(v => v === 'done' || v === 'partial').length;
  const likedCount = Object.keys(state.liked).length;
  const likeVotes = Object.values(state.routeVotes).filter(v => v === 'like').length;
  const mehVotes = Object.values(state.routeVotes).filter(v => v === 'meh').length;
  const execStreak = reviewStats().streak;
  const list = [
    { icon: '📅', name: '迈出第一步', desc: '完成首次签到', cur: signDays, goal: 1, got: signDays >= 1, reward: 10 },
    { icon: '🔥', name: '小有坚持', desc: '累计签到 7 天', cur: signDays, goal: 7, got: signDays >= 7, reward: 20 },
    { icon: '🏅', name: '自律达人', desc: '累计签到 30 天', cur: signDays, goal: 30, got: signDays >= 30, reward: 50 },
    { icon: '💸', name: '第一桶金', desc: '记下第一笔收入', cur: totalIn > 0 ? 1 : 0, goal: 1, got: state.records.some(r => r.type === 'in'), reward: 15 },
    { icon: '💰', name: '千元小目标', desc: '累计收入达 1000 元', cur: Math.round(totalIn), goal: 1000, got: totalIn >= 1000, reward: 30 },
    { icon: '💹', name: '净赚小成', desc: '累计净赚 500 元', cur: Math.round(net), goal: 500, got: net >= 500, reward: 40 },
    { icon: '📚', name: '路子收藏家', desc: '收藏 5 条路子', cur: likedCount, goal: 5, got: likedCount >= 5, reward: 20 },
    { icon: '✅', name: '行动派', desc: '完成 7 项打卡', cur: doneTotal, goal: 7, got: doneTotal >= 7, reward: 25 },
    { icon: '🚀', name: '搞钱实干家', desc: '完成 30 项打卡', cur: doneTotal, goal: 30, got: doneTotal >= 30, reward: 50 },
    { icon: '🏆', name: '打卡铁人', desc: '完成 60 项打卡', cur: doneTotal, goal: 60, got: doneTotal >= 60, reward: 80 },
    { icon: '⚡', name: '执行力MAX', desc: '连续 3 天执行今日路子', cur: execStreak, goal: 3, got: execStreak >= 3, reward: 40 },
    { icon: '🧭', name: '行动家', desc: '累计执行 10 天', cur: execDays, goal: 10, got: execDays >= 10, reward: 50 },
    { icon: '🧗', name: '雷打不动', desc: '连续执行 7 天', cur: execStreak, goal: 7, got: execStreak >= 7, reward: 80 },
    { icon: '👍', name: '识货', desc: '给 5 条路子点赞', cur: likeVotes, goal: 5, got: likeVotes >= 5, reward: 15 },
    { icon: '🔄', name: '挑剔鬼', desc: '换过一次今日路子', cur: mehVotes, goal: 1, got: mehVotes >= 1, reward: 10 },
  ];
  return { list, unlocked: list.filter(a => a.got).length, total: list.length };
}

// 最近的成就：未解锁中「有进展」且进度最大的一项，作为主动引导（全部解锁返回 null）
function nextAchievement() {
  const { list } = getAchievements();
  const todo = list.filter(a => !a.got);
  if (!todo.length) return null;
  const withP = todo.filter(a => a.cur > 0);
  const pool = withP.length ? withP : todo;
  let best = pool[0];
  for (const x of pool) {
    const xp = Math.min(100, Math.round(x.cur / x.goal * 100));
    const bp = Math.min(100, Math.round(best.cur / best.goal * 100));
    if (xp > bp) best = x;
  }
  return Object.assign({}, best, {
    idx: list.indexOf(best),
    pct: Math.min(100, Math.round(best.cur / best.goal * 100)),
    diff: Math.max(0, best.goal - best.cur)
  });
}

// 实时成就解锁提示：找出新解锁的成就，逐个 toast（有奖励的同步发金币）
function notifyNewAchievements() {
  const cur = getAchievements();
  const shown = new Set(state.achShown || []);
  const fresh = cur.list.filter(a => a.got && !shown.has(a.name));
  if (!fresh.length) return;
  fresh.forEach(a => shown.add(a.name));
  state.achShown = [...shown];
  const rewarded = state.achRewarded || (state.achRewarded = []);
  fresh.forEach(a => {
    if (a.reward && !rewarded.includes(a.name)) {
      rewarded.push(a.name);
      addCoins(a.reward, `解锁成就「${a.name}」`);
    }
  });
  saveState();
  let delay = 700;
  fresh.forEach((a, i) => {
    setTimeout(() => toast(`🎖️ 解锁成就：${a.name}${a.reward ? ` +${a.reward} 金币` : ''}`), delay + i * 600);
    delay += 600;
  });
}

// 成就详情弹窗：显示解锁条件与当前进度
function openAchieveSheet(i) {
  const a = getAchievements().list[i];
  if (!a) return;
  const pct = Math.min(100, Math.round((a.cur / a.goal) * 100));
  const remain = Math.max(0, a.goal - a.cur);
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet ach-sheet">
        <div class="sheet-close" data-close>✕</div>
        <div class="ach-big ${a.got ? '' : 'locked'}">${a.got ? a.icon : '🔒'}</div>
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.desc}</div>
        ${a.got
          ? `<div class="ach-got">🎉 已解锁</div>`
          : `<div class="ach-progress">
              <div class="ap-bar"><div class="ap-fill" style="width:${pct}%"></div></div>
              <div class="ap-label">${a.cur}/${a.goal} · ${pct}%</div>
            </div>`}
        ${a.reward ? `<div class="ach-reward ${a.got ? (state.achRewarded||[]).includes(a.name) ? 'claimed' : '' : ''}">${a.got ? ((state.achRewarded||[]).includes(a.name) ? '🪙 奖励已领取' : '🪙 解锁即送 +' + a.reward) : '🪙 解锁奖励 +' + a.reward + ' 金币'}</div>` : ''}
        <div class="ach-hint">${a.got ? '坚持执行，解锁更多成就 💪' : remain > 0 ? `还差 ${remain} 就能解锁，加油！` : '再努力一下就达成啦 🎯'}</div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-close]')) mask.remove();
  });
}

// ============ 我的页 ============
// ============ 目标设定 ============
function monthIncome() {
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return state.records.filter(r => r.type === 'in' && r.date && r.date.startsWith(prefix)).reduce((s, r) => s + r.amount, 0);
}
function renderGoalCard() {
  const goal = state.monthGoal || 1000;
  const income = monthIncome();
  const pct = Math.min(100, Math.round(income / goal * 100));
  const done = income >= goal;
  const ym = todayStr().slice(0, 7);
  if (done && state.goalCelebratedMonth !== ym) {
    state.goalCelebratedMonth = ym;
    addCoins(GOAL_REWARD, '月度目标达成');
    setTimeout(() => showGoalCel('month', GOAL_REWARD), 500);
    setTimeout(() => toast(`🎉 本月目标达成！奖励 ${GOAL_REWARD} 金币 🪙`), 900);
  }
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const perDay = done ? 0 : Math.ceil((goal - income) / daysLeft);
  return `
    <div class="goal-card ${done ? 'done' : ''}">
      <div class="goal-head">
        <div class="goal-title">🎯 本月目标</div>
        <button class="goal-edit" data-goal-edit>编辑</button>
      </div>
      <div class="goal-main">
        <div class="goal-now">已赚 <b>¥${fmt(income)}</b> <span class="goal-pct">${done ? '🎉 已达标' : pct + '%'}</span></div>
        <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
        <div class="goal-sub">目标 <b>¥${fmt(goal)}</b> · ${done ? '超出 ¥' + fmt(income - goal) : '还差 ¥' + fmt(goal - income)}</div>
        ${!done ? `<div class="goal-pace">📅 距月底还有 ${daysLeft} 天，每天需赚 <b>¥${fmt(perDay)}</b> 才能达标</div>` : ''}
        <div class="goal-reward">${done ? '已领取目标奖励 ✅' : `达成目标奖励 <b>+${GOAL_REWARD} 金币</b> 🪙`}</div>
      </div>
    </div>`;
}
function openGoalSheet() {
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>本月收入目标</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:12px">给自己定个本月的搞钱小目标，每天记账后进度自动更新</p>
        <div class="sheet-field">
          <label class="sf-label">目标金额（元/月）</label>
          <input id="goal-amount" type="number" inputmode="decimal" placeholder="如 1000" value="${state.monthGoal || 1000}">
        </div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-save>保存</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('[data-close]').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-save]').onclick = () => {
    const v = parseFloat(mask.querySelector('#goal-amount').value);
    if (!v || v <= 0) { toast('请输入有效金额'); return; }
    state.monthGoal = v;
    state.goalCelebratedMonth = '';
    saveState();
    close();
    toast('目标已更新 🎯');
    if (currentView === 'mine') render('mine');
  };
}

// 攒钱目标卡：长期储蓄目标，达标发 SAVE_GOAL_REWARD 金币（一次性）
function renderSaveGoalCard() {
  const goal = state.saveGoal || 0;
  const net = state.records.reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
  if (goal <= 0) {
    return `
      <div class="save-goal">
        <div class="sg-ico">🐷</div>
        <div class="sg-main">
          <div class="sg-t">设个攒钱目标</div>
          <div class="sg-d">开店启动金、第一台设备…攒到就奖励自己</div>
        </div>
        <button class="sg-set" data-save-goal-set>设置</button>
      </div>`;
  }
  const done = net >= goal;
  const pct = Math.min(100, Math.round(net / goal * 100));
  if (done && !state.saveGoalCelebrated) {
    state.saveGoalCelebrated = true;
    addCoins(SAVE_GOAL_REWARD, '攒钱目标达成');
    setTimeout(() => showGoalCel('save', SAVE_GOAL_REWARD), 500);
    setTimeout(() => toast(`🎉 攒钱目标达成！奖励 ${SAVE_GOAL_REWARD} 金币 🪙`), 900);
  }
  // v4.37.0 攒钱节奏预测：近 30 天实际记账日的日均净攒 → 还差目标需 N 天
  let pace = '';
  if (!done) {
    const sd = new Date(); sd.setDate(sd.getDate() - 29);
    const sStart = `${sd.getFullYear()}-${String(sd.getMonth()+1).padStart(2,'0')}-${String(sd.getDate()).padStart(2,'0')}`;
    const rec30 = state.records.filter(r => r.date && r.date >= sStart);
    const recentNet = rec30.reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
    const activeDays = new Set(rec30.map(r => r.date)).size;
    const daily = activeDays ? recentNet / activeDays : 0;
    if (daily > 0) pace = `<div class="sg-pace">按当前速度，还需 <b>${Math.ceil((goal - net) / daily)} 天</b> 攒够 · 日均净攒 ¥${Math.round(daily)}</div>`;
    else if (net <= 0) pace = `<div class="sg-pace warn">还没攒下钱，先从记一笔小收入开始 💪</div>`;
    else pace = `<div class="sg-pace warn">最近没记收入，动起来让进度往前走</div>`;
  }
  return `
    <div class="goal-card ${done ? 'done' : ''} save-goal">
      <div class="goal-head">
        <div class="goal-title">🐷 攒钱目标</div>
        <button class="goal-edit" data-save-goal-set>编辑</button>
      </div>
      <div class="goal-now">已攒 <b>¥${fmt(net)}</b> <span class="goal-pct">${done ? '🎉 已达标' : pct + '%'}</span></div>
      <div class="goal-bar"><div class="goal-fill ${done ? 'done' : ''}" style="width:${pct}%"></div></div>
      <div class="goal-sub">目标 <b>¥${fmt(goal)}</b> · ${done ? '超出 ¥' + fmt(net - goal) : '还差 ¥' + fmt(goal - net)}</div>
      ${pace}
      <div class="goal-reward">${done ? (state.saveGoalCelebrated ? '已领取目标奖励 ✅' : '达成目标奖励 🎉') : `达成目标奖励 <b>+${SAVE_GOAL_REWARD} 金币</b> 🪙`}</div>
    </div>`;
}
function openSaveGoalSheet() {
  const cur = state.saveGoal || 0;
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>🐷 攒钱目标</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:12px">设一个长期攒钱目标，比如开店启动金、买台设备。攒到就奖励自己 ${SAVE_GOAL_REWARD} 金币。</p>
        <div class="sg-presets">${SAVE_GOAL_PRESETS.map(v => `<div class="sg-chip ${cur === v ? 'active' : ''}" data-sg-val="${v}">¥${fmt(v)}</div>`).join('')}</div>
        <div class="sheet-field">
          <label class="sf-label">目标金额（元）</label>
          <input id="save-goal-amount" type="number" inputmode="decimal" placeholder="如 3000" value="${cur || ''}">
        </div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-sg-save>保存目标</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelectorAll('.sg-chip').forEach(c => c.onclick = () => {
    const input = mask.querySelector('#save-goal-amount');
    input.value = c.dataset.sgVal;
    mask.querySelectorAll('.sg-chip').forEach(x => x.classList.toggle('active', x === c));
  });
  mask.querySelector('[data-sg-save]').onclick = () => {
    const v = parseFloat(mask.querySelector('#save-goal-amount').value);
    if (!v || v <= 0) { toast('请输入有效的目标金额'); return; }
    close();
    state.saveGoal = v;
    state.saveGoalCelebrated = false;
    saveState();
    if (currentView === 'mine') render('mine');
    toast(`🐷 攒钱目标已设为 ¥${fmt(v)}`);
  };
}

// v4.41.0 周目标自定义：之前 weekGoal 只能靠月目标推算，现在可在周战报卡直接设置
const WEEK_GOAL_PRESETS = [100, 200, 300, 500];
function openWeekGoalSheet() {
  const cur = state.weekGoal || 0;
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>📅 本周目标</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:12px">设一个本周收入目标，达标奖励 ${WEEK_GOAL_REWARD} 金币。不设则按本月目标自动推算。</p>
        <div class="sg-presets">${WEEK_GOAL_PRESETS.map(v => `<div class="sg-chip ${cur === v ? 'active' : ''}" data-wg-val="${v}">¥${fmt(v)}</div>`).join('')}</div>
        <div class="sheet-field">
          <label class="sf-label">目标金额（元）</label>
          <input id="week-goal-amount" type="number" inputmode="decimal" placeholder="如 200" value="${cur || ''}">
        </div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-wg-save>保存目标</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelectorAll('.sg-chip').forEach(c => c.onclick = () => {
    const input = mask.querySelector('#week-goal-amount');
    input.value = c.dataset.wgVal;
    mask.querySelectorAll('.sg-chip').forEach(x => x.classList.toggle('active', x === c));
  });
  mask.querySelector('[data-wg-save]').onclick = () => {
    const v = parseFloat(mask.querySelector('#week-goal-amount').value);
    if (!v || v <= 0) { toast('请输入有效的目标金额'); return; }
    close();
    state.weekGoal = v;
    // 不重置 weekGoalCelebrated：改目标不影响本周已发过的达标奖励（防改低重复领奖）
    saveState();
    if (currentView === 'mine') render('mine');
    toast(`📅 本周目标已设为 ¥${fmt(v)}`);
  };
}

// 本月小结：收入/支出/签到/打卡完成 + 一句鼓励
function renderMonthSummary() {
  const ym = todayStr().slice(0, 7);
  const monthRecords = state.records.filter(r => (r.date || '').startsWith(ym));
  const mIn = monthRecords.filter(r => r.type === 'in').reduce((s, r) => s + r.amount, 0);
  const mOut = monthRecords.filter(r => r.type === 'out').reduce((s, r) => s + r.amount, 0);
  const net = mIn - mOut;
  const checkinDays = Object.keys(state.checkin).filter(d => d.startsWith(ym)).length;
  let doneItems = 0;
  Object.keys(state.checks).forEach(k => {
    const date = k.split('::')[1];
    if (date && date.startsWith(ym)) doneItems += Object.values(state.checks[k]).filter(Boolean).length;
  });
  let icon, comment;
  if (net >= 1000) { icon = '🚀'; comment = '这个月赚得真猛，继续保持！'; }
  else if (net >= 300) { icon = '📈'; comment = '已经有进账了，稳扎稳打往上走'; }
  else if (checkinDays >= 15) { icon = '🔥'; comment = '坚持打卡很牛，收入马上跟上'; }
  else if (checkinDays > 0) { icon = '🌱'; comment = '已经开始行动，千万别停下来'; }
  else { icon = '💡'; comment = '还没开始？今天先迈出第一步'; }
  return `
    <div class="month-summary">
      <div class="ms-head"><span class="ms-title">📊 本月小结</span><span class="ms-month">${ym}</span></div>
      <div class="ms-grid">
        <div class="ms-cell"><div class="ms-num gold">¥${fmt(mIn)}</div><div class="ms-lb">收入</div></div>
        <div class="ms-cell"><div class="ms-num red">¥${fmt(mOut)}</div><div class="ms-lb">支出</div></div>
        <div class="ms-cell"><div class="ms-num">${checkinDays}天</div><div class="ms-lb">签到</div></div>
        <div class="ms-cell"><div class="ms-num">${doneItems}项</div><div class="ms-lb">打卡完成</div></div>
      </div>
      <div class="ms-comment">${icon} ${comment}</div>
    </div>`;
}

// 搞钱战绩：把「记账关联路子」的收益可视化，形成执行闭环
function renderEarnBoard() {
  const recs = state.records;
  const net = recs.reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
  const earnedRoutes = new Set(recs.filter(r => r.type === 'in' && r.routeId).map(r => r.routeId));
  const likedCount = Object.keys(state.liked).length;
  const byRoute = {};
  recs.forEach(r => {
    if (r.routeId) {
      byRoute[r.routeId] = byRoute[r.routeId] || { net: 0 };
      byRoute[r.routeId].net += (r.type === 'in' ? r.amount : -r.amount);
    }
  });
  const top = Object.entries(byRoute).sort((a, b) => b[1].net - a[1].net).slice(0, 3)
    .map(([id, v]) => {
      const r = allRoutes().find(x => x.id === id);
      if (!r || v.net <= 0) return '';
      const cat = CATS[r.cat] || {};
      return `<div class="eb-row">
        <span class="eb-dot" style="background:${cat.color || '#f5b93c'}"></span>
        <span class="eb-name">${esc(r.title)}</span>
        <span class="eb-amt">¥${fmt(v.net)}</span>
      </div>`;
    }).join('');
  return `
    <div class="earn-board">
      <div class="eb-head"><span>💪 我的搞钱战绩</span><button class="eb-share" data-share-earn>📤 分享战绩</button></div>
      ${recs.length ? `
      <div class="eb-grid">
        <div class="eb-cell"><div class="n gold">${earnedRoutes.size}</div><div class="k">赚到路子</div></div>
        <div class="eb-cell"><div class="n green">¥${fmt(net)}</div><div class="k">累计净赚</div></div>
        <div class="eb-cell"><div class="n">${likedCount}</div><div class="k">收藏路子</div></div>
      </div>
      ${top ? `<div class="eb-top">${top}</div>` : ''}` :
      `<div class="eb-empty">从「今日路子」开始执行，每赚一笔就去记一笔账，这里会滚出你的战绩 🚀</div>`}
    </div>`;
}

// 分类收入分布：把 records 按路子分类聚合净收入，横向条形图帮用户看清发力方向
function renderCatIncome() {
  const byCat = {};
  state.records.forEach(r => {
    if (!r.routeId) return;
    const route = allRoutes().find(x => x.id === r.routeId);
    const cat = route ? route.cat : null;
    if (!cat) return;
    byCat[cat] = byCat[cat] || 0;
    byCat[cat] += (r.type === 'in' ? r.amount : -r.amount);
  });
  const rows = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!rows.length) return '';
  const max = rows[0][1];
  return `
    <div class="cat-income">
      <div class="ci-head"><span>💰 分类收入分布</span><span class="ci-sub">看看哪条路子最赚钱</span></div>
      ${rows.map(([k, v]) => {
        const c = CATS[k] || { name: k, icon: '💰', color: '#f5b93c', bg: 'rgba(245,185,60,.15)' };
        const pct = Math.round(v / max * 100);
        return `
        <div class="ci-row">
          <span class="ci-ico" style="background:${c.bg}">${c.icon}</span>
          <span class="ci-name">${c.name}</span>
          <div class="ci-bar"><div class="ci-fill" style="width:${pct}%;background:${c.color}"></div></div>
          <span class="ci-amt">¥${fmt(v)}</span>
        </div>`;
      }).join('')}
    </div>`;
}

// 我的赚钱路子 TOP：按路子聚合净收入，让小白看到哪条路子真赚了钱
function renderMyTop() {
  const byRoute = {};
  state.records.forEach(r => {
    if (!r.routeId) return;
    byRoute[r.routeId] = byRoute[r.routeId] || { net: 0, count: 0 };
    byRoute[r.routeId].net += (r.type === 'in' ? r.amount : -r.amount);
    byRoute[r.routeId].count++;
  });
  const rows = Object.entries(byRoute)
    .map(([routeId, v]) => ({ routeId, ...v }))
    .filter(r => r.net > 0)
    .sort((a, b) => b.net - a.net)
    .slice(0, 4);
  if (!rows.length) return '';
  return `
    <div class="my-top">
      <div class="mt-head"><span>💸 我的赚钱路子</span><span class="mt-sub">按净赚 · 点开看详情</span></div>
      ${rows.map((r, i) => {
        const route = allRoutes().find(x => x.id === r.routeId);
        const name = route ? route.title : '路子';
        return `
        <div class="mt-row" data-open="${r.routeId}">
          <span class="mt-rank">TOP${i + 1}</span>
          <span class="mt-name">${esc(name)}</span>
          <span class="mt-count">${r.count} 笔</span>
          <span class="mt-num">+¥${fmt(r.net)}</span>
        </div>`;
      }).join('')}
    </div>`;
}

// v4.40.0 我在做的路子：聚合所有加入过打卡的路子（checks 的 routeId 去重），按累计打卡天数排序
function renderDoingRoutes() {
  const cnt = {};
  Object.keys(state.checks).forEach(k => {
    const rid = k.split('::')[0];
    if (!rid || rid === 'undefined') return;
    cnt[rid] = (cnt[rid] || 0) + 1;
  });
  const data = Object.entries(cnt).map(([rid, days]) => ({ rid, days })).sort((a, b) => b.days - a.days);
  if (!data.length) return '';
  const rows = [];
  let maxDays = 0;
  data.forEach(({ rid, days }) => {
    const r = allRoutes().find(x => x.id === rid);
    if (!r) return;
    maxDays = Math.max(maxDays, days);
    const cat = CATS[r.cat] || { icon: '💰', bg: 'rgba(245,185,60,.15)' };
    rows.push(`
      <div class="do-row" data-open="${r.id}">
        <div class="do-ico" style="background:${cat.bg}">${cat.icon}</div>
        <div class="do-name">${esc(r.title)}</div>
        <div class="do-days">坚持 ${days} 天</div>
        <div class="do-arrow">›</div>
      </div>`);
  });
  if (!rows.length) return '';
  return `
    <div class="doing-card">
      <div class="dc-head"><span>📋 我在做的路子</span><span class="dc-sub">${rows.length} 条 · 最长坚持 ${maxDays} 天</span></div>
      ${rows.join('')}
    </div>`;
}

// 近6月收支趋势：按月份聚合收入/支出双柱，帮用户看清赚钱曲线
function renderTrendCard() {
  const months = [];
  const now = new Date();
  let max = 0;
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let inc = 0, out = 0;
    state.records.forEach(r => {
      if (!r.date || !r.date.startsWith(ym)) return;
      if (r.type === 'in') inc += r.amount; else out += r.amount;
    });
    if (inc > max) max = inc;
    if (out > max) max = out;
    months.push({ ym, inc, out, label: `${d.getMonth() + 1}月`, cur: i === 0 });
  }
  if (!state.records.length) return '';
  const h = 62;
  return `
    <div class="trend-card">
      <div class="td-head"><span>📈 近6月收支趋势</span><span class="td-sub">看你的赚钱曲线</span></div>
      <div class="trend-bars">
        ${months.map(m => {
          const ih = m.inc ? Math.max(3, Math.round(m.inc / max * h)) : 2;
          const oh = m.out ? Math.max(3, Math.round(m.out / max * h)) : 2;
          const net = m.inc - m.out;
          return `
          <div class="trend-col ${m.cur ? 'cur' : ''}" data-ym="${m.ym}">
            <div class="trend-pair">
              <div class="trend-bar inc" style="height:${ih}px" data-v="${m.inc}"></div>
              <div class="trend-bar out" style="height:${oh}px" data-v="${m.out}"></div>
            </div>
            <div class="trend-label">${m.label}</div>
            <div class="trend-amt">${m.inc || m.out ? `¥${fmt(Math.abs(net))}` : '—'}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="trend-legend">
        <span><i class="lg inc"></i>收入</span>
        <span><i class="lg out"></i>支出</span>
      </div>
    </div>`;
}

// 周战报：本周 vs 上周坚持对比（周一为一周起点）
function weekStats(offset) {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const mon = new Date(now); mon.setDate(now.getDate() - dow + offset * 7);
  const days = [];
  let income = 0, execDays = 0, checkinDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const recs = state.records.filter(r => r.date === ds);
    const net = recs.reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
    const rv = (state.reviews || {})[ds];
    const ck = state.checkin[ds];
    if (rv === 'done' || rv === 'partial') execDays++;
    if (ck) checkinDays++;
    days.push({ ds, net, rv, ck });
    income += net;
  }
  return { days, income, execDays, checkinDays };
}
function renderWeekReport() {
  const cur = weekStats(0), prev = weekStats(-1);
  const hasAny = state.records.some(r => r.date >= cur.days[0].ds && r.date <= cur.days[6].ds)
    || Object.keys(state.reviews || {}).some(ds => ds >= cur.days[0].ds && ds <= cur.days[6].ds);
  if (!hasAny) return '';
  // 周目标达标检测（每周一次，weekGoalCelebrated 记本周一防重）
  const weekKey = cur.days[0].ds;
  const weekGoal = state.weekGoal || Math.round((state.monthGoal || 1000) / 4.35);
  if (cur.income >= weekGoal && state.weekGoalCelebrated !== weekKey) {
    state.weekGoalCelebrated = weekKey;
    addCoins(WEEK_GOAL_REWARD, '本周目标达成');
    setTimeout(() => showGoalCel('week', WEEK_GOAL_REWARD), 500);
    setTimeout(() => toast(`🎯 本周目标达成！奖励 ${WEEK_GOAL_REWARD} 金币 🪙`), 900);
  }
  const now = new Date();
  const todayIdx = (now.getDay() + 6) % 7;
  const delta = prev.income ? Math.round((cur.income - prev.income) / prev.income * 100) : 0;
  const up = cur.income >= prev.income;
  const wd = ['一', '二', '三', '四', '五', '六', '日'];
  const wgPct = weekGoal ? Math.max(0, Math.min(100, Math.round(cur.income / weekGoal * 100))) : 0;
  const wgDone = cur.income >= weekGoal;
  return `
    <div class="week-report">
      <div class="wr-head"><span>📊 本周战报</span><span class="wr-sub">周一为一周起点 · 对比上周</span><button class="eb-share" data-share-week>📤 分享本周</button></div>
      <div class="week-goal ${wgDone ? 'done' : ''}">
        <div class="wg-line"><span>🎯 本周目标 <b>¥${fmt(weekGoal)}</b><button class="wg-set" data-week-goal-set>✏️</button></span><span class="wg-cur">已赚 <b>¥${fmt(cur.income)}</b></span></div>
        <div class="wg-bar"><div class="wg-fill" style="width:${wgPct}%"></div></div>
        ${wgDone ? '<div class="wg-done">🎉 本周目标已达成！</div>' : `<div class="wg-rest">还差 <b>¥${fmt(weekGoal - cur.income)}</b> 达标 · 奖励 +${WEEK_GOAL_REWARD} 🪙</div>`}
      </div>
      <div class="wr-vs">
        <div class="wr-cell main"><div class="wr-n gold">¥${fmt(cur.income)}</div><div class="wr-lb">本周收入 <span class="wr-delta ${up ? 'up' : 'down'}">${up ? '↗' : '↘'} ${Math.abs(delta)}%</span></div></div>
        <div class="wr-cell"><div class="wr-n">${cur.execDays}<small>天</small></div><div class="wr-lb">执行 <span>vs ${prev.execDays}</span></div></div>
        <div class="wr-cell"><div class="wr-n">${cur.checkinDays}<small>天</small></div><div class="wr-lb">签到 <span>vs ${prev.checkinDays}</span></div></div>
      </div>
      <div class="wr-days">
        ${cur.days.map((d, i) => `
          <div class="wr-day ${d.ck ? 'ck' : ''} ${i < todayIdx ? '' : i === todayIdx ? 'today' : 'future'}" title="${d.ds}${d.net ? ` · 收入 ¥${d.net}` : ''}">
            <div class="wd-top">${d.ck ? '✓' : '·'}<em>${wd[i]}</em></div>
            <div class="wd-mid ${d.rv || ''}"></div>
            <div class="wd-bot">${d.net ? (d.net > 0 ? `¥${fmt(d.net)}` : `-¥${fmt(-d.net)}`) : ''}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

// 全年坚持热力图：GitHub 风格年视图（今年 1/1 至今天），颜色=签到/执行/收入
function renderHeatmap() {
  const now = new Date();
  const y0 = new Date(now.getFullYear(), 0, 1);
  const firstDow = (y0.getDay() + 6) % 7;
  const totalDays = Math.floor((now - y0) / 86400000) + 1;
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push({ empty: true });
  let checkinDays = 0, execDays = 0;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(y0); d.setDate(y0.getDate() + i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const ck = state.checkin[ds];
    const rv = (state.reviews || {})[ds];
    const net = state.records.filter(r => r.date === ds).reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
    let cls = '';
    if (ck && rv === 'done') cls = 's-gold';
    else if (ck) cls = 's-soft';
    else if (rv === 'done' || rv === 'partial') cls = 's-green';
    else if (rv === 'miss') cls = 's-miss';
    if (ck) checkinDays++;
    if (rv === 'done' || rv === 'partial') execDays++;
    const tip = `${ds}：${ck ? '已签到' : '未签到'} · ${rv === 'done' ? '执行了' : rv === 'partial' ? '做了一半' : rv === 'miss' ? '没做' : '无复盘'}${net ? ' · 收入 ¥' + fmt(Math.abs(net)) : ''}`;
    cells.push({ cls, today: i === totalDays - 1, tip });
  }
  while (cells.length % 7) cells.push({ empty: true });
  const yp = String(now.getFullYear()) + '-';
  const yearIn = state.records.filter(r => r.type === 'in' && r.date && r.date.startsWith(yp)).reduce((s, r) => s + r.amount, 0);
  const yearNet = state.records.filter(r => r.date && r.date.startsWith(yp)).reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
  if (!checkinDays && !execDays && !yearNet) return '';
  return `
    <div class="heatmap">
      <div class="hm-head"><span>🔥 ${now.getFullYear()} 坚持热力图</span><span class="hm-sub">每一格都是你的一天</span></div>
      <div class="hm-stats">
        <span>☀️ 签到 <b>${checkinDays}</b> 天</span>
        <span>💪 执行 <b>${execDays}</b> 天</span>
        <span>💰 净赚 <b>¥${fmt(yearNet)}</b></span>
      </div>
      <div class="hm-scroll">
        <div class="hm-grid">
          ${cells.map(c => c.empty
            ? '<div class="hm-cell empty"></div>'
            : `<div class="hm-cell ${c.cls}${c.today ? ' today' : ''}" title="${c.tip}"></div>`).join('')}
        </div>
      </div>
      <div class="hm-legend">
        <span><i class="d"></i>无</span><span><i class="s-soft"></i>签到</span><span><i class="s-green"></i>执行</span><span><i class="s-gold"></i>签到+执行</span>
      </div>
    </div>`;
}

// 累计净赚里程碑：记账累计净赚达标发金币（每个里程碑只发一次）
function checkEarnMilestone() {
  const net = state.records.reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
  const reached = Object.keys(EARN_REWARDS).map(Number).sort((a, b) => a - b)
    .filter(k => net >= k && !(state.earnRewards || []).includes(k));
  if (!reached.length) return;
  state.earnRewards = state.earnRewards || [];
  reached.forEach(k => { state.earnRewards.push(k); addCoins(EARN_REWARDS[k], `累计净赚 ¥${k} 里程碑`); });
  const last = reached[reached.length - 1];
  setTimeout(() => showEarnCel(last, EARN_REWARDS[last]), 500);
}
// 收入里程碑全屏庆祝弹窗：净赚达标给最直接的钱景正反馈
function showEarnCel(amount, bonus) {
  if (document.querySelector('.exec-cel')) return;
  const mask = el(`
    <div class="exec-cel">
      <div class="ec-card">
        <div class="ec-icon">💰</div>
        <div class="ec-title">累计净赚 <b>¥${fmt(amount)}</b>！</div>
        <div class="ec-coins">+${bonus} 🪙</div>
        <div class="ec-sub">钱是赚出来的，也是攒出来的，<br>路子越走越有底气</div>
        <button class="ec-btn" data-close>太棒了，继续赚！</button>
      </div>
    </div>`);
  const emojis = ['💰', '✨', '💵', '🌟', '🎊', '🤑', '📈', '🔥'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  setTimeout(() => toast(`🏆 累计净赚 ¥${fmt(amount)} 里程碑达成！+${bonus} 金币`), 300);
}
// 月/周/攒钱目标达成全屏庆祝弹窗：目标闭环的最终仪式
const GOAL_CEL = {
  month: { icon: '🎯', sub: '这个月的努力有了回报，<br>下个月目标调高点？' },
  week: { icon: '📅', sub: '一周的坚持没白费，<br>下周继续冲！' },
  save: { icon: '🐷', sub: '攒钱路上又迈过一座山，<br>继续向下一座出发' },
};
function showGoalCel(key, bonus) {
  if (document.querySelector('.exec-cel')) return;
  const g = GOAL_CEL[key];
  const title = key === 'month' ? '本月目标达成！' : key === 'week' ? '本周目标达成！' : '攒钱目标达成！';
  const mask = el(`
    <div class="exec-cel">
      <div class="ec-card">
        <div class="ec-icon">${g.icon}</div>
        <div class="ec-title">${title}</div>
        <div class="ec-coins">+${bonus} 🪙</div>
        <div class="ec-sub">${g.sub}</div>
        <button class="ec-btn" data-close>收下奖励</button>
      </div>
    </div>`);
  const emojis = ['🎉', '✨', '💰', '🌟', '🎊', '🤑', '💪', '🔥'];
  for (let i = 0; i < 22; i++) {
    const p = el(`<span class="ec-cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.6).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    mask.appendChild(p);
  }
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
}
// 「我的」页收入里程碑进度条（复用 .streak-ms 视觉，绿色条）
function renderEarnMile() {
  const net = state.records.reduce((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0);
  if (net < 1) return '';
  const keys = Object.keys(EARN_REWARDS).map(Number).sort((a, b) => a - b);
  const next = keys.find(k => net < k);
  if (!next) {
    return `<div class="streak-ms done"><span>🏆 全部收入里程碑已解锁（净赚 ¥${fmt(net)}）</span></div>`;
  }
  const bonus = EARN_REWARDS[next];
  const pct = Math.min(100, Math.round(net / next * 100));
  return `
    <div class="streak-ms">
      <div class="ms-top"><span>💰 累计净赚 <b>¥${fmt(net)}</b></span><span class="ms-next">距 <b>¥${fmt(next)}</b> · 奖励 <b>+${bonus}</b> 🪙</span></div>
      <div class="ms-bar"><div class="ms-fill earn" style="width:${pct}%"></div></div>
    </div>`;
}

function renderMine(routes) {
  const totalIn = state.records.filter(r => r.type === 'in').reduce((s,r) => s+r.amount, 0);
  const totalOut = state.records.filter(r => r.type === 'out').reduce((s,r) => s+r.amount, 0);
  const likedCount = Object.keys(state.liked).length;
  const doneChecks = Object.values(state.checks).reduce((s, day) => s + Object.values(day).filter(Boolean).length, 0);
  const rank = totalIn >= 10000 ? '搞钱老司机' : totalIn >= 1000 ? '稳步上手中' : totalIn > 0 ? '刚起步' : '学习阶段';
  const cl = coinLevel();
  const ach = getAchievements();
  const actBg = SHOP_BADGES.find(b => b.name === state.activeBadge);
  notifyNewAchievements();

  return `
    <div class="mine-head">
      <div class="avatar">路</div>
      <div>
        <div class="mh-name">路子学徒${actBg ? ` <span class="mh-badge">${actBg.icon} ${actBg.name}</span>` : ''}</div>
        <div class="mh-sub">累计打卡 ${doneChecks} 项 · 收藏 ${likedCount} 条</div>
      </div>
      <div class="mh-rank">${rank}</div>
    </div>

    <div class="money-summary">
      <div class="lb">总资产 · 记账</div>
      <div class="total">¥${fmt(totalIn)} <small>收入 · 支出 ¥${fmt(totalOut)}</small></div>
      <div class="money-sub"><span>已收 <b>¥${fmt(totalIn)}</b></span><span>已支 <b>¥${fmt(totalOut)}</b></span><span>净赚 <b>¥${fmt(totalIn-totalOut)}</b></span></div>
    </div>

    <div class="coin-rank">
      <div class="cr-head">
        <div class="cr-ico">${cl.cur.icon}</div>
        <div class="cr-main">
          <div class="cr-name">${cl.cur.name}</div>
          <div class="cr-sub">${cl.c} 金币 · ${cl.next ? `再攒 ${cl.next.need - cl.c} 升「${cl.next.name}」` : '已满级'}</div>
        </div>
        <div class="cr-lv">LV.${cl.idx}</div>
      </div>
      <div class="cr-bar"><div class="cr-bar-in" style="width:${cl.pct}%"></div></div>
      <div class="cr-actions">
        <div class="cr-ledger" data-coin-ledger>💰 金币明细<span class="cl-arrow">›</span></div>
        <div class="cr-ledger" data-coin-shop>🛍️ 金币商城<span class="cl-arrow">›</span></div>
        <div class="cr-ledger" data-lucky-box>🎁 金币盲盒<span class="cl-arrow">›</span></div>
      </div>
    </div>

    ${(() => { const nr = nextRewardLine(); return nr ? `
    <div class="next-reward">
      <div class="nr-head"><span>🎁 最近的奖励</span><span class="nr-em">${nr.emoji}</span></div>
      <div class="nr-line">${nr.label} → <b>+${nr.reward} 🪙</b></div>
      <div class="nr-bar"><div class="nr-fill" style="width:${nr.pct}%"></div></div>
    </div>` : ''; })()}

    ${state.records.some(r => r.type === 'in') && !state.firstInCelebrated ? `
      <div class="first-in">
        <div class="fi-ico">🎉</div>
        <div class="fi-main">
          <div class="fi-t">你赚到了第一桶金</div>
          <div class="fi-d">把每一笔收入记下来，看着它慢慢变大</div>
        </div>
        <button class="fi-btn" data-first-in-celebrate>👏 开心</button>
      </div>` : ''}

    ${renderGoalCard()}

    ${renderSaveGoalCard()}

    ${renderMonthSummary()}

    ${renderWeekReport()}

    ${renderHeatmap()}

    ${renderEarnBoard()}

    ${renderEarnMile()}

    ${renderCatIncome()}

    ${renderMyTop()}

    ${renderDoingRoutes()}

    ${renderChallengeCard()}

    ${renderTrendCard()}

    ${renderReviewStats()}

    ${(() => { const ms = masteryStats(); return `
    <div class="mastery-card">
      <div class="mc-ringwrap">
        <svg viewBox="0 0 80 80">
          <circle class="mc-bg" cx="40" cy="40" r="34"/>
          <circle class="mc-fg" cx="40" cy="40" r="34" style="stroke-dashoffset:${(1 - ms.pct / 100) * 213.6}"/>
        </svg>
        <div class="mc-pct">${ms.pct}%</div>
      </div>
      <div class="mc-main">
        <div class="mc-title">🧭 路子掌握度</div>
        <div class="mc-sub">已掌握 <b>${ms.mastered}</b>/<b>${ms.total}</b> 条路子</div>
        <div class="mc-desc">收藏、执行或记过账的路子，都算掌握</div>
      </div>
    </div>`; })()}

    ${(() => { const ld = rewardLadder(); return `
    <div class="ladder-card">
      <div class="ld-head"><span>🏆 奖励阶梯</span><span class="ld-sub">坚持到 7/30/60 天有赏</span></div>
      <div class="ld-grid">
        <div class="lr-row">
          <div class="lr-lb">🔥 签到</div>
          ${ld.sign.map(s => `
          <div class="ladder-step ${s.done ? 'done' : ''} ${s.current ? 'current' : ''}" title="${s.k} 天 · 奖励 +${s.coins} 金币">
            <div class="ls-k">${s.k}<small>天</small></div>
            <div class="ls-c">+${s.coins}🪙</div>
          </div>`).join('')}
        </div>
        <div class="lr-row">
          <div class="lr-lb">💪 执行</div>
          ${ld.exec.map(s => `
          <div class="ladder-step ${s.done ? 'done' : ''} ${s.current ? 'current' : ''}" title="${s.k} 天 · 奖励 +${s.coins} 金币">
            <div class="ls-k">${s.k}<small>天</small></div>
            <div class="ls-c">+${s.coins}🪙</div>
          </div>`).join('')}
        </div>
      </div>
    </div>`; })()}

    <div class="achieve-sec">
      <div class="as-head"><span>🎖️ 成就</span><span class="as-count">${ach.unlocked}/${ach.total}</span></div>
      ${(() => { const na = nextAchievement(); return na ? `
      <div class="next-ach" data-ach="${na.idx}">
        <div class="na-ico">${na.icon}</div>
        <div class="na-main">
          <div class="na-head"><span>🎯 下一个成就</span><span class="na-name">${na.name}</span></div>
          <div class="na-bar"><div class="na-fill" style="width:${na.pct}%"></div></div>
          <div class="na-sub">${na.diff > 0 ? `还差 <b>${na.diff}</b> 解锁 · ${na.desc}` : `再努力一下 · ${na.desc}`}${na.reward ? ` · <b>+${na.reward}🪙</b>` : ''}</div>
        </div>
        <div class="na-arrow">›</div>
      </div>` : ''; })()}
      <div class="as-grid">
        ${ach.list.map((a, i) => `
          <div class="as-item ${a.got ? '' : 'locked'}" data-ach="${i}" title="${a.desc}">
            <div class="as-ico">${a.got ? a.icon : '🔒'}</div>
            <div class="as-name">${a.name}</div>
            ${a.reward ? `<div class="as-reward">+${a.reward}🪙</div>` : ''}
          </div>`).join('')}
      </div>
    </div>

    <div class="mine-list">
      <div class="mine-item" data-go="deals"><div class="mi-ico" style="background:rgba(46,204,113,.15)">🉐</div><div class="mi-name">省钱攻略</div><div class="mi-val">${DEALS.length} 条 · 今日 ${todayDeals().length}</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="saveRecords"><div class="mi-ico" style="background:rgba(245,185,60,.15)">💸</div><div class="mi-name">省钱台账</div><div class="mi-val">本月省 ¥${fmt(saveMonthTotal())}</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="library"><div class="mi-ico" style="background:rgba(79,140,255,.15)">📚</div><div class="mi-name">全部路子</div><div class="mi-val">${routes.length} 条</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="likes"><div class="mi-ico" style="background:rgba(255,91,106,.15)">❤️</div><div class="mi-name">我的收藏</div><div class="mi-val">${likedCount} 条</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="records"><div class="mi-ico" style="background:rgba(46,204,113,.15)">💰</div><div class="mi-name">收益记录</div><div class="mi-val">${state.records.length} 笔</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="guide"><div class="mi-ico" style="background:rgba(160,107,255,.15)">🎓</div><div class="mi-name">新手教程</div><div class="mi-val">${Math.min(state.guideStage+1, 4)}/4</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="guard"><div class="mi-ico" style="background:rgba(255,91,106,.15)">🛡️</div><div class="mi-name">避坑指南</div><div class="mi-val">${state.guardRead ? '已读完' : '未读完'}</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="remote"><div class="mi-ico" style="background:rgba(23,162,184,.15)">🔌</div><div class="mi-name">内容更新源</div><div class="mi-val">${state.remoteUrl ? '已配置' : '未配置'}</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="notif"><div class="mi-ico" style="background:rgba(255,159,67,.15)">🔔</div><div class="mi-name">通知时间</div><div class="mi-val">${fmtHM(state.notifMorning)} · ${fmtHM(state.notifEvening)}</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-go="about"><div class="mi-ico" style="background:rgba(245,185,60,.15)">ℹ️</div><div class="mi-name">关于「路子」</div><div class="mi-arrow">›</div></div>
    </div>
  `;
}

// ============ 省钱攻略 ============
// 设计原则：不收录批量账号、绕风控、刷单套现类内容；
// 收益一律按区间预估，账实不符时以平台规则为准。
let dealFilter = 'all';
let dealSearch = '';
let dealSort = 'recommend';
let currentDealId = null;

const DEAL_STALE_DAYS = 90; // 超过 90 天未验证，标记「可能已过期」

// 保守估价：区间越宽越不可信，按七三开偏向低端取值，避免「0-500」按 250 算
function dealMid(d) { return d.gain.min * 0.7 + d.gain.max * 0.3; }

// 折合时薪：单次预估收益（保守）÷ 耗时 × 60；一次性大额不给时薪（口径不成立）
function dealHourly(d) { return d.time > 0 ? Math.round(dealMid(d) / d.time * 60) : 0; }

// 收益区间倍率：越大代表越「看情况」，不适合折算时薪
function dealRatio(d) { return d.gain.max / Math.max(d.gain.min, 0.1); }

// 推荐度：高频可重复的优先；时薪封顶 240 防大额一次性霸榜；区间过宽视为不确定而降权
function dealScore(d) {
  const w = { daily: 1.35, weekly: 1.2, monthly: 1.15, range: 0.9, once: 0.55 }[d.cycle] || 1;
  let s = Math.min(dealHourly(d), 240) * w;
  if (d.periodGain) s += (d.periodGain.min + d.periodGain.max) / 2 * 2;
  if (d.time <= 5) s += 30; // 顺手就能做的小事加分
  if (dealRatio(d) >= 10) s *= 0.8;
  else if (dealRatio(d) >= 5) s *= 0.9;
  return s;
}

function dealCycleShort(d) {
  const W = ['日', '一', '二', '三', '四', '五', '六'];
  if (d.cycle === 'daily') return '每天';
  if (d.cycle === 'weekly') return '周' + W[(d.cycleDetail || {}).weekday ?? 0];
  if (d.cycle === 'monthly') return ((d.cycleDetail || {}).day ?? 1) + ' 号';
  if (d.cycle === 'once') return '一次性';
  if (d.cycle === 'range') return '限时';
  return '';
}

function dealGainText(d) {
  const p = d.gain.type === 'goods' ? '约 ' : '';
  return `${p}¥${d.gain.min}-${d.gain.max}`;
}

function dealDaysSince(dateStr) {
  const t = new Date(dateStr + 'T00:00:00').getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

function dealStale(d) { return dealDaysSince(d.verifiedAt) > DEAL_STALE_DAYS; }

function dealStatusOf(d) {
  if (!d) return '';
  return (state.dealStatus || {})[d.id] || '';
}

// 今天能不能做（只按周期判断，不看用户状态）
function dealActiveToday(d) {
  const now = new Date();
  if (d.cycle === 'daily') return true;
  if (d.cycle === 'weekly') return now.getDay() === ((d.cycleDetail || {}).weekday ?? 0);
  if (d.cycle === 'monthly') return now.getDate() === ((d.cycleDetail || {}).day ?? 1);
  if (d.cycle === 'once') return true;
  if (d.cycle === 'range') return true;
  return false;
}

// 今日可做清单：排除「已用完」的
function todayDeals() {
  return DEALS
    .filter(d => dealStatusOf(d) !== 'used' && dealActiveToday(d))
    .sort((a, b) => dealScore(b) - dealScore(a));
}

function dealCycleLabel(d) {
  const W = ['日', '一', '二', '三', '四', '五', '六'];
  if (d.cycle === 'daily') return '每天都能做';
  if (d.cycle === 'weekly') return `每周${W[(d.cycleDetail || {}).weekday ?? 0]} 做一次`;
  if (d.cycle === 'monthly') return `每月 ${(d.cycleDetail || {}).day ?? 1} 号`;
  if (d.cycle === 'once') return '一次性 · 做完就没了';
  if (d.cycle === 'range') return '限时活动 · 随时可能结束';
  return '不定期';
}

function saveTotal() {
  return (state.dealLog || []).reduce((s, x) => s + x.amount, 0);
}
function saveMonthTotal() {
  const m = todayStr().slice(0, 7);
  return (state.dealLog || []).filter(x => x.date && x.date.startsWith(m)).reduce((s, x) => s + x.amount, 0);
}

// —— 首页入口条 ——
function renderHomeDealStrip() {
  const list = todayDeals();
  if (!list.length) return '';
  const saved = saveMonthTotal();
  const chips = list.slice(0, 8).map(d => {
    const cat = DEAL_CATS[d.cat] || {};
    return `<div class="hd-chip" data-deal-open="${d.id}">
      <span class="hd-ico" style="background:${cat.bg || 'rgba(245,185,60,.15)'}">${cat.icon || '🉐'}</span>
      <span class="hd-name">${esc(d.title)}</span>
      <span class="hd-amt">省 ¥${d.gain.min}-${d.gain.max}</span>
    </div>`;
  }).join('');
  return `
    <div class="home-deals">
      <div class="hd-head">
        <span>🉐 今日可省 · ${list.length} 条</span>
        <span class="hd-more" data-deal-more>全部攻略 ›</span>
      </div>
      ${saved > 0 ? `<div class="hd-saved">本月已省 <b>¥${fmt(saved)}</b></div>` : ''}
      <div class="hd-scroll">${chips}</div>
    </div>`;
}

// —— 攻略卡片 ——
function dealCard(d) {
  const cat = DEAL_CATS[d.cat] || {};
  const liked = !!state.dealLiked[d.id];
  const used = dealStatusOf(d) === 'used';
  const ready = dealStatusOf(d) === 'ready';
  const active = dealActiveToday(d);
  const stale = dealStale(d);
  const cyc = dealCycleShort(d);
  let badge = '';
  if (used) badge = `<span class="dc-badge used">已用完</span>`;
  else if (ready) badge = `<span class="dc-badge ready">有资格</span>`;
  return `
    <div class="deal-card ${used ? 'used' : ''} ${stale ? 'stale' : ''}" data-deal-open="${d.id}">
      <div class="dc-ico" style="background:${cat.bg || 'rgba(245,185,60,.15)'};color:${cat.color || '#f5b93c'}">${cat.icon || '🉐'}</div>
      <div class="dc-main">
        <div class="dc-title">${badge}${esc(d.title)}</div>
        <div class="dc-tag">${esc(d.tag)}</div>
        <div class="dc-meta">
          <span class="dc-gain">省 <b>${dealGainText(d)}</b>${d.periodGain ? `<i class="dc-period">+¥${d.periodGain.min}-${d.periodGain.max}/月</i>` : ''}</span>
          <span class="dc-time">⏱ ${d.time} 分钟</span>
          <span class="dc-cyc ${active && !used ? 'active' : ''}">📅 ${cyc}</span>
          ${stale ? '<span class="dc-stale">可能已过期</span>' : ''}
        </div>
      </div>
      <div class="dc-heart ${liked ? 'on' : ''}" data-deal-like="${d.id}">${liked ? '♥' : '♡'}</div>
    </div>`;
}

// —— 攻略库 ——
function renderDeals() {
  const todayN = todayDeals().length;
  let list = DEALS.slice();

  if (dealFilter === 'today') list = list.filter(d => dealActiveToday(d) && dealStatusOf(d) !== 'used');
  else if (dealFilter === 'liked') list = list.filter(d => state.dealLiked[d.id]);
  else if (dealFilter === 'fast') list = list.filter(d => d.time <= 5);
  else if (dealFilter !== 'all') list = list.filter(d => d.cat === dealFilter);

  if (dealSearch) {
    const q = dealSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(d =>
        (d.title + d.tag + d.steps.join('') + (d.tags || []).join('') + (d.requirement || []).join(''))
          .toLowerCase().includes(q));
    }
  }

  if (dealSort === 'recommend') list.sort((a, b) => dealScore(b) - dealScore(a));
  else if (dealSort === 'gain') list.sort((a, b) => dealMid(b) - dealMid(a));
  else if (dealSort === 'time') list.sort((a, b) => a.time - b.time);
  else if (dealSort === 'verify') list.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
  // 已用完的沉底（sort 稳定，不影响组内顺序）
  list.sort((a, b) => (dealStatusOf(a) === 'used' ? 1 : 0) - (dealStatusOf(b) === 'used' ? 1 : 0));

  const chips = [
    { k: 'all', name: '全部' },
    { k: 'today', name: `🔥 今天可做 ${todayN}` },
    { k: 'fast', name: '⚡ 5 分钟内' },
    { k: 'liked', name: `❤️ 收藏 ${Object.keys(state.dealLiked).length}` },
    ...Object.entries(DEAL_CATS).map(([k, v]) => ({ k, name: `${v.icon} ${v.name}` })),
  ].map(c => `<div class="filter-chip ${dealFilter === c.k ? 'active' : ''}" data-deal-filter="${c.k}">${c.name}</div>`).join('');

  const sortChips = [
    { k: 'recommend', name: '推荐' },
    { k: 'gain', name: '省得多' },
    { k: 'time', name: '最省事' },
    { k: 'verify', name: '最新验证' },
  ].map(c => `<div class="filter-chip ${dealSort === c.k ? 'active' : ''}" data-deal-sort="${c.k}">${c.name}</div>`).join('');

  return `
    <div class="page-head">
      <div>
        <div class="page-title">省钱<strong class="gold">攻略</strong></div>
        <div class="page-sub">共 ${DEALS.length} 条 · 今天顺手能做 ${todayN} 条</div>
      </div>
      <button class="random-btn" data-deal-log="">＋ 记一笔</button>
    </div>

    <div class="save-summary">
      <div class="ss-main">本月已省 <b>¥${fmt(saveMonthTotal())}</b></div>
      <div class="ss-sub">累计 ¥${fmt(saveTotal())} · ${(state.dealLog || []).length} 笔</div>
    </div>

    <div class="search-box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input id="deal-search-input" placeholder="搜攻略，如「外卖」「会员」「话费」" value="${esc(dealSearch)}">
    </div>

    <div class="filter-bar">${chips}</div>
    <div class="filter-bar" style="padding-top:0">${sortChips}</div>

    ${list.length ? list.map(dealCard).join('') :
      `<div class="empty"><div class="e-ico">🔍</div><div class="e-text">没找到相关攻略，换个关键词试试</div></div>`}

    <div class="deal-disclaimer">收益为预估区间（按偏低估算），实际以平台当期规则为准 · 攻略仅供参考，不保证可得</div>
  `;
}

// —— 攻略详情 ——
function renderDealDetail(d) {
  const cat = DEAL_CATS[d.cat] || {};
  const hr = dealHourly(d);
  const st = dealStatusOf(d);
  const stale = dealStale(d);
  const liked = !!state.dealLiked[d.id];

  return `
    <div class="detail-hero">
      <div class="back" data-back><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>返回</div>
      <div class="deal-d-cat" style="background:${cat.bg || 'rgba(245,185,60,.15)'};color:${cat.color || '#f5b93c'}">${cat.icon || '🉐'} ${cat.name || '省钱'}</div>
      <div class="detail-title">${esc(d.title)}</div>
      <div class="detail-tag">${esc(d.tag)}</div>
      <div class="meta-grid">
        <div class="meta-cell"><div class="v green">${dealGainText(d)}</div><div class="k">单次预估收益</div></div>
        <div class="meta-cell"><div class="v">${d.time} 分钟</div><div class="k">耗时</div></div>
        ${d.cycle === 'once' || dealRatio(d) > 10
          ? `<div class="meta-cell"><div class="v">${dealCycleShort(d)}</div><div class="k">频次</div></div>`
          : `<div class="meta-cell"><div class="v ${hr >= 200 ? 'green' : ''}">≈¥${hr}</div><div class="k">折合时薪</div></div>`}
      </div>
    </div>

    ${stale ? `<div class="deal-stale-banner">⚠️ 这条攻略已超过 ${DEAL_STALE_DAYS} 天未验证，活动规则可能已变，请以 App 内实际页面为准</div>` : ''}

    <div class="deal-status-card">
      <div class="dsc-head">
        <span>我的资格状态</span>
        <span class="dsc-cur ${st === 'used' ? 'used' : st === 'ready' ? 'ready' : ''}">${st === 'used' ? '已用完' : st === 'ready' ? '还有资格' : '未标记'}</span>
      </div>
      <div class="dsc-sub">「已用完」的攻略会从今日清单里消失，避免白跑一趟</div>
      <div class="dsc-btns">
        <button class="dsc-btn ${st === 'ready' ? 'on' : ''}" data-deal-status="${d.id}" data-st="ready">✅ 还有资格</button>
        <button class="dsc-btn ${st === 'used' ? 'on danger' : ''}" data-deal-status="${d.id}" data-st="used">🚫 已用完</button>
      </div>
    </div>

    <div class="detail-sec">
      <div class="sec-h"><div class="sec-num green">1</div>这条怎么操作</div>
      ${(d.steps || []).map((s, i) => `
        <div class="step-item deal-step">
          <div class="step-no">${i + 1}</div>
          <div><div class="st-do">${esc(s)}</div></div>
        </div>`).join('')}
    </div>

    <div class="detail-sec">
      <div class="sec-h"><div class="sec-num">2</div>注意事项</div>
      ${(d.risks || []).map(p => `
        <div class="pitfall-item"><div class="w">⚠️</div><div>${esc(p)}</div></div>`).join('')}
    </div>

    <div class="deal-info-card">
      <div class="dic-row"><span>周期</span><b>${dealCycleLabel(d)}</b></div>
      <div class="dic-row"><span>前置条件</span><b>${(d.requirement || []).length ? esc(d.requirement.join('、')) : '无'}</b></div>
      <div class="dic-row"><span>最后验证</span><b class="${stale ? 'red' : 'green'}">${d.verifiedAt.slice(5)}</b></div>
    </div>

    <div class="deal-actions">
      <button class="deal-log-btn" data-deal-log="${d.id}">💸 记一笔省下的钱</button>
      <button class="deal-like-btn ${liked ? 'on' : ''}" data-deal-like="${d.id}">${liked ? '♥ 已收藏' : '♡ 收藏'}</button>
    </div>

    <div class="detail-sec">
      <div class="sec-h"><div class="sec-num green">!</div>通用避坑</div>
      ${DEAL_TIPS.map(t => `<div class="pitfall-item"><div class="w">🛡️</div><div>${esc(t)}</div></div>`).join('')}
    </div>

    <div class="deal-disclaimer">收益为预估区间，实际以平台当期规则为准 · 攻略仅供参考，不保证可得</div>
  `;
}

function openDealDetail(id) {
  const d = DEALS.find(x => x.id === id);
  if (!d) return;
  currentView = 'dealDetail';
  currentDealId = id;
  updateTabbar();
  view.innerHTML = renderDealDetail(d);
  window.scrollTo(0, 0);
  bindViewEvents('dealDetail');
}

function toggleDealLike(id, node) {
  const on = !state.dealLiked[id];
  if (on) state.dealLiked[id] = Date.now();
  else delete state.dealLiked[id];
  saveState();
  if (node && node.classList.contains('dc-heart')) {
    // 列表里的心形就地切换，避免重绘把列表滚动位置顶回顶部
    node.classList.toggle('on', on);
    node.textContent = on ? '♥' : '♡';
  } else if (currentView === 'dealDetail') {
    openDealDetail(id);
  } else if (currentView === 'deals' && dealFilter === 'liked') {
    render('deals');
  } else {
    render(currentView);
  }
  toast(on ? '已收藏这条攻略 ♥' : '已取消收藏');
}

function setDealStatus(id, st) {
  const cur = (state.dealStatus || {})[id] || '';
  state.dealStatus = state.dealStatus || {};
  if (cur === st) {
    delete state.dealStatus[id];
    toast('已取消标记');
  } else {
    state.dealStatus[id] = st;
    toast(st === 'used' ? '已标记为用完，不再出现在今日清单' : '已标记为还有资格');
  }
  saveState();
  if (currentView === 'dealDetail') openDealDetail(id);
  else render(currentView);
}

// —— 省钱台账 ——
function renderSaveRecords() {
  const logs = (state.dealLog || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const total = logs.reduce((s, x) => s + x.amount, 0);
  const month = todayStr().slice(0, 7);
  const monthLogs = logs.filter(x => x.date && x.date.startsWith(month));
  const monthTotal = monthLogs.reduce((s, x) => s + x.amount, 0);

  const agg = {};
  logs.forEach(x => {
    const k = x.dealId || x.title || '其他';
    if (!agg[k]) agg[k] = { title: x.title || '其他', amount: 0, count: 0 };
    agg[k].amount += x.amount;
    agg[k].count++;
  });
  const top = Object.values(agg).sort((a, b) => b.amount - a.amount).slice(0, 5);

  return `
    <div class="page-head">
      <div>
        <div class="page-title">省钱<strong class="gold">台账</strong></div>
        <div class="page-sub">每一次省下的钱，都算数</div>
      </div>
      <button class="random-btn" data-deal-log="">＋ 记一笔</button>
    </div>

    <div class="save-total">
      <div class="st-main">本月已省 <b>¥${fmt(monthTotal)}</b></div>
      <div class="st-sub">累计 ¥${fmt(total)} · 共 ${logs.length} 笔 · 本月 ${monthLogs.length} 笔</div>
    </div>

    ${top.length ? `
    <div class="save-top">
      <div class="stp-head">💰 省得最多的</div>
      ${top.map((v, i) => `
        <div class="stp-row">
          <span class="stp-rank ${i === 0 ? 'top' : ''}">${i + 1}</span>
          <span class="stp-name">${esc(v.title)}</span>
          <span class="stp-n">${v.count} 次</span>
          <span class="stp-amt">¥${fmt(v.amount)}</span>
        </div>`).join('')}
    </div>` : ''}

    ${logs.length ? logs.map(x => `
      <div class="save-row">
        <div class="sr-date">${String(x.date || '').slice(5)}</div>
        <div class="sr-main">
          <div class="sr-title">${esc(x.title || '省钱')}</div>
          ${x.note ? `<div class="sr-note">${esc(x.note)}</div>` : ''}
        </div>
        <div class="sr-amt">¥${x.amount}</div>
        <div class="sr-del" data-deal-del="${x.id}">✕</div>
      </div>`).join('') :
      `<div class="empty"><div class="e-ico">💸</div><div class="e-text">还没有省钱记录<br>记下第一笔，看着数字变大</div></div>`}

    <div class="deal-disclaimer">这里记的是「省下的钱」，和「收益记录」里的收入分开计算</div>
  `;
}

function openDealLogSheet(dealId) {
  const d = dealId ? DEALS.find(x => x.id === dealId) : null;
  const opts = DEALS.map(x =>
    `<option value="${x.id}" ${d && x.id === d.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>记一笔省下的钱</h3>
        <div class="sheet-field">
          <label class="sf-label">来源攻略</label>
          <select id="deal-log-item">${opts}</select>
        </div>
        <div class="sheet-field">
          <label class="sf-label">省下多少（元）</label>
          <input id="deal-log-amount" type="number" inputmode="decimal" placeholder="如 8">
          <div class="money-quick">
            ${[5, 10, 20, 50].map(v => `<button type="button" class="mq-chip" data-quick-amt="${v}">¥${v}</button>`).join('')}
          </div>
        </div>
        <div class="sheet-field">
          <label class="sf-label">备注</label>
          <input id="deal-log-note" type="text" placeholder="如：周三外卖满减">
        </div>
        <div class="sheet-field">
          <label class="sf-label">日期</label>
          <input id="deal-log-date" type="date" value="${todayStr()}">
        </div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-save>保存</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);

  mask.querySelectorAll('[data-quick-amt]').forEach(c => {
    c.onclick = () => {
      const amt = mask.querySelector('#deal-log-amount');
      amt.value = c.dataset.quickAmt;
      mask.querySelectorAll('.mq-chip').forEach(x => x.classList.toggle('on', x === c));
    };
  });

  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };

  mask.querySelector('[data-save]').onclick = () => {
    const sel = mask.querySelector('#deal-log-item');
    const amount = parseFloat(mask.querySelector('#deal-log-amount').value);
    const note = mask.querySelector('#deal-log-note').value.trim();
    const date = mask.querySelector('#deal-log-date').value || todayStr();
    if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
    const deal = sel.value ? DEALS.find(x => x.id === sel.value) : null;
    state.dealLog = state.dealLog || [];
    state.dealLog.unshift({
      id: Date.now() + Math.random().toString(16).slice(2),
      dealId: deal ? deal.id : '',
      title: deal ? deal.title : (note || '省钱'),
      amount,
      note,
      date,
    });
    // 每条攻略第一次记账给 5 金币，防止刷记录
    let reward = 0;
    state.dealRewarded = state.dealRewarded || [];
    if (deal && !state.dealRewarded.includes(deal.id)) {
      state.dealRewarded.push(deal.id);
      reward = 5;
    }
    saveState();
    close();
    if (reward) addCoins(reward, '记录省钱攻略');
    toast(reward ? `省下 ¥${amount}，+${reward} 🪙` : `省下 ¥${amount} 💸`);
    if (currentView === 'saveRecords' || currentView === 'mine' || currentView === 'deals') render(currentView);
    else if (currentView === 'dealDetail' && currentDealId) openDealDetail(currentDealId);
    else if (currentView === 'home') render('home');
  };
}

function delDealLog(id) {
  const item = (state.dealLog || []).find(x => x.id === id);
  if (!item) return;
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>删除这笔记录？</h3>
        <div class="del-info">${esc(item.title)} · ¥${item.amount} · ${item.date}</div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok danger" data-confirm-del>删除</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-confirm-del]').onclick = () => {
    state.dealLog = (state.dealLog || []).filter(x => x.id !== id);
    saveState();
    close();
    render('saveRecords');
    toast('已删除');
  };
}

// ============ 收入趋势图 ============
let chartRange = 7; // 7 | 30
let recordsMonth = 'all'; // 收益记录月份筛选
function renderIncomeChart() {
  const days = chartRange;
  const out = [];
  const today = todayStr();
  const dateSet = new Set();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    dateSet.add(ds);
  }
  const dayIn = {};
  state.records.filter(r => r.type === 'in').forEach(r => {
    if (dateSet.has(r.date)) dayIn[r.date] = (dayIn[r.date] || 0) + r.amount;
  });
  const maxV = Math.max(1, ...Object.values(dayIn));
  const keys = [...dateSet];
  const bars = keys.map(ds => {
    const v = dayIn[ds] || 0;
    const h = Math.round(v / maxV * 100);
    const isToday = ds === today;
    const wd = ['日','一','二','三','四','五','六'][new Date(ds + 'T00:00:00').getDay()];
    return `<div class="chart-col ${isToday ? 'today' : ''}" title="${ds} · ¥${fmt(v)}">
      <div class="chart-val">${v ? '¥' + fmt(v) : ''}</div>
      <div class="chart-bar"><div class="chart-fill" style="height:${h}%"></div></div>
      <div class="chart-label">${iToday(ds) ? '今' : days <= 7 ? wd : String(new Date(ds+'T00:00:00').getDate())}</div>
    </div>`;
  }).join('');
  const total = keys.reduce((s, ds) => s + (dayIn[ds] || 0), 0);
  const activeDays = keys.filter(ds => dayIn[ds]).length;
  return `
    <div class="chart-card">
      <div class="chart-head">
        <div class="ch-title">收入趋势</div>
        <div class="ch-range">
          <button class="ch-opt ${chartRange === 7 ? 'on' : ''}" data-chart="7">7天</button>
          <button class="ch-opt ${chartRange === 30 ? 'on' : ''}" data-chart="30">30天</button>
        </div>
      </div>
      <div class="chart-bars">${bars}</div>
      <div class="chart-foot">近 ${days} 天收入 <b>¥${fmt(total)}</b> · 有进账 ${activeDays} 天</div>
    </div>`;
}
function iToday(ds) { return ds === todayStr(); }

// ============ 记账 ============
function renderRecords() {
  const months = [...new Set(state.records.filter(r => r.date).map(r => r.date.slice(0, 7)))].sort().reverse();
  const filtered = recordsMonth === 'all' ? state.records : state.records.filter(r => r.date && r.date.startsWith(recordsMonth));
  const totalIn = filtered.filter(r => r.type === 'in').reduce((s,r) => s+r.amount, 0);
  const totalOut = filtered.filter(r => r.type === 'out').reduce((s,r) => s+r.amount, 0);
  const sorted = [...filtered].sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const chips = [{ ym: 'all', name: '全部' }, ...months.map(m => ({ ym: m, name: `${Number(m.slice(5))}月` }))]
    .map(c => `<div class="filter-chip ${recordsMonth === c.ym ? 'active' : ''}" data-rec-month="${c.ym}">${c.name}</div>`).join('');
  const sumBar = recordsMonth !== 'all' && filtered.length ? `
    <div class="rm-sum"><b>${Number(recordsMonth.slice(5))}月</b> 收入 <b class="g">¥${fmt(totalIn)}</b> · 支出 <b class="r">¥${fmt(totalOut)}</b> · 净赚 <b class="gold">¥${fmt(totalIn - totalOut)}</b></div>` : '';
  return `
    <div class="page-head">
      <div><div class="page-title">收益<strong class="gold">记账</strong></div>
      <div class="page-sub">赚到的每一分都算数</div></div>
      <div class="head-right" style="display:flex;gap:8px"><div class="icon-btn" data-export-records title="导出CSV"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg></div><div class="icon-btn" data-addmoney><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></div></div>
    </div>
    <div class="money-summary">
      <div class="lb">${recordsMonth === 'all' ? '累计收益' : `${Number(recordsMonth.slice(5))}月收益`}</div>
      <div class="total">¥${fmt(totalIn-totalOut)} <small>（收 ¥${fmt(totalIn)} / 支 ¥${fmt(totalOut)}）</small></div>
    </div>
    ${months.length ? `<div class="filter-bar">${chips}</div>` : ''}
    ${sumBar}
    <button class="add-money-btn" data-addmoney>＋ 记一笔</button>
    ${renderIncomeChart()}
    ${sorted.length ? sorted.map(r => `
      <div class="record-item" data-edit="${r.id}">
        <div class="ri-ico" style="background:${r.type==='in' ? 'rgba(46,204,113,.15)':'rgba(255,91,106,.12)'}">${r.type==='in'?'💸':'🛒'}</div>
        <div class="ri-main">
          <div class="ri-title">${esc(r.title)}<span class="ri-edit-hint">✎</span></div>
          <div class="ri-time">${esc(r.note||'')} · ${r.date || '—'}</div>
        </div>
        <div class="ri-amt ${r.type==='out'?'red':''}">${r.type==='out'?'-':'+'}¥${r.amount}</div>
        <div class="ri-del" data-del="${r.id}">✕</div>
        ${r.routeId ? `<div class="ri-go" data-open-route="${r.routeId}" title="查看路子">↗</div>` : ''}
      </div>`).join('')
    : `<div class="empty"><div class="e-ico">💰</div><div class="e-text">${recordsMonth === 'all' ? '还没有收益记录<br>每赚一笔就记下来，看着数字涨' : '这个月还没有收益记录'}</div></div>`}
  `;
}

// ============ 我的收藏页 ============
function renderLikes(routes) {
  const liked = routes.filter(r => state.liked[r.id]);
  let list = liked;
  if (likesFilter !== 'all') list = list.filter(r => r.cat === likesFilter);
  const stamp = (id) => { const v = state.liked[id]; return typeof v === 'number' ? v : 0; };
  if (likesSort === 'time') list = [...list].sort((a, b) => stamp(b.id) - stamp(a.id));
  else if (likesSort === 'money') list = [...list].sort((a, b) => b.monthly[1] - a.monthly[1]);
  else if (likesSort === 'easy') list = [...list].sort((a, b) => a.diff - b.diff);

  const catChips = [{ k: 'all', name: '全部' }, ...Object.entries(CATS).map(([k, v]) => ({ k, name: v.name }))]
    .map(c => `<div class="filter-chip ${likesFilter === c.k ? 'active' : ''}" data-likes-filter="${c.k}">${c.name}</div>`).join('');
  const sortChips = [{ k: 'time', name: '最近收藏' }, { k: 'money', name: '收入高' }, { k: 'easy', name: '易上手' }]
    .map(c => `<div class="filter-chip ${likesSort === c.k ? 'active' : ''}" data-likes-sort="${c.k}">${c.name}</div>`).join('');

  return `
    <div class="page-head">
      <div class="back" data-back style="display:inline-flex;align-items:center;gap:6px;color:var(--text2);font-size:13px;margin-bottom:8px;cursor:pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px"><path d="M15 18l-6-6 6-6"/></svg>返回</div>
      <div><div class="page-title">我的<strong class="gold">收藏</strong></div>
      <div class="page-sub">${liked.length} 条收藏的路子</div></div>
    </div>
    <div class="filter-bar">${catChips}</div>
    <div class="filter-bar" style="padding-top:0">${sortChips}</div>
    ${list.length ? list.map(r => routeCard(r)).join('') :
      (liked.length ?
        `<div class="empty"><div class="e-ico">🔍</div><div class="e-text">这个分类下还没有收藏的路子</div></div>` :
        `<div class="empty"><div class="e-ico">❤️</div><div class="e-text">还没有收藏<br>看到合适的路子，点♡收藏</div></div>`)}
  `;
}

// ============ 事件绑定 ============
function bindViewEvents(viewName) {
  // 底部导航
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => render(t.dataset.view);
  });

  // 分类点击
  view.querySelectorAll('[data-cat]').forEach(c => {
    c.onclick = () => { libFilter = c.dataset.cat; render('library'); };
  });

  // 打开详情（事件委托）——注意顺序：like/swap/track 要在 open 之前判断，
  // 否则按钮会被卡片/容器的 data-open 祖先拦截
  view.onclick = (e) => {
    // 省钱攻略：点赞/状态必须排在 data-deal-open 之前
    const dealLike = e.target.closest('[data-deal-like]');
    if (dealLike) { toggleDealLike(dealLike.dataset.dealLike, dealLike); return; }
    const dealSt = e.target.closest('[data-deal-status]');
    if (dealSt) { setDealStatus(dealSt.dataset.dealStatus, dealSt.dataset.st); return; }
    const dealLogBtn = e.target.closest('[data-deal-log]');
    if (dealLogBtn) { openDealLogSheet(dealLogBtn.dataset.dealLog); return; }
    const dealDel = e.target.closest('[data-deal-del]');
    if (dealDel) { delDealLog(dealDel.dataset.dealDel); return; }
    const dealOpen = e.target.closest('[data-deal-open]');
    if (dealOpen) { openDealDetail(dealOpen.dataset.dealOpen); return; }
    const dealMore = e.target.closest('[data-deal-more]');
    if (dealMore) { dealFilter = 'all'; dealSearch = ''; render('deals'); return; }
    const like = e.target.closest('[data-like]');
    if (like) { toggleLike(like.dataset.like); return; }
    const like2 = e.target.closest('[data-like2]');
    if (like2) { toggleLike(like2.dataset.like2, true); return; }
    const vote = e.target.closest('[data-vote]');
    if (vote) { toggleVote(vote.dataset.vote); return; }
    const swaptoday = e.target.closest('[data-swap-today]');
    if (swaptoday) { swapTodayRoute(); return; }
    const undoswap = e.target.closest('[data-undo-swap]');
    if (undoswap) { undoSwapTodayRoute(); return; }
    const track = e.target.closest('[data-track]');
    if (track) { if (currentPreview) { toast('🌅 明天开始执行，明天会出现在首页哦'); return; } addTrack(track.dataset.track); return; }
    const chstart = e.target.closest('[data-challenge-start]');
    if (chstart) { startChallenge(chstart.dataset.challengeStart); return; }
    const tomopen = e.target.closest('[data-open-tomorrow]');
    if (tomopen) { openDetail(tomopen.dataset.openTomorrow, true); return; }
    const rmopen = e.target.closest('[data-rm-open]');
    if (rmopen) { openDetail(rmopen.dataset.rmOpen); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openDetail(open.dataset.open); return; }
    const back = e.target.closest('[data-back]');
    if (back) { history.back(); return; }
    const checkin = e.target.closest('[data-checkin]');
    if (checkin) { doCheckin(); return; }
    const tsBtn = e.target.closest('[data-ts]');
    if (tsBtn) {
      const k = tsBtn.dataset.ts;
      if (k === 'sign') { doCheckin(); return; }
      if (k === 'exec') { const ev2 = document.querySelector('.trv-actions'); if (ev2) ev2.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (k === 'book') { const tr2 = routeForDate(todayStr()); if (tr2) openMoneySheet(tr2.id); else toast('今天还没有今日路子'); return; }
    }
    const makeup = e.target.closest('[data-makeup]');
    if (makeup) { openMakeupConfirm(); return; }
    const coinledger = e.target.closest('[data-coin-ledger]');
    if (coinledger) { openCoinLedger(); return; }
    const coinshop = e.target.closest('[data-coin-shop]');
    if (coinshop) { openCoinShop(); return; }
    const luckybox = e.target.closest('[data-lucky-box]');
    if (luckybox) { openLuckyBox(); return; }
    const addcc = e.target.closest('[data-add-custom-check]');
    if (addcc) { openAddCustomCheck(addcc.dataset.addCustomCheck); return; }
    const delcc = e.target.closest('[data-del-custom-check]');
    if (delcc) { delCustomCheck(delcc.dataset.delCustomRoute, parseInt(delcc.dataset.delCustomCheck, 10)); return; }
    const dcheck = e.target.closest('[data-dcheck]');
    if (dcheck) { toggleCheck(currentDetailId, parseInt(dcheck.dataset.dcheck)); return; }
    const step = e.target.closest('[data-step]');
    if (step) { toggleStepProgress(currentDetailId, parseInt(step.dataset.step, 10)); return; }
    const check = e.target.closest('[data-check]');
    if (check) { toggleCheck(check.dataset.check, parseInt(check.dataset.checkid)); return; }
    const addmoney = e.target.closest('[data-addmoney]');
    if (addmoney) { openMoneySheet(); return; }
    const exportrec = e.target.closest('[data-export-records]');
    if (exportrec) { exportRecordsCsv(); return; }
    const del = e.target.closest('[data-del]');
    if (del) { openDelRecordConfirm(del.dataset.del); return; }
    const openroute = e.target.closest('[data-open-route]');
    if (openroute) { openDetail(openroute.dataset.openRoute); return; }
    const recmonth = e.target.closest('[data-rec-month]');
    if (recmonth) { recordsMonth = recmonth.dataset.recMonth; render('records'); return; }
    const fiBtn = e.target.closest('[data-first-in-celebrate]');
    if (fiBtn) { state.firstInCelebrated = true; saveState(); render('mine'); return; }
    const editrec = e.target.closest('[data-edit]');
    if (editrec) { openMoneySheet(null, editrec.dataset.edit); return; }
    const money = e.target.closest('[data-money]');
    if (money) { openMoneySheet(money.dataset.money); return; }
    const lfilter = e.target.closest('[data-likes-filter]');
    if (lfilter) { likesFilter = lfilter.dataset.likesFilter; render('likes'); return; }
    const lsort = e.target.closest('[data-likes-sort]');
    if (lsort) { likesSort = lsort.dataset.likesSort; render('likes'); return; }
    const da = e.target.closest('[data-daily-action]');
    if (da) {
      const a = parseInt(da.dataset.dailyAction, 10);
      const tr = routeForDate(todayStr());
      if (!tr) return;
      if (a === 1) addTrack(tr.id);
      else if (a === 2) openDetail(tr.id);
      else if (a === 3) openMoneySheet(tr.id);
      return;
    }
    const goalgo = e.target.closest('[data-goal-go]');
    if (goalgo) { location.hash = 'mine'; return; }
    const savegoal = e.target.closest('[data-save-goal-set]');
    if (savegoal) { openSaveGoalSheet(); return; }
    const earn = e.target.closest('[data-earn]');
    if (earn) { openMoneySheet(earn.dataset.earn); return; }
    const reviewBtn = e.target.closest('[data-review]');
    if (reviewBtn) { setTodayReview(reviewBtn.dataset.review); return; }
    const reviewRepick = e.target.closest('[data-review-repick]');
    if (reviewRepick) {
      const today = todayStr();
      if (state.reviews) delete state.reviews[today];
      if (state.reviewNotes) delete state.reviewNotes[today];
      saveState();
      render('home');
      return;
    }
    const rvnote = e.target.closest('[data-rv-note-save]');
    if (rvnote) {
      const today = todayStr();
      const input = rvnote.closest('.rv-note') ? rvnote.closest('.rv-note').querySelector('[data-rv-note-input]') : null;
      const val = input ? input.value.trim() : '';
      if (!val) { toast('写点什么再保存吧'); return; }
      state.reviewNotes = state.reviewNotes || {};
      state.reviewNotes[today] = val;
      saveState();
      render('home');
      toast('📝 心得已保存');
      return;
    }
    const rvnoteEdit = e.target.closest('[data-rv-note-edit]');
    if (rvnoteEdit) {
      const today = todayStr();
      const old = (state.reviewNotes || {})[today] || '';
      const rv = rvnoteEdit.closest('.rv-note.saved');
      if (rv) {
        rv.outerHTML = `<div class="rv-note"><textarea class="rv-note-input" data-rv-note-input maxlength="60" rows="2">${esc(old)}</textarea><button class="rv-note-save" data-rv-note-save>💾 保存</button></div>`;
      }
      return;
    }
    const reviewRecord = e.target.closest('[data-review-record]');
    if (reviewRecord) { openMoneySheet(reviewRecord.dataset.reviewRecord); return; }
    const gomine = e.target.closest('[data-go]');
    if (gomine) { if (gomine.dataset.go === 'remote') openRemoteSheet(); else if (gomine.dataset.go === 'notif') openNotifSheet(); else if (gomine.dataset.go === 'guard') location.hash = 'guard'; else render(gomine.dataset.go); return; }
    const guardread = e.target.closest('[data-guard-read]');
    if (guardread) { guardReadReward(); return; }
    const guardentry = e.target.closest('[data-guard-entry]');
    if (guardentry) { location.hash = 'guard'; return; }
    const wgset = e.target.closest('[data-week-goal-set]');
    if (wgset) { openWeekGoalSheet(); return; }
    const opentasks = e.target.closest('[data-open-tasks]');
    if (opentasks) { openTasksSheet(); return; }
    const ach = e.target.closest('[data-ach]');
    if (ach) { openAchieveSheet(parseInt(ach.dataset.ach, 10)); return; }
    const guidenext = e.target.closest('[data-guide-next]');
    if (guidenext) { nextGuide(); return; }
    const guidejump = e.target.closest('[data-guide-jump]');
    if (guidejump) { location.hash = guidejump.dataset.guideJump; return; }
    const share = e.target.closest('[data-share]');
    if (share) { shareRoute(share.dataset.share); return; }
    const cmp = e.target.closest('[data-compare]');
    if (cmp) { openCompareSheet(cmp.dataset.compare); return; }
    const sharecard = e.target.closest('[data-share-card]');
    if (sharecard) { shareCard(sharecard.dataset.shareCard); return; }
    const shareearn = e.target.closest('[data-share-earn]');
    if (shareearn) { shareEarnCard(); return; }
    const shareweek = e.target.closest('[data-share-week]');
    if (shareweek) { shareWeekCard(); return; }
    const copyfirst = e.target.closest('[data-copy-first]');
    if (copyfirst) { copyFirstStep(copyfirst.dataset.copyFirst); return; }
    const copylist = e.target.closest('[data-copy-list]');
    if (copylist) { copyChecklist(copylist.dataset.copyList); return; }
    const calprev = e.target.closest('[data-cal-prev]');
    if (calprev) { shiftCalCursor(-1); return; }
    const calnext = e.target.closest('[data-cal-next]');
    if (calnext) { shiftCalCursor(1); return; }
    const calday = e.target.closest('[data-cal-day]');
    if (calday) { openDayDetail(calday.dataset.calDay); return; }
    const chart = e.target.closest('[data-chart]');
    if (chart) { chartRange = parseInt(chart.dataset.chart, 10); render(currentView); return; }
    const goaledit = e.target.closest('[data-goal-edit]');
    if (goaledit) { openGoalSheet(); return; }
    const backup = e.target.closest('[data-backup]');
    if (backup) { backupData(); return; }
    const restore = e.target.closest('[data-restore]');
    if (restore) { openRestoreSheet(); return; }
    const reset = e.target.closest('[data-reset]');
    if (reset) { openResetConfirm(); return; }
  };

  // 筛选
  view.querySelectorAll('[data-filter]').forEach(c => {
    c.onclick = () => { libFilter = c.dataset.filter; render('library'); };
  });
  view.querySelectorAll('[data-sort]').forEach(c => {
    c.onclick = () => { libSort = c.dataset.sort; render('library'); };
  });

  // 搜索
  const searchInput = view.querySelector('#search-input');
  if (searchInput) {
    let histTimer;
    searchInput.oninput = (e) => {
      libSearch = e.target.value; render('library');
      clearTimeout(histTimer);
      histTimer = setTimeout(() => { pushSearchHist(e.target.value); }, 600);
    };
  }
  view.querySelectorAll('[data-search-hist]').forEach(c => {
    c.onclick = () => { libSearch = c.dataset.searchHist; pushSearchHist(libSearch); render('library'); };
  });
  const clearHist = view.querySelector('[data-clear-search-hist]');
  if (clearHist) {
    clearHist.onclick = () => { state.searchHistory = []; saveState(); render('library'); };
  }

  // 随机看一条
  const randomBtn = view.querySelector('[data-random-route]');
  if (randomBtn) {
    randomBtn.onclick = () => {
      const pool = allRoutes();
      if (!pool.length) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      openDetail(pick.id);
    };
  }

  // 省钱攻略：分类筛选 / 排序 / 搜索
  view.querySelectorAll('[data-deal-filter]').forEach(c => {
    c.onclick = () => { dealFilter = c.dataset.dealFilter; dealSearch = ''; render('deals'); };
  });
  view.querySelectorAll('[data-deal-sort]').forEach(c => {
    c.onclick = () => { dealSort = c.dataset.dealSort; render('deals'); };
  });
  const dealSearchInput = view.querySelector('#deal-search-input');
  if (dealSearchInput) {
    dealSearchInput.oninput = (e) => {
      dealSearch = e.target.value;
      render('deals');
      // 重绘后恢复焦点与光标位置，避免搜索框一顿一顿
      const ni = view.querySelector('#deal-search-input');
      if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); }
    };
  }
  const dealSearchClear = view.querySelector('[data-deal-search-clear]');
  if (dealSearchClear) {
    dealSearchClear.onclick = () => { dealSearch = ''; render('deals'); };
  }
}

function handleGo(go) {
  if (go === 'library') render('library');
  else if (go === 'likes') render('likes');
  else if (go === 'records') render('records');
  else if (go === 'guide') render('guide');
  else if (go === 'remote') openRemoteSheet();
  else if (go === 'about') render('about');
}

function openDetail(id, preview) {
  const r = allRoutes().find(x => x.id === id);
  if (!r) return;
  currentView = 'detail';
  currentDetailId = id;
  currentPreview = !!preview;
  updateTabbar();
  view.innerHTML = renderDetail(r);
  window.scrollTo(0, 0);
  bindViewEvents('detail');
}

function toggleLike(id, rerender) {
  if (state.liked[id]) delete state.liked[id];
  else state.liked[id] = Date.now();
  saveState();
  notifyNewAchievements();
  checkTasks();
  if (rerender && currentView === 'detail') openDetail(id, currentPreview);
  else if (currentView === 'library') render('library');
  else if (currentView === 'likes') render('likes');
  else render(currentView);
}

// 有用/没意见 反馈：影响热门排序
function toggleVote(id) {
  if (state.routeVotes[id] === 'like') { delete state.routeVotes[id]; toast('已取消 👍'); }
  else { state.routeVotes[id] = 'like'; toast('谢谢反馈，会让它更靠前 👍'); }
  saveState();
  notifyNewAchievements();
  if (currentView === 'detail') openDetail(id, currentPreview);
  else render(currentView);
}

function addTrack(id) {
  // 预置今天的打卡记录为空清单
  const today = todayStr();
  const key = `${id}::${today}`;
  if (!state.checks[key]) {
    const r = allRoutes().find(x => x.id === id);
    state.checks[key] = {};
    if (r) {
      r.checklist.forEach((_, i) => { if (!state.checks[key][i]) state.checks[key][i] = false; });
      customChecksFor(id).forEach((_, j) => { state.checks[key][r.checklist.length + j] = false; });
    }
  }
  saveState();
  toast('已加入今日打卡');
  checkTasks();
  render('track');
}

// 该路子累计完成的打卡项数（跨天累计，不会因为换天丢失）
function routeDoneTotal(routeId) {
  let total = 0;
  const r = allRoutes().find(x => x.id === routeId);
  if (!r) return 0;
  Object.keys(state.checks).forEach(k => {
    if (k.startsWith(routeId + '::')) {
      total += Object.values(state.checks[k]).filter(Boolean).length;
    }
  });
  return total;
}

// 该路子总打卡项数（固定 checklist + 自定义项）
function routeChecklistTotal(routeId) {
  const r = allRoutes().find(x => x.id === routeId);
  return r ? r.checklist.length + customChecksFor(routeId).length : 0;
}
// 该路子的自定义打卡项（上限 10 条）
function customChecksFor(routeId) {
  return (state.customChecks || {})[routeId] || [];
}
const CUSTOM_CHECK_MAX = 10;
// 今天该路子所有打卡项（固定+自定义）是否全部完成
function totalCheckDone(r) {
  const day = state.checks[`${r.id}::${todayStr()}`] || {};
  const total = routeChecklistTotal(r.id);
  if (total <= 0) return false;
  for (let i = 0; i < total; i++) if (!day[i]) return false;
  return true;
}

// 添加自定义打卡项弹窗
function openAddCustomCheck(routeId) {
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>➕ 添加自定义打卡项</h3>
        <p style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.6">写一个你自己的小动作，加进打卡清单跟着做。<br>比如：加 3 个同行微信、谈成 1 单再休息。</p>
        <div class="sheet-field">
          <label class="sf-label">打卡内容</label>
          <input id="custom-check-input" placeholder="输入你的打卡项" maxlength="50">
        </div>
        <button class="primary" style="width:100%;padding:13px" data-save-custom-check>保存打卡项</button>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-save-custom-check]').onclick = () => {
    const v = (mask.querySelector('#custom-check-input').value || '').trim();
    if (!v) { toast('请输入打卡内容'); return; }
    state.customChecks = state.customChecks || {};
    const arr = state.customChecks[routeId] || (state.customChecks[routeId] = []);
    if (arr.length >= CUSTOM_CHECK_MAX) { toast(`自定义打卡项最多 ${CUSTOM_CHECK_MAX} 条`); return; }
    arr.push(v);
    const r = allRoutes().find(x => x.id === routeId);
    const base = r ? r.checklist.length : 0;
    const key = `${routeId}::${todayStr()}`;
    state.checks[key] = state.checks[key] || {};
    state.checks[key][base + arr.length - 1] = false;
    saveState();
    close();
    if (currentView === 'detail') openDetail(routeId, currentPreview); else render('track');
    toast('已添加打卡项 ✅');
  };
}

// 删除自定义打卡项（并迁移 checks 索引，避免后面项错位）
function delCustomCheck(routeId, idx) {
  const arr = customChecksFor(routeId);
  const r = allRoutes().find(x => x.id === routeId);
  const base = r ? r.checklist.length : 0;
  if (!arr.length || idx >= arr.length) return;
  arr.splice(idx, 1);
  Object.keys(state.checks).forEach(k => {
    if (!k.startsWith(routeId + '::')) return;
    const dc = state.checks[k];
    for (let j = base + idx; j < base + arr.length + 1; j++) {
      if (dc[j + 1] !== undefined) dc[j] = dc[j + 1];
      else delete dc[j];
    }
  });
  saveState();
  if (currentView === 'detail') openDetail(routeId, currentPreview); else render('track');
  toast('已删除打卡项');
}

function toggleCheck(routeId, checkId) {
  const today = todayStr();
  const key = `${routeId}::${today}`;
  if (!state.checks[key]) state.checks[key] = {};
  state.checks[key][checkId] = !state.checks[key][checkId];
  // 累计进度：按今天的勾选状态 + 历史已勾选
  const r = allRoutes().find(x => x.id === routeId);
  if (r) {
    let done = 0;
    const totalN = routeChecklistTotal(routeId);
    for (let i = 0; i < totalN; i++) {
      // 只要某一天勾选过就算完成
      const doneAnyDay = Object.keys(state.checks).some(k =>
        k.startsWith(routeId + '::') && state.checks[k][i]);
      if (doneAnyDay) done++;
    }
    state.progress[routeId] = Math.min(r.steps.length, done);
    // 今日清单全部完成 → 庆祝动效
    if (totalCheckDone(r)) celebrate();
  }
  challengeTick(routeId); // 30 天挑战推进（打卡后）
  saveState();
  notifyNewAchievements();
  checkTasks();
  if (currentView === 'detail') openDetail(routeId, currentPreview);
  else render('track');
}

// 庆祝动效：全屏彩带飘落
function celebrate() {
  if (document.querySelector('.celebrate')) return;
  const ov = el(`<div class="celebrate"></div>`);
  const emojis = ['🎉', '✨', '💰', '🌟', '🎊', '🤑', '💪', '🔥'];
  for (let i = 0; i < 26; i++) {
    const p = el(`<span class="cf" style="left:${Math.floor(Math.random() * 96) + 1}%;animation-delay:${(Math.random() * 0.5).toFixed(2)}s;font-size:${14 + Math.floor(Math.random() * 22)}px">${emojis[Math.floor(Math.random() * emojis.length)]}</span>`);
    ov.appendChild(p);
  }
  document.body.appendChild(ov);
  toast('🎉 今日打卡全部完成！');
  setTimeout(() => ov.remove(), 2000);
}

// 详情页步骤完成标记：点步骤切换「做到第几步」
function toggleStepProgress(routeId, stepIndex) {
  const r = allRoutes().find(x => x.id === routeId);
  if (!r) return;
  const prog = state.progress[routeId] || 0;
  if (stepIndex < prog) {
    state.progress[routeId] = stepIndex; // 撤销到上一步
  } else {
    state.progress[routeId] = stepIndex + 1; // 标记到这一步
  }
  saveState();
  if (currentView === 'detail') openDetail(routeId, currentPreview);
  else render(currentView);
}

function delRecord(id) {
  state.records = state.records.filter(r => r.id !== id);
  saveState();
  render('records');
}

// 删除记账二次确认
function openDelRecordConfirm(id) {
  const rec = state.records.find(r => r.id === id);
  if (!rec) return;
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>删除这条记录？</h3>
        <p style="font-size:14px;color:var(--text);margin:4px 0 14px">${rec.type === 'in' ? '+' : '-'}¥${rec.amount} <span style="color:var(--text2)">· ${esc(rec.title)}</span></p>
        <p style="font-size:12px;color:var(--text3);margin:-8px 0 14px">删除后收入/支出统计会同步更新</p>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" style="background:var(--red);color:#fff" data-confirm-del>删除</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-confirm-del]').onclick = () => { close(); delRecord(id); };
}

// 导出记账 CSV（带 BOM 便于 Excel 打开中文不乱码）
function exportRecordsCsv() {
  if (!state.records.length) { toast('还没有可导出的记录'); return; }
  const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const lines = ['日期,类型,标题,金额(元),备注,路子ID'];
  [...state.records].sort((a, b) => a.date.localeCompare(b.date)).forEach(r => {
    lines.push([r.date, r.type === 'in' ? '收入' : '支出', r.title, r.amount, r.note || '', r.routeId || ''].map(esc).join(','));
  });
  const csv = '﻿' + lines.join('\n');
  copyText(csv).then(ok => toast(ok ? `已导出 ${state.records.length} 条记录到剪贴板 📋` : '导出失败，请重试'));
}

// 清空全部数据：二次确认弹窗
function openResetConfirm() {
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>⚠️ 清空全部数据</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px;line-height:1.8">将删除<b style="color:var(--red)">全部</b>签到、打卡、记账、收藏、目标等本地数据，且<b style="color:var(--red)">不可恢复</b>。<br>确定要清空吗？</p>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" style="background:var(--red);color:#fff" data-confirm-reset>确认清空</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-confirm-reset]').onclick = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('luzi_seen_onboard');
    localStorage.removeItem('luzi_notif_date');
    close();
    location.reload();
  };
}

// 备份数据到剪贴板（原始 JSON，可换机迁移）
async function backupData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { toast('还没有可备份的数据'); return; }
  const ok = await copyText(raw);
  toast(ok ? '已复制备份，去备忘录/微信存好 📤' : '备份失败，请重试');
}

// 从备份文本恢复
function openRestoreSheet() {
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>从备份恢复</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:12px;line-height:1.8">把备份的文本粘贴到下面，恢复会用备份覆盖当前数据。</p>
        <div class="sheet-field">
          <textarea id="restore-text" rows="5" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--text);font-size:12px;resize:vertical;font-family:monospace" placeholder='{"checkin":{...},"records":[...],"checks":{...}}'></textarea>
        </div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-restore-confirm>恢复</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('[data-close]').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-restore-confirm]').onclick = () => {
    const raw = mask.querySelector('#restore-text').value.trim();
    if (!raw) { toast('请先粘贴备份文本'); return; }
    let data;
    try { data = JSON.parse(raw); } catch (e) { toast('备份格式不正确'); return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { toast('备份内容无效'); return; }
    if (!('records' in data) && !('checkin' in data) && !('checks' in data)) { toast('这不是路子App的备份数据'); return; }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem('luzi_seen_onboard', '1');
    close();
    toast('恢复成功，正在刷新…');
    setTimeout(() => location.reload(), 600);
  };
}

// ============ 分享 / 复制 ============
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 部分 WebView 不支持 clipboard API，降级用 textarea 复制
    try {
      const ta = el(`<textarea style="position:fixed;opacity:0;left:-9999px"></textarea>`);
      ta.value = text;
      ta.readOnly = true;
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) { return false; }
  }
}

function shareText(r) {
  const cat = CATS[r.cat] || { name:'' };
  return `【路子】${r.title}\n` +
    `类别：${cat.name} | 难度：${'●'.repeat(r.diff)}${'○'.repeat(5-r.diff)}\n` +
    `启动资金：¥${r.capital} | 月收入潜力：¥${fmt(r.monthly[0])}-${fmt(r.monthly[1])}\n\n` +
    `为什么能赚：${r.why}\n\n` +
    `今天就做第一步：${r.firstStep}\n\n` +
    `—— 来自「路子」App，每天一个可落地的搞钱方法`;
}

async function shareRoute(id) {
  const r = allRoutes().find(x => x.id === id);
  if (!r) return;
  const text = shareText(r);
  // 优先用原生分享面板（Android WebView 支持 Web Share API）
  if (navigator.share) {
    try {
      await navigator.share({ title: `路子：${r.title}`, text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // 用户取消
      // 其他错误降级到复制
    }
  }
  const ok = await copyText(text);
  toast(ok ? '已复制分享文案，去粘贴给朋友吧 📋' : '复制失败，请手动复制');
}

async function copyFirstStep(id) {
  const r = allRoutes().find(x => x.id === id);
  if (!r) return;
  const ok = await copyText(`【${r.title}】今天就做第一步：${r.firstStep}`);
  toast(ok ? '首步已复制，今天就去执行 👣' : '复制失败');
}

async function copyChecklist(id) {
  const r = allRoutes().find(x => x.id === id);
  if (!r) return;
  const list = r.checklist.map((c, i) => `${i+1}. ${c}`).join('\n');
  const ok = await copyText(`【${r.title}】7 天打卡计划：\n${list}`);
  toast(ok ? '打卡清单已复制 📋' : '复制失败');
}

// Canvas 文本换行（中文逐字测量）
function wrapText(ctx, text, maxWidth, maxLines) {
  const chars = [...String(text)];
  let line = '', lines = [];
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line); line = ch;
      if (lines.length >= maxLines) break;
    } else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 生成路子分享图片卡片（Canvas → 长按保存）
function shareCard(id) {
  const r = allRoutes().find(x => x.id === id);
  if (!r) return;
  const cat = CATS[r.cat] || { name: '路子', color: '#f5b93c', bg: 'rgba(245,185,60,.15)' };
  const W = 1080, H = 1440;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // 背景
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0d0f16');
  g.addColorStop(0.5, '#141a2e');
  g.addColorStop(1, '#0d0f16');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 装饰点
  ctx.fillStyle = 'rgba(245,185,60,.3)';
  [[980, 130, 6], [130, 270, 9], [190, 100, 4], [900, 320, 5]].forEach(([x, y, rr]) => { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); });

  // 顶部 logo（纯文字，避免 emoji 渲染问题）
  ctx.fillStyle = '#f5b93c';
  ctx.font = 'bold 60px sans-serif';
  ctx.fillText('路子', 90, 140);
  ctx.font = '30px sans-serif';
  ctx.fillStyle = '#8b93a7';
  ctx.fillText('每天一个可落地的搞钱方法', 90, 192);
  // 金色小标
  ctx.fillStyle = '#f5b93c';
  ctx.fillRect(90, 216, 46, 6);

  // 类别标签
  ctx.fillStyle = cat.bg;
  roundRect(ctx, 90, 280, 240, 70, 35);
  ctx.fill();
  ctx.fillStyle = cat.color;
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(cat.name, 130, 328);

  // 标题
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  const titleLines = wrapText(ctx, r.title, W - 180, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, 90, 430 + i * 78));
  const titleH = titleLines.length * 78;
  // tag
  ctx.fillStyle = '#9aa3b8';
  ctx.font = '33px sans-serif';
  const tagLines = wrapText(ctx, r.tag, W - 180, 2);
  tagLines.forEach((line, i) => ctx.fillText(line, 90, 430 + titleH + 58 + i * 46));
  const tagH = tagLines.length * 46;

  // 元信息 chips
  const chips = [`难度 ${'●'.repeat(r.diff)}${'○'.repeat(5 - r.diff)}`, `启动 ¥${r.capital}`, `月收入 ¥${r.monthly[0]}-${r.monthly[1]}`];
  ctx.font = 'bold 28px sans-serif';
  let cx = 90;
  const chipsY = 430 + titleH + 58 + tagH + 52;
  chips.forEach(ch => {
    const tw = ctx.measureText(ch).width + 58;
    ctx.fillStyle = '#1a2130';
    roundRect(ctx, cx, chipsY, tw, 66, 33);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,185,60,.55)';
    ctx.lineWidth = 2;
    roundRect(ctx, cx, chipsY, tw, 66, 33);
    ctx.stroke();
    ctx.fillStyle = '#f5b93c';
    ctx.fillText(ch, cx + 29, chipsY + 42);
    cx += tw + 22;
  });

  // 分隔线
  const y1 = chipsY + 120;
  ctx.strokeStyle = 'rgba(255,255,255,.13)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(90, y1); ctx.lineTo(W - 90, y1); ctx.stroke();
  ctx.setLineDash([]);

  // 为什么能赚
  ctx.fillStyle = '#f5b93c';
  ctx.font = 'bold 35px sans-serif';
  ctx.fillText('为什么能赚', 90, y1 + 62);
  ctx.fillStyle = '#c6cddc';
  ctx.font = '31px sans-serif';
  let wy = y1 + 120;
  wrapText(ctx, r.why, W - 180, 6).forEach(line => { ctx.fillText(line, 90, wy); wy += 46; });

  // 今天就做第一步
  ctx.fillStyle = '#f5b93c';
  ctx.font = 'bold 35px sans-serif';
  ctx.fillText('今天就做第一步', 90, wy + 55);
  ctx.fillStyle = '#c6cddc';
  ctx.font = '31px sans-serif';
  let fy = wy + 115;
  wrapText(ctx, r.firstStep, W - 180, 5).forEach(line => { ctx.fillText(line, 90, fy); fy += 46; });

  // 底部
  ctx.strokeStyle = 'rgba(245,185,60,.35)';
  ctx.setLineDash([12, 10]);
  ctx.beginPath(); ctx.moveTo(90, H - 96); ctx.lineTo(W - 90, H - 96); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#8b93a7';
  ctx.font = '30px sans-serif';
  ctx.fillText('路子 · 每天一个可落地的搞钱方法', 90, H - 42);
  ctx.fillStyle = '#f5b93c';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('长按保存', W - 90, H - 42);
  ctx.textAlign = 'left';

  // 显示
  const dataUrl = cv.toDataURL('image/png');
  const mask = el(`
    <div class="modal-mask share-card-modal">
      <div class="share-card-wrap">
        <img src="${dataUrl}" alt="路子分享卡片" style="width:100%;border-radius:16px;display:block">
        <div class="sc-hint">👆 长按图片保存到相册，转发给需要的朋友</div>
        <div class="sheet-btns" style="margin-top:12px">
          <button class="btn-cancel" data-close>关闭</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
}

// 月度搞钱战绩分享图（Canvas，纯文字避免 emoji 渲染问题）
function shareEarnCard() {
  const ym = todayStr().slice(0, 7);
  const monthRecs = state.records.filter(r => r.date && r.date.startsWith(ym));
  const monthIn = monthRecs.filter(r => r.type === 'in').reduce((s, r) => s + r.amount, 0);
  const monthOut = monthRecs.filter(r => r.type === 'out').reduce((s, r) => s + r.amount, 0);
  const monthNet = monthIn - monthOut;
  const signDays = Object.keys(state.checkin).filter(d => d.startsWith(ym)).length;
  let doneItems = 0;
  Object.entries(state.checks).forEach(([k, day]) => {
    if (k.split('::')[1] && k.split('::')[1].startsWith(ym)) doneItems += Object.values(day).filter(Boolean).length;
  });
  const earnedRoutes = new Set(monthRecs.filter(r => r.type === 'in' && r.routeId).map(r => r.routeId)).size;
  const likedCount = Object.keys(state.liked).length;
  const goal = state.monthGoal || 1000;
  const goalPct = Math.min(100, Math.round(monthIn / goal * 100));

  const W = 1080, H = 1440;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // 背景
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0d0f16');
  g.addColorStop(0.5, '#141a2e');
  g.addColorStop(1, '#0d0f16');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(245,185,60,.3)';
  [[980, 130, 6], [130, 270, 9], [190, 100, 4], [900, 320, 5], [150, 1300, 5], [950, 1210, 4]].forEach(([x, y, rr]) => { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); });

  // 顶部 logo
  ctx.fillStyle = '#f5b93c';
  ctx.font = 'bold 60px sans-serif';
  ctx.fillText('路子', 90, 140);
  ctx.font = '30px sans-serif';
  ctx.fillStyle = '#8b93a7';
  ctx.fillText('每天一个可落地的搞钱方法', 90, 192);
  ctx.fillStyle = '#f5b93c';
  ctx.fillRect(90, 216, 46, 6);

  // 主标题
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 62px sans-serif';
  const tLines = wrapText(ctx, '这个月，我靠路子赚到了', W - 180, 2);
  tLines.forEach((line, i) => ctx.fillText(line, 90, 330 + i * 76));

  // 本月收入大数字
  ctx.fillStyle = '#f5b93c';
  ctx.font = 'bold 116px sans-serif';
  const big = `¥${fmt(monthIn)}`;
  const bigW = ctx.measureText(big).width;
  ctx.fillText(big, 90, 520);
  ctx.font = 'bold 34px sans-serif';
  ctx.fillStyle = '#8b93a7';
  ctx.fillText('本月收入', 90 + bigW + 26, 500);

  // 副信息 chips
  const chips = [`支出 ¥${fmt(monthOut)}`, `净赚 ¥${fmt(monthNet)}`, `签到 ${signDays} 天`];
  ctx.font = 'bold 28px sans-serif';
  let cx = 90;
  const chipsY = 590;
  chips.forEach(ch => {
    const tw = ctx.measureText(ch).width + 58;
    ctx.fillStyle = '#1a2130';
    roundRect(ctx, cx, chipsY, tw, 66, 33);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,185,60,.55)';
    ctx.lineWidth = 2;
    roundRect(ctx, cx, chipsY, tw, 66, 33);
    ctx.stroke();
    ctx.fillStyle = '#c6cddc';
    ctx.fillText(ch, cx + 29, chipsY + 42);
    cx += tw + 22;
  });

  // 分隔线
  const y1 = chipsY + 130;
  ctx.strokeStyle = 'rgba(255,255,255,.13)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(90, y1); ctx.lineTo(W - 90, y1); ctx.stroke();
  ctx.setLineDash([]);

  // 明细行
  const rows = [
    ['打卡完成', `${doneItems} 项`],
    ['赚到路子', `${earnedRoutes} 条`],
    ['收藏路子', `${likedCount} 条`],
  ];
  ctx.font = 'bold 34px sans-serif';
  let ry = y1 + 78;
  rows.forEach(([k, v]) => {
    ctx.fillStyle = '#8b93a7';
    ctx.fillText(k, 90, ry);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v, W - 90, ry);
    ctx.textAlign = 'left';
    ctx.font = 'bold 34px sans-serif';
    ry += 62;
  });

  // 目标进度
  const barY = ry + 20, barH = 40;
  ctx.fillStyle = '#8b93a7';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(`本月目标 ¥${fmt(goal)} · 完成 ${goalPct}%`, 90, barY);
  ctx.fillStyle = '#1a2130';
  roundRect(ctx, 90, barY + 22, W - 180, barH, 20);
  ctx.fill();
  if (goalPct > 0) {
    ctx.fillStyle = goalPct >= 100 ? '#2ecc71' : '#f5b93c';
    roundRect(ctx, 90, barY + 22, Math.max((W - 180) * goalPct / 100, barH), barH, 20);
    ctx.fill();
  }

  // 底部
  ctx.strokeStyle = 'rgba(245,185,60,.35)';
  ctx.setLineDash([12, 10]);
  ctx.beginPath(); ctx.moveTo(90, H - 96); ctx.lineTo(W - 90, H - 96); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#8b93a7';
  ctx.font = '30px sans-serif';
  ctx.fillText('路子 · 每天一个可落地的搞钱方法', 90, H - 42);
  ctx.fillStyle = '#f5b93c';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('长按保存', W - 90, H - 42);
  ctx.textAlign = 'left';

  const dataUrl = cv.toDataURL('image/png');
  const mask = el(`
    <div class="modal-mask share-card-modal">
      <div class="share-card-wrap">
        <img src="${dataUrl}" alt="月度战绩分享图" style="width:100%;border-radius:16px;display:block">
        <div class="sc-hint">👆 长按图片保存到相册，晒出你的战绩</div>
        <div class="sheet-btns" style="margin-top:12px">
          <button class="btn-cancel" data-close>关闭</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
}
// 本周战报分享图：复用月度战绩分享卡视觉，数据源换成本周（周一为一周起点）
function shareWeekCard() {
  const cur = weekStats(0), prev = weekStats(-1);
  const lo = cur.days[0].ds, hi = cur.days[6].ds;
  const weekIn = state.records.filter(r => r.date >= lo && r.date <= hi && r.type === 'in').reduce((s, r) => s + r.amount, 0);
  const weekOut = state.records.filter(r => r.date >= lo && r.date <= hi && r.type === 'out').reduce((s, r) => s + r.amount, 0);
  const weekNet = cur.income;
  const noteDays = Object.keys(state.reviewNotes || {}).filter(d => d >= lo && d <= hi).length;
  let doneItems = 0;
  Object.entries(state.checks).forEach(([k, day]) => {
    const ds = k.split('::')[1];
    if (ds && ds >= lo && ds <= hi) doneItems += Object.values(day).filter(Boolean).length;
  });
  const weekGoal = state.weekGoal || Math.round((state.monthGoal || 1000) / 4.35);
  const wgPct = weekGoal ? Math.min(100, Math.round(weekNet / weekGoal * 100)) : 0;
  const delta = prev.income ? Math.round((cur.income - prev.income) / prev.income * 100) : 0;
  const up = cur.income >= prev.income;

  const W = 1080, H = 1440;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0d0f16'); g.addColorStop(0.5, '#141a2e'); g.addColorStop(1, '#0d0f16');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(245,185,60,.3)';
  [[980, 130, 6], [130, 270, 9], [190, 100, 4], [900, 320, 5], [150, 1300, 5], [950, 1210, 4]].forEach(([x, y, rr]) => { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = '#f5b93c'; ctx.font = 'bold 60px sans-serif'; ctx.fillText('路子', 90, 140);
  ctx.font = '30px sans-serif'; ctx.fillStyle = '#8b93a7'; ctx.fillText('每天一个可落地的搞钱方法', 90, 192);
  ctx.fillStyle = '#f5b93c'; ctx.fillRect(90, 216, 46, 6);

  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 62px sans-serif';
  const tLines = wrapText(ctx, '这一周，我把路子走成了', W - 180, 2);
  tLines.forEach((line, i) => ctx.fillText(line, 90, 330 + i * 76));

  ctx.fillStyle = '#f5b93c'; ctx.font = 'bold 116px sans-serif';
  const big = `¥${fmt(weekNet)}`; const bigW = ctx.measureText(big).width;
  ctx.fillText(big, 90, 520);
  ctx.font = 'bold 34px sans-serif'; ctx.fillStyle = '#8b93a7';
  ctx.fillText(weekNet >= 0 ? '本周净赚' : '本周净亏', 90 + bigW + 26, 500);

  const chips = [`支出 ¥${fmt(weekOut)}`, `签到 ${cur.checkinDays} 天`, `执行 ${cur.execDays} 天`];
  ctx.font = 'bold 28px sans-serif'; let cx = 90; const chipsY = 590;
  chips.forEach(ch => {
    const tw = ctx.measureText(ch).width + 58;
    ctx.fillStyle = '#1a2130'; roundRect(ctx, cx, chipsY, tw, 66, 33); ctx.fill();
    ctx.strokeStyle = 'rgba(245,185,60,.55)'; ctx.lineWidth = 2; roundRect(ctx, cx, chipsY, tw, 66, 33); ctx.stroke();
    ctx.fillStyle = '#c6cddc'; ctx.fillText(ch, cx + 29, chipsY + 42);
    cx += tw + 22;
  });

  const y1 = chipsY + 130;
  ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(90, y1); ctx.lineTo(W - 90, y1); ctx.stroke(); ctx.setLineDash([]);

  const rows = [['执行复盘', `${cur.execDays} 天`], ['写下心得', `${noteDays} 天`], ['打卡完成', `${doneItems} 项`]];
  ctx.font = 'bold 34px sans-serif'; let ry = y1 + 78;
  rows.forEach(([k, v]) => {
    ctx.fillStyle = '#8b93a7'; ctx.fillText(k, 90, ry);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(v, W - 90, ry); ctx.textAlign = 'left'; ctx.font = 'bold 34px sans-serif';
    ry += 62;
  });

  const barY = ry + 20, barH = 40;
  ctx.fillStyle = '#8b93a7'; ctx.font = 'bold 32px sans-serif';
  ctx.fillText(`本周目标 ¥${fmt(weekGoal)} · 完成 ${wgPct}% · ${up ? '↗' : '↘'}${Math.abs(delta)}% vs 上周`, 90, barY);
  ctx.fillStyle = '#1a2130'; roundRect(ctx, 90, barY + 22, W - 180, barH, 20); ctx.fill();
  if (wgPct > 0) {
    ctx.fillStyle = wgPct >= 100 ? '#2ecc71' : '#f5b93c';
    roundRect(ctx, 90, barY + 22, Math.max((W - 180) * wgPct / 100, barH), barH, 20); ctx.fill();
  }

  ctx.strokeStyle = 'rgba(245,185,60,.35)'; ctx.setLineDash([12, 10]);
  ctx.beginPath(); ctx.moveTo(90, H - 96); ctx.lineTo(W - 90, H - 96); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#8b93a7'; ctx.font = '30px sans-serif'; ctx.fillText('路子 · 每天一个可落地的搞钱方法', 90, H - 42);
  ctx.fillStyle = '#f5b93c'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('长按保存', W - 90, H - 42); ctx.textAlign = 'left';

  const dataUrl = cv.toDataURL('image/png');
  const mask = el(`
    <div class="modal-mask share-card-modal">
      <div class="share-card-wrap">
        <img src="${dataUrl}" alt="本周战绩分享图" style="width:100%;border-radius:16px;display:block">
        <div class="sc-hint">👆 长按图片保存到相册，晒出你的战绩</div>
        <div class="sheet-btns" style="margin-top:12px"><button class="btn-cancel" data-close>关闭</button></div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
}
function nextGuide() {
  if (state.guideStage < GUIDE.length - 1) {
    state.guideStage++;
    saveState();
    render('guide');
  } else {
    if (!state.guideRewarded) {
      state.guideRewarded = true;
      addCoins(50, '学完新手教程');
      toast('🎓 新手教程学完啦 +50 金币');
    }
    render('track');
  }
}

// ============ 记账弹层 ============
function openMoneySheet(routeId, editId) {
  const r = routeId ? allRoutes().find(x => x.id === routeId) : null;
  const routes = allRoutes();
  const edit = editId ? state.records.find(x => x.id === editId) : null;
  const type = edit ? edit.type : 'in';
  const selRouteId = edit ? edit.routeId : (r ? r.id : '');
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>${edit ? '编辑记账' : '记一笔'}</h3>
        <div class="sheet-field">
          <label class="sf-label">类型</label>
          <div class="mtype-row">
            <button class="mtype ${type==='in'?'on':''}" data-mtype="in">💸 收入</button>
            <button class="mtype ${type==='out'?'on':''}" data-mtype="out">🛒 支出</button>
          </div>
        </div>
        <div class="sheet-field">
          <label class="sf-label">来源路子</label>
          <select id="money-route">
            <option value="">（手动填写）</option>
            ${routes.map(x => `<option value="${x.id}" ${selRouteId===x.id?'selected':''}>${esc(x.title)}</option>`).join('')}
          </select>
        </div>
        <div class="sheet-field">
          <label class="sf-label">金额（元）</label>
          <input id="money-amount" type="number" inputmode="decimal" placeholder="如 50" value="${edit?edit.amount:''}">
          <div class="money-quick">
            <button type="button" class="mq-chip" data-quick-amt="50">¥50</button>
            <button type="button" class="mq-chip" data-quick-amt="100">¥100</button>
            <button type="button" class="mq-chip" data-quick-amt="200">¥200</button>
            <button type="button" class="mq-chip" data-quick-amt="500">¥500</button>
          </div>
        </div>
        <div class="sheet-field">
          <label class="sf-label">备注</label>
          <input id="money-note" type="text" placeholder="如：第一单 PPT 代做" value="${esc(edit?edit.note||'':'')}">
        </div>
        <div class="sheet-field">
          <label class="sf-label">日期</label>
          <input id="money-date" type="date" value="${edit ? edit.date : todayStr()}">
        </div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-save>${edit ? '保存修改' : '保存'}</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);

  mask.querySelectorAll('[data-mtype]').forEach(b => {
    b.onclick = () => {
      mask.querySelectorAll('[data-mtype]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    };
  });
  mask.querySelectorAll('[data-quick-amt]').forEach(c => {
    c.onclick = () => {
      const amt = mask.querySelector('#money-amount');
      amt.value = c.dataset.quickAmt;
      mask.querySelectorAll('.mq-chip').forEach(x => x.classList.toggle('on', x === c));
      amt.focus();
    };
  });
  const close = () => mask.remove();
  mask.querySelector('[data-close]').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-save]').onclick = () => {
    const sel = mask.querySelector('#money-route');
    const amount = parseFloat(mask.querySelector('#money-amount').value);
    const note = mask.querySelector('#money-note').value.trim();
    const date = mask.querySelector('#money-date').value || todayStr();
    const t = (mask.querySelector('[data-mtype].on')?.dataset.mtype) || 'in';
    if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
    const route = sel.value ? allRoutes().find(x => x.id === sel.value) : null;
    if (edit) {
      const rec = state.records.find(x => x.id === edit.id);
      if (rec) {
        rec.routeId = route ? route.id : '';
        rec.title = route ? route.title : (note || '其他');
        rec.amount = amount;
        rec.type = t;
        rec.note = note || (route ? '副业收入' : '');
        rec.date = date;
      }
    } else {
      state.records.unshift({
        id: Date.now() + Math.random().toString(16).slice(2),
        routeId: route ? route.id : '',
        title: route ? route.title : (note || '其他收入'),
        amount,
        type: t,
        note: note || (route ? '副业收入' : ''),
        date,
      });
    }
    saveState();
    close();
    notifyNewAchievements();
    checkTasks();
    checkEarnMilestone();
    checkTodayStepsReward();
    toast(edit ? '已保存修改 ✓' : `记了一笔 ${t==='out'?'-':'+'}¥${amount} ${t==='out'?'🛒':'🎉'}`);
    if (currentView === 'records' || currentView === 'mine') render(currentView);
    else if (currentView === 'detail' && currentDetailId) openDetail(currentDetailId, currentPreview);
    else if (currentView === 'home') render('home');
  };
}

// ============ 路子对比工具 ============
function cmpIcon(r, cls) {
  return `<div class="${cls}" style="background:${(CATS[r.cat]||{}).bg||'rgba(245,185,60,.15)'}">${(CATS[r.cat]||{}).icon||'💰'}</div>`;
}
function cmpCol(r) {
  return `<div class="cmp-col">
    ${cmpIcon(r, 'cmp-cico')}
    <div class="cmp-ctitle">${esc(r.title)}</div>
    <div class="cmp-ctag">${esc(r.tag)}</div>
  </div>`;
}
function cmpRow(label, va, vb, win) {
  return `<div class="cmp-trow">
    <div class="cmp-tk">${label}</div>
    <div class="cmp-tc ${win===1?'win':''}">${va}</div>
    <div class="cmp-tc ${win===2?'win':''}">${vb}</div>
  </div>`;
}
function cmpTableHTML(a, b) {
  const catN = (id) => (CATS[id]||{}).name || id;
  const stars = (n) => '●'.repeat(n) + '○'.repeat(5 - n);
  // 小者优
  const loW = (pa, pb) => pa < pb ? 1 : (pb < pa ? 2 : 0);
  // 大者优
  const hiW = (pa, pb) => pa > pb ? 1 : (pb > pa ? 2 : 0);
  const whyT = (s) => esc((s||'').length > 34 ? s.slice(0, 34) + '…' : s);
  return `
    <div class="cmp-tbl">
      <div class="cmp-trow head">
        <div class="cmp-tk"></div>
        <div class="cmp-tc">${cmpCol(a)}</div>
        <div class="cmp-tc">${cmpCol(b)}</div>
      </div>
      ${cmpRow('分类', catN(a.cat), catN(b.cat))}
      ${cmpRow('上手难度', stars(a.diff), stars(b.diff), loW(a.diff, b.diff))}
      ${cmpRow('启动资金', '¥'+fmt(a.capital), '¥'+fmt(b.capital), loW(a.capital, b.capital))}
      ${cmpRow('回本周期', a.cycle+' 天', b.cycle+' 天', loW(a.cycle, b.cycle))}
      ${cmpRow('月收入潜力', '¥'+fmt(a.monthly[1])+'/月', '¥'+fmt(b.monthly[1])+'/月', hiW(a.monthly[1], b.monthly[1]))}
      ${cmpRow('为什么能赚', whyT(a.why), whyT(b.why))}
    </div>
    <div class="cmp-tip">金色 = 这条路子在对应维度更省事 / 更快回本 / 赚得更多</div>`;
}
function openCompareSheet(routeId) {
  const cur = allRoutes().find(x => x.id === routeId);
  if (!cur) return;
  const seen = new Set();
  const collect = (rid) => { if (rid && rid !== 'undefined' && rid !== cur.id) seen.add(rid); };
  Object.keys(state.liked || {}).forEach(collect);
  Object.keys(state.checks || {}).forEach(k => collect(k.split('::')[0]));
  (state.records || []).forEach(r => collect(r.routeId));
  const cands = allRoutes().filter(r => seen.has(r.id)).slice(0, 12);
  const mask = el(`<div class="modal-mask"><div class="modal-sheet compare-sheet"></div></div>`);
  document.body.appendChild(mask);
  const sheet = mask.querySelector('.modal-sheet');
  const close = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) close(); };
  let sel = null;
  const cmpHeader = () => `
    <div class="sheet-close" data-close>✕</div>
    <h3>⚖️ 路子对比</h3>
    <div class="cmp-cur">${cmpIcon(cur, 'cmp-cico')}<div class="cmp-ctitle">${esc(cur.title)}</div><div class="cmp-ctag">当前路子 · ${esc(cur.tag)}</div></div>`;
  const pickList = () => cands.length
    ? cands.map(r => `
      <div class="cmp-pick ${sel===r.id?'on':''}" data-cmp-pick="${r.id}">
        ${cmpIcon(r, 'cmp-pico')}
        <div class="cmp-pmain">
          <div class="cmp-ptitle">${esc(r.title)}</div>
          <div class="cmp-ptag">难度 ${'●'.repeat(r.diff)}${'○'.repeat(5-r.diff)} · 启动 ¥${fmt(r.capital)} · 月入 ¥${fmt(r.monthly[1])}</div>
        </div>
        <div class="cmp-pcheck">${sel===r.id?'✓':''}</div>
      </div>`).join('')
    : `<div class="cmp-empty">还没有可对比的路子。<br>先收藏或打卡几条路子，再来比 📌</div>`;
  const renderPick = () => {
    sheet.innerHTML = cmpHeader() + `
      <div class="cmp-hint">${cands.length ? '再选一条来比 · 点下面已收藏 / 打卡 / 记过账的路子' : '收藏或打卡的路子会出现在这里'}</div>
      <div class="cmp-list" data-cmp-list>${pickList()}</div>
      <div class="cmp-foot ${sel?'show':''}"><button class="btn-ok" data-cmp-start>开始对比 ▸</button></div>`;
    bindCmp();
  };
  const bindCmp = () => {
    sheet.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    const list = sheet.querySelector('[data-cmp-list]');
    if (list) list.onclick = (e) => {
      const p = e.target.closest('[data-cmp-pick]');
      if (!p) return;
      sel = (sel === p.dataset.cmpPick) ? null : p.dataset.cmpPick;
      renderPick();
    };
    const st = sheet.querySelector('[data-cmp-start]');
    if (st) st.onclick = () => {
      const b = allRoutes().find(x => x.id === sel);
      if (!b) return;
      sheet.innerHTML = cmpHeader() + cmpTableHTML(cur, b) +
        `<div class="cmp-foot"><button class="btn-ok ghost" data-cmp-back>↺ 换一条</button></div>`;
      sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = close);
      sheet.querySelector('[data-cmp-back]').onclick = renderPick;
    };
  };
  renderPick();
}

// ============ 远程更新源设置 ============
function openRemoteSheet() {
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>内容更新源</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:12px">提供一个 JSON 接口地址，app 会每天自动拉取新的「路子」合并进本地。格式：<code style="background:var(--card);padding:2px 6px;border-radius:4px">{"routes":[{...}]}</code></p>
        <div class="sheet-field">
          <label class="sf-label">远程 JSON 地址</label>
          <input id="remote-url" type="url" placeholder="https://example.com/routes.json" value="${esc(state.remoteUrl)}">
        </div>
        <div class="sheet-field" style="font-size:12px;color:var(--text3)">
          ${state.remoteUpdatedAt ? `上次更新：${new Date(state.remoteUpdatedAt).toLocaleString()}` : '尚未配置远程源，使用内置内容库'}
        </div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-save>保存</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('[data-close]').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-save]').onclick = async () => {
    const url = mask.querySelector('#remote-url').value.trim();
    state.remoteUrl = url;
    saveState();
    close();
    toast(url ? '已保存，正在尝试拉取…' : '已清除远程源');
    if (url) {
      remoteLoaded = false;
      remoteRoutes = [];
      await loadRemoteRoutes();
      toast(remoteRoutes.length ? `拉取成功，新增 ${remoteRoutes.length} 条路子 ✅` : '拉取失败，暂用内置内容');
      render(currentView);
    } else {
      remoteRoutes = [];
      render(currentView);
    }
  };
}

// ============ 通知时间自定义 ============
function fmtHM(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return `${isNaN(h) ? 8 : h}:${String(isNaN(m) ? 30 : m).padStart(2, '0')}`;
}
function openNotifSheet() {
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet">
        <div class="sheet-close" data-close>✕</div>
        <h3>🔔 通知时间</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">每天收到 2 条提醒，按你的作息调个舒服的时间</p>
        <div class="sheet-field">
          <label class="sf-label">🌅 晨间 · 今日路子提醒</label>
          <input id="notif-morning" type="time" value="${state.notifMorning || '08:30'}">
        </div>
        <div class="sheet-field">
          <label class="sf-label">🌙 晚间 · 打卡提醒</label>
          <input id="notif-evening" type="time" value="${state.notifEvening || '20:30'}">
        </div>
        <div style="font-size:12px;color:var(--text3);margin:2px 0 14px">保存后立刻按新时间重新排期</div>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-save>保存</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-save]').onclick = async () => {
    const mo = mask.querySelector('#notif-morning').value || '08:30';
    const ev = mask.querySelector('#notif-evening').value || '20:30';
    state.notifMorning = mo;
    state.notifEvening = ev;
    saveState();
    localStorage.removeItem('luzi_notif_date'); // 强制取消旧排期并按新时间重排
    close();
    toast(`通知时间已更新：${fmtHM(mo)} 提醒今日路子 · ${fmtHM(ev)} 提醒打卡`);
    if (currentView === 'mine') render('mine');
    if (Capacitor.isNativePlatform()) setupDailyNotification();
  };
}

function renderAbout() {
  const today = todayStr();
  const totalIn = state.records.filter(r => r.type === 'in').reduce((s,r) => s+r.amount, 0);
  return `
    <div class="page-head">
      <div class="back" data-back style="display:inline-flex;align-items:center;gap:6px;color:var(--text2);font-size:13px;margin-bottom:8px;cursor:pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px"><path d="M15 18l-6-6 6-6"/></svg>返回</div>
      <div><div class="page-title">关于<strong class="gold">路子</strong></div></div>
    </div>
    <div class="card" style="text-align:center;padding:24px">
      <div style="font-size:44px">🛣️</div>
      <div style="font-size:20px;font-weight:800;margin-top:8px">路子</div>
      <div style="font-size:13px;color:var(--text2);margin-top:4px">每天一个可落地的搞钱方法</div>
      <div style="margin-top:16px;font-size:13px;color:var(--text2);line-height:2">
        内置 ${allRoutes().length} 条实战路子 · 已坚持 ${Object.keys(state.checkin).length} 天<br>
        累计记账 ¥${fmt(totalIn)}<br>
        版本 v${APP_VERSION}
      </div>
      <div style="margin-top:16px;font-size:11px;color:var(--text3)">内容为公开方法论整理，仅供参考。<br>投资有风险，实操需谨慎，不构成投资建议。</div>
    </div>
    <div class="mine-list">
      <div class="mine-item" data-backup><div class="mi-ico" style="background:rgba(46,204,113,.15)">📤</div><div class="mi-name">备份数据到剪贴板</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-restore><div class="mi-ico" style="background:rgba(245,185,60,.15)">📥</div><div class="mi-name">从备份恢复数据</div><div class="mi-arrow">›</div></div>
      <div class="mine-item" data-reset><div class="mi-ico" style="background:rgba(255,91,106,.15)">🗑️</div><div class="mi-name">清空全部本地数据</div><div class="mi-arrow">›</div></div>
    </div>
  `;
}

// ============ 避坑指南 v4.39.0 ============
const GUARD_TRAPS = [
  { icon:'🚨', name:'刷单 / 垫资返利', desc:'让你先垫钱再返利：前几单小金额给甜头，等你垫大额就直接拉黑。凡是「垫资」「刷流水」的兼职，都是诈骗。' },
  { icon:'🚨', name:'先交钱 / 加盟费 / 代理费', desc:'还没赚钱先让你掏钱「买资格」「开代理」的，99% 是割韭菜。正规路子从不靠收门槛费赚钱。' },
  { icon:'🚨', name:'手工活外发 · 交押金', desc:'让你交押金领材料，完工后以「不合格」为由拒收扣钱，押金和工费都拿不回。' },
  { icon:'🚨', name:'「躺赚」「日入千元」', desc:'任何违反常识的高回报承诺都是陷阱。天上不会掉馅饼，只会掉套路。' },
  { icon:'🚨', name:'拉人头返利（传销）', desc:'收益主要靠发展下线而不是产品本身，越做越像「游戏」，最后人财两空还可能违法。' },
  { icon:'🚨', name:'冒充客服 / 「注销贷款」', desc:'自称客服要你转账、注销账户、验资的，直接挂断，回拨官方电话核实。' },
  { icon:'🚨', name:'虚拟货币 / 外汇「老师带单」', desc:'高杠杆加「带单老师」= 杀猪盘。先让你小赚，再让你重仓，最后爆仓失联。' },
  { icon:'🚨', name:'套现 / 跑分 / 走账', desc:'帮你走账收佣金涉嫌「帮信罪」，轻则封卡，重则坐牢，一分钱都不能碰。' },
];
const GUARD_RULES = [
  { t:'先交钱再赚钱的路子，一律先怀疑', d:'要押金、保证金、培训费、工本费的，先想想：真有这好事凭什么轮到你？' },
  { t:'零风险 + 高收益 = 陷阱', d:'收益高、风险又低还不用付出，三样全占只存在于骗子的话术里。' },
  { t:'留好凭证，能维权', d:'聊天记录、转账记录、对方账号全部保存好。出了事，证据就是你的武器。' },
];
const GUARD_HELP = [
  '立刻止损，绝不再转一分钱',
  '保存全部证据：聊天记录、转账凭证、对方账号',
  '拨打反诈专线 96110，或直接打 110 报警',
  '下载「国家反诈中心」App 开启防护',
];
function renderGuard() {
  const read = !!state.guardRead;
  const rules = GUARD_RULES.map(r => `
    <div class="gr-rule">
      <div class="gr-t"><span class="gr-dot">●</span>${r.t}</div>
      <div class="gr-d">${r.d}</div>
    </div>`).join('');
  const traps = GUARD_TRAPS.map(t => `
    <div class="gt-row">
      <div class="gt-ico">${t.icon}</div>
      <div class="gt-main"><div class="gt-name">${t.name}</div><div class="gt-desc">${t.desc}</div></div>
    </div>`).join('');
  const help = GUARD_HELP.map((h, i) => `
    <div class="gh-row"><span class="gh-n">${i + 1}</span><span>${h}</span></div>`).join('');
  return `
    <div class="page-head">
      <div class="back" data-back style="display:inline-flex;align-items:center;gap:6px;color:var(--text2);font-size:13px;margin-bottom:8px;cursor:pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px"><path d="M15 18l-6-6 6-6"/></svg>返回</div>
      <div><div class="page-title">避坑<strong class="red">指南</strong></div></div>
    </div>
    <div class="guard-banner">
      <div class="gb-ico">🛡️</div>
      <div class="gb-main"><div class="gb-t">先学会躲坑，再开始搞钱</div><div class="gb-d">网上赚钱路子鱼龙混杂，这条指南帮你守住本金</div></div>
    </div>
    <div class="guard-card gr-rules">
      <div class="gc-head">🛡️ 三条黄金守则</div>
      ${rules}
    </div>
    <div class="guard-card gr-traps">
      <div class="gc-head">🚨 八种常见套路 · 见到就跑</div>
      ${traps}
    </div>
    <div class="guard-card gr-help">
      <div class="gc-head">🆘 万一被骗了，这样做</div>
      ${help}
    </div>
    <div class="guard-card gr-done">
      ${read
        ? '<div class="gr-read-done">✅ 已读完，谨记在心 · 守住本金就是赚</div>'
        : `<button class="guard-read-btn" data-guard-read>📖 读完全册，领取 +30 🪙</button>
           <div class="gr-read-tip">认真读一遍，别让骗子抢走你的第一桶金</div>`}
    </div>
  `;
}
function guardReadReward() {
  if (state.guardRead) { toast('你已经领过奖励啦'); return; }
  state.guardRead = true;
  saveState();
  addCoins(30, '读完避坑指南');
  if (currentView === 'guard') render('guard');
}

// ============ 签到 ============
const MAKEUP_COST = 100; // 补签昨天消耗的金币
function doCheckin() {
  const today = todayStr();
  if (state.checkin[today]) { toast('今天已经签到过啦'); return; }
  state.checkin[today] = 1;
  refreshTodaySteps();
  // 连续签到
  if (state.lastCheckin) {
    const last = new Date(state.lastCheckin);
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    if (last.toDateString() === yest.toDateString()) state.streak++;
    else state.streak = 1;
  } else {
    state.streak = 1;
  }
  state.lastCheckin = today;
  const coins = 10 + Math.min(state.streak * 5, 50);
  addCoins(coins, `签到 · 连续${state.streak}天`);
  // 连续签到里程碑奖励（每个里程碑只发一次）
  const bonus = STREAK_REWARDS[state.streak];
  if (bonus && !(state.streakRewards || []).includes(state.streak)) {
    state.streakRewards = state.streakRewards || [];
    state.streakRewards.push(state.streak);
    addCoins(bonus, `连续签到 ${state.streak} 天里程碑`);
    setTimeout(() => showSignCel(state.streak, bonus), 500);
  }
  notifyNewAchievements();
  checkTasks();
  toast(`签到成功 +${coins} 金币 🪙`);

  const gotBonus = bonus && (state.streakRewards || []).includes(state.streak);
  const nextMs = Object.keys(STREAK_REWARDS).map(Number).filter(k => k > state.streak).sort((a, b) => a - b)[0];
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet" style="border-radius:22px;max-width:400px;text-align:center">
        <div class="checkin-wrap">
          <div class="ci-title">打卡成功！</div>
          <div class="ci-sub">第 ${state.streak} 天连续签到</div>
          <div class="checkin-coins"><div class="cn-num">+${coins}</div><div class="cn-lb">金币</div></div>
          <div class="checkin-streak">连续签到 <b>${state.streak}</b> 天</div>
          ${gotBonus ? `<div class="checkin-bonus">🔥 里程碑奖励 <b>+${bonus}</b> 金币</div>` : ''}
          ${nextMs ? `<div class="checkin-next">下一里程碑：连续 ${nextMs} 天 → 奖励 ${STREAK_REWARDS[nextMs]} 金币</div>` : ''}
          ${renderMakeupBlock()}
          <button class="checkin-btn" data-close>收下奖励</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  const mu = mask.querySelector('[data-makeup]');
  if (mu) mu.addEventListener('click', () => {
    if (doMakeup()) {
      const ciSub = mask.querySelector('.ci-sub'); if (ciSub) ciSub.textContent = `第 ${state.streak} 天连续签到`;
      const cs = mask.querySelector('.checkin-streak b'); if (cs) cs.textContent = state.streak;
      const mb = mask.querySelector('.makeup-block'); if (mb) mb.remove();
      const lbl = document.querySelector('.stat-box[data-checkin] .label'); if (lbl) lbl.textContent = `已签 ${state.streak} 天`;
    }
  });
}

// 昨天漏签的补签块（签到成功弹窗内）
function renderMakeupBlock() {
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yestStr = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;
  // 有历史签到（非第一天用）且昨天漏签 才显示补签
  if (Object.keys(state.checkin).length <= 1 || state.checkin[yestStr]) return '';
  const can = state.coins >= MAKEUP_COST;
  return `
      <div class="makeup-block">
        <div class="mu-title">昨天漏签了？</div>
        <div class="mu-desc">花 ${MAKEUP_COST} 金币补回昨天的签到，连续签到不中断</div>
        <button class="makeup-btn ${can ? '' : 'disabled'}" data-makeup ${can ? '' : 'disabled'}>🔁 补签昨天 · -${MAKEUP_COST} 金币</button>
      </div>`;
}

// 补签昨天：扣金币、补写 checkin、重算连续签到
function doMakeup() {
  const dsOf = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yestStr = dsOf(yest);
  if (state.checkin[yestStr]) { toast('昨天已经签到过啦'); return false; }
  if (state.coins < MAKEUP_COST) { toast(`金币不足，补签需要 ${MAKEUP_COST} 个，还差 ${MAKEUP_COST - state.coins} 🪙`); return false; }
  state.coins -= MAKEUP_COST;
  state.checkin[yestStr] = 1;
  state.makeupDays[yestStr] = 1;
  // 从今天（若今天未签则从昨天）起往前数连续签到日
  const start = new Date();
  if (!state.checkin[dsOf(start)]) start.setDate(start.getDate() - 1);
  let s = 0; const cur = new Date(start);
  while (state.checkin[dsOf(cur)]) { s++; cur.setDate(cur.getDate() - 1); }
  state.streak = s;
  logCoin(-MAKEUP_COST, '补签昨天');
  saveState();
  notifyNewAchievements();
  checkTasks();
  toast(`补签成功！连续签到 ${state.streak} 天 🔥`);
  return true;
}

// 首页补签横幅（常驻入口）
function renderMakeupStrip() {
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yestStr = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;
  if (state.checkin[yestStr] || Object.keys(state.checkin).length === 0) return '';
  return `<div class="makeup-strip" data-makeup>
    <span class="ms-ico">🔁</span>
    <span class="ms-txt">昨天漏签了？<b>花 ${MAKEUP_COST} 金币补回</b>，连续签到不中断</span>
    <span class="ms-arrow">›</span>
  </div>`;
}

// 补签确认弹窗（横幅点击）
function openMakeupConfirm() {
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yestStr = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;
  if (state.checkin[yestStr]) { toast('昨天已经签到过啦'); return; }
  if (state.coins < MAKEUP_COST) { toast(`金币不足，补签需要 ${MAKEUP_COST} 个，还差 ${MAKEUP_COST - state.coins} 🪙`); return; }
  const mask = el(`
    <div class="modal-mask">
      <div class="modal-sheet" style="border-radius:22px;max-width:400px;text-align:center">
        <div class="sheet-close" data-close>✕</div>
        <div style="font-size:38px;margin:6px 0 8px">🔁</div>
        <h3>补签昨天</h3>
        <p style="font-size:13px;color:var(--text2);line-height:1.8;margin:10px 0 18px">花 <b style="color:var(--gold)">${MAKEUP_COST} 金币</b> 补回昨天的签到，<br>恢复连续签到，当前连续 <b style="color:var(--green)">${state.streak}</b> 天</p>
        <div class="sheet-btns">
          <button class="btn-cancel" data-close>取消</button>
          <button class="btn-ok" data-confirm-makeup>确认补签</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector('[data-confirm-makeup]').onclick = () => {
    if (doMakeup()) { close(); if (currentView === 'home') render('home'); }
  };
}

// ============ Toast ============
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ============ 每日提醒通知 ============
// 只在原生环境启用；浏览器开发模式静默跳过
async function setupDailyNotification() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;
    const today = todayStr();
    // 当天已排期过就不再重复，避免每次启动都重排
    if (localStorage.getItem('luzi_notif_date') === today) return;
    // 取消旧通知（id 1=晨间路子，2=晚间打卡提醒），重排带当日路子标题的新通知
    await LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(() => {});
    const tr = routeForDate(today);
    if (!tr) return;
    // 用户自定义提醒时间（默认 8:30 晨间路子 / 20:30 晚间打卡）
    const parseHM = (t) => { const [h, m] = String(t || '').split(':').map(Number); return { hour: isNaN(h) ? 8 : h, minute: isNaN(m) ? 30 : m }; };
    const mo = parseHM(state.notifMorning), ev = parseHM(state.notifEvening);
    await LocalNotifications.schedule({
      notifications: [
        {
          title: `路子 · 今日路子：${tr.title}`,
          body: `${tr.tag} · 月入 ¥${tr.monthly[0]}-${tr.monthly[1]}，点开看完整步骤 👀`,
          id: 1,
          schedule: { on: { hour: mo.hour, minute: mo.minute }, repeats: true },
        },
        {
          title: '路子 · 打卡提醒',
          body: `今天「${tr.title}」还没动起来吗？回来把第一步做了，离目标更近一步 💪`,
          id: 2,
          schedule: { on: { hour: ev.hour, minute: ev.minute }, repeats: true },
        },
      ],
    });
    localStorage.setItem('luzi_notif_date', today);
  } catch (e) { /* 通知失败不影响使用 */ }
}

// 通知状态诊断钩子（生产无害，供 CDP 验证排期情况）
window.__luziNotif = () => LocalNotifications.pending()
  .then(p => p.notifications.map(n => ({ id: n.id, title: n.title, h: n.schedule && n.schedule.on && n.schedule.on.hour, m: n.schedule && n.schedule.on && n.schedule.on.minute })))
  .catch(e => ({ __err: String(e) }));

// ============ 首次启动引导 ============
function maybeShowOnboard() {
  if (localStorage.getItem('luzi_seen_onboard')) return;
  const steps = [
    { icon: '🗓️', title: '每天一条新路子', desc: '每天自动为你挑一条能落地的搞钱方法，照着做就行' },
    { icon: '🧭', title: '4 步手把手教程', desc: '心态 → 选择 → 行动 → 坚持，小白也能一步步上手' },
    { icon: '✅', title: '打卡 + 记账', desc: '把路子拆成每日小任务，赚到的每一分都记下来' },
  ];
  let idx = 0;
  const wrap = document.createElement('div');
  wrap.className = 'onboard';
  const render = () => {
    const s = steps[idx];
    wrap.innerHTML = `
      <div class="ob-card">
        <div class="ob-ico">${s.icon}</div>
        <div class="ob-title">${s.title}</div>
        <div class="ob-desc">${s.desc}</div>
        <div class="ob-dots">${steps.map((_, i) => `<div class="ob-dot ${i === idx ? 'on' : ''}"></div>`).join('')}</div>
        <button class="ob-btn">${idx === steps.length - 1 ? '开始搞钱 💪' : '下一步'}</button>
        <div class="ob-skip">${idx === steps.length - 1 ? '' : '跳过'}</div>
      </div>`;
  };
  render();
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-skip]') || e.target.closest('.ob-skip')) {
      localStorage.setItem('luzi_seen_onboard', '1'); wrap.remove(); return;
    }
    if (e.target.closest('.ob-btn')) {
      if (idx < steps.length - 1) { idx++; render(); }
      else { localStorage.setItem('luzi_seen_onboard', '1'); wrap.remove(); }
    }
  });
  document.body.appendChild(wrap);
}

// ============ 初始化 ============
function navigateHash() {
  const h = location.hash.replace('#', '');
  if (h === 'records') render('records');
  else if (h === 'likes') render('likes');
  else if (h === 'about') render('about');
  else if (h.startsWith('route/')) {
    const id = h.slice(6);
    openDetail(id);
  } else if (h) render(h);
  else render('home');
}

window.addEventListener('load', () => {
  // 首次加载自动发放已达成的新手任务奖励（t1 恒可领）
  checkTasks();
  // 带 hash 直达时，hashchange 可能在模块加载前已触发，这里统一走一遍
  navigateHash();
  setupDailyNotification();
  maybeShowOnboard();
  loadRemoteRoutes().then(() => {
    // 如果拉到了新内容且首页还在，刷新
    if (remoteRoutes.length && currentView === 'home') render('home');
  });
});

// 每日一条新路子：检查今天是否看过，本地通知用 toast 提示
// 首次进入时如果今天是新日期且有新内容，提示
(function() {
  const today = todayStr();
  const seenKey = 'luzi_seen_' + today;
  if (!localStorage.getItem(seenKey)) {
    localStorage.setItem(seenKey, '1');
    setTimeout(() => {
      toast('今日新路子已上线 👀 去「今日」看看');
    }, 800);
  }
})();

// 路由：hash 变化
window.addEventListener('hashchange', () => {
  navigateHash();
});
