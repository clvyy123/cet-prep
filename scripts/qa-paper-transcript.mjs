/**
 * 试卷页「听力原文」开关的入口行为自检（连运行中的 Electron 实例，CDP 9222）。
 *
 *   node scripts/qa-paper-transcript.mjs
 *
 * 断言：
 *   1. 「进入试卷」（答题模式，未交卷）——不渲染任何「听力原文」按钮；音频播放器要在
 *   2. 「进入试卷」+ 提交后           ——出现「听力原文」按钮
 *   3. 「答案解析」入口               ——出现「听力原文」按钮
 * 全程「篇章原文」按钮都应存在（阅读正文不受影响）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
if (!wsUrl) throw new Error('没有 page target（应用没开 CET_DEBUG 调试端口？）');

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description));
  return r.result?.result?.value;
}
async function until(expr, label, ms = 10000) {
  for (let i = 0; i < ms / 200; i++) {
    if (await ev(expr)) return true;
    await sleep(200);
  }
  throw new Error(`等待超时：${label}`);
}

/** 页面上的探针：统计各类按钮/播放器 */
const SNAP = `(() => {
  const btns = [...document.querySelectorAll('.pb-src')].map((b) => b.textContent.trim());
  return JSON.stringify({
    listeningToggle: btns.filter((t) => t.includes('听力原文')).length,
    passageToggle: btns.filter((t) => t.includes('篇章原文')).length,
    players: document.querySelectorAll('.ps-audio audio').length,
    revealedBlocks: document.querySelectorAll('.pq.is-revealed').length,
    onPaper: !!document.querySelector('.paper-page'),
    onList: !!document.querySelector('.paper-grid'),
  });
})()`;

const clickText = (text) => `(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled);
  if (!el) return false;
  el.click();
  return true;
})()`;

const show = (tag, raw) => console.log(`  ${tag}  ${raw}`);

// ---------------------------------------------------------------- 1. 列表页
const gotoList = async () => {
  if (await ev(`!!document.querySelector('.paper-page')`)) {
    await ev(clickText('返回列表'));
    await until(`!!document.querySelector('.paper-grid')`, '从整卷页返回列表');
  }
  if (!(await ev(`!!document.querySelector('.paper-grid')`))) {
    await ev(`(() => { const b = [...document.querySelectorAll('nav button, .sidebar button, button')].find((x) => x.textContent.trim() === '试卷'); if (b) b.click(); })()`);
    await until(`!!document.querySelector('.paper-grid')`, '进入试卷列表');
  }
};
await sleep(500);
await gotoList();
console.log('试卷列表已就绪');

// ---------------------------------------------------------- 2. 进入试卷（答题）
await ev(`document.querySelector('.paper-card .btn-primary').click()`);
await until(`!!document.querySelector('.paper-page .ps-audio audio')`, '整卷页加载');
await sleep(400);
console.log('\n[A] 进入试卷 · 未交卷');
show('听力原文按钮', await ev(SNAP));

// 作答一题后提交
await ev(`document.querySelector('.pq-opt:not([disabled])').click()`);
await sleep(200);
if (!(await ev(clickText('提交')))) throw new Error('没找到可用的「提交」按钮');
await until(`!!document.querySelector('.pa-score')`, '交卷完成');
await sleep(300);
console.log('\n[B] 进入试卷 · 已交卷');
show('听力原文按钮', await ev(SNAP));

// ------------------------------------------------------------ 3. 答案解析入口
await ev(clickText('返回列表'));
await until(`!!document.querySelector('.paper-grid')`, '回到列表');await ev(`document.querySelectorAll('.paper-card')[0].querySelectorAll('.btn')[1].click()`);
await until(`!!document.querySelector('.paper-page')`, '答案解析整卷页');
await sleep(400);
console.log('\n[C] 答案解析入口');
show('听力原文按钮', await ev(SNAP));

ws.close();
process.exit(0);
