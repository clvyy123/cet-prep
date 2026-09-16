/**
 * 试卷页「作文 / 短文翻译作答区」自检（连运行中的 Electron 实例，CDP 9222）。
 *
 *   CET_DEBUG=1 VITE_DEV_SERVER_URL=http://127.0.0.1:5173 \
 *     node scripts/launch-electron.mjs --soft .      # 另开一个终端
 *   node scripts/qa-paper-answer.mjs
 *
 * 断言：
 *   A. 「进入试卷」未交卷 —— 作文块与翻译块各有一个可编辑 textarea，且无解析正文
 *   B. 输入后草稿落盘 localStorage.cet_paper_answers（输入即存）
 *   C. 返回列表再进同一套卷 —— 草稿回填（组件重挂载后从存储恢复）
 *   D. 提交后 —— textarea 转只读、正文不丢、答案仍在存储里
 *   E. 「答案解析」入口 —— 只读模式不渲染作答区（那里是看答案）
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
const clickText = (text) => `(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled);
  if (!el) return false;
  el.click();
  return true;
})()`;

const failures = [];
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures.push(label);
};

/** 探针：作答区状态 + 存储里的草稿 */
const SNAP = `(() => {
  const tas = [...document.querySelectorAll('.pb-answer-text')];
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('cet_paper_answers') || '{}'); } catch {}
  return JSON.stringify({
    boxes: tas.length,
    values: tas.map((t) => t.value),
    editable: tas.map((t) => !t.readOnly && !t.disabled),
    labels: [...document.querySelectorAll('.pb-answer-label')].map((e) => e.textContent.trim()),
    hints: [...document.querySelectorAll('.pb-answer-hint')].map((e) => e.textContent.trim()),
    analysisOpen: document.querySelectorAll('.pq-ana').length,
    scored: !!document.querySelector('.pa-score'),
    stored,
  });
})()`;

/** 写入 textarea：必须走原生 setter 再派发 input，否则 React 的 onChange 收不到 */
const TYPE = (text) => `(() => {
  const ta = document.querySelector('.pb-answer-text');
  if (!ta) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const openList = async () => {
  if (await ev(`!!document.querySelector('.paper-page')`)) {
    await ev(clickText('返回列表'));
    await until(`!!document.querySelector('.paper-grid')`, '从整卷页返回列表');
  }
  if (!(await ev(`!!document.querySelector('.paper-grid')`))) {
    await ev(`(() => { const b = [...document.querySelectorAll('nav button, .sidebar button, button')].find((x) => x.textContent.trim() === '试卷'); if (b) b.click(); })()`);
    await until(`!!document.querySelector('.paper-grid')`, '进入试卷列表');
  }
};

const openPaper = async (which) => {
  // 第一张卷：.btn-primary = 进入试卷，.btn[1] = 答案解析
  await ev(`document.querySelector('.paper-card ${which}').click()`);
  await until(`!!document.querySelector('.paper-page')`, '整卷页加载');
  await sleep(400);
};

const DRAFT = 'QA 自检草稿：This is a draft written by the automated probe.';
const TEXT_PLACEHOLDER = '在此撰写你的作文…';

await sleep(500);
await openList();
console.log('试卷列表已就绪');

// ---------------- A. 答题模式：作答区存在且可编辑 ----------------
await ev(`localStorage.removeItem('cet_paper_answers')`);
await openPaper('.btn-primary');
const a = JSON.parse(await ev(SNAP));
console.log('\n[A] 进入试卷 · 未交卷');
check(a.boxes === 2, '作文 / 翻译各有一处作答区', `boxes=${a.boxes} labels=${a.labels.join('/')}`);
check(a.editable.every(Boolean), '两处均可编辑');
check(a.analysisOpen === 0, '未交卷不显示解析正文');
check(JSON.stringify(a.stored) === '{}', '初始无草稿');
check(a.labels.join('/') === '我的作文/我的译文', '标签区分作文与译文', a.labels.join('/'));

// ---------------- B. 输入即存 ----------------
await ev(TYPE(DRAFT));
await sleep(300);
const b = JSON.parse(await ev(SNAP));
console.log('\n[B] 输入草稿');
check(b.values[0] === DRAFT, 'textarea 回显输入内容');
const storedVals = Object.values(b.stored);
check(storedVals.length === 1 && storedVals[0] === DRAFT, '草稿已落盘 cet_paper_answers', JSON.stringify(Object.keys(b.stored)));
check(!!b.stored[Object.keys(b.stored)[0]]?.startsWith('QA 自检草稿'), '存储内容与输入一致');

// ---------------- C. 重挂载后回填 ----------------
await ev(clickText('返回列表'));
await until(`!!document.querySelector('.paper-grid')`, '回到列表');
await openPaper('.btn-primary');
const c = JSON.parse(await ev(SNAP));
console.log('\n[C] 返回列表再进同一套卷');
check(c.values[0] === DRAFT, '草稿在组件重挂载后回填');
check(c.editable[0] === true, '回填后仍可继续编辑');

// ---------------- D. 提交：转只读 + 落盘 ----------------
await ev(`document.querySelector('.pq-opt:not([disabled])').click()`);
await sleep(200);
if (!(await ev(clickText('提交')))) throw new Error('没找到可用的「提交」按钮');
await until(`!!document.querySelector('.pa-score')`, '交卷完成');
await sleep(300);
const d = JSON.parse(await ev(SNAP));
console.log('\n[D] 已交卷');
check(d.scored, '出现得分');
check(d.values[0] === DRAFT, '交卷后正文不丢');
check(d.editable.every((v) => v === false), '交卷后作答区转只读', `editable=${JSON.stringify(d.editable)}`);
check(Object.values(d.stored).includes(DRAFT), '交卷后答案仍在存储里');
check(d.hints.every((h) => h.includes('已交卷')), '提示文案切到已交卷', d.hints.join(' | '));

// ---------------- E. 解析入口不渲染作答区 ----------------
await ev(clickText('返回列表'));
await until(`!!document.querySelector('.paper-grid')`, '回到列表');
await openPaper('.btn:not(.btn-primary):not(.btn-ghost)');
const e = JSON.parse(await ev(SNAP));
console.log('\n[E] 答案解析入口');
check(e.boxes === 0, '只读模式无作答区', `boxes=${e.boxes}`);
check(e.analysisOpen > 0, '解析正文已展开');

console.log(`\n${failures.length ? '✗ 失败 ' + failures.length + ' 项：' + failures.join(' / ') : '✓ 全部通过'}`);
ws.close();
process.exit(failures.length ? 1 : 0);
