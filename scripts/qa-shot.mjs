/**
 * 视觉自测：headless Edge + CDP（复用同一份样板，两种用法）
 *
 *   截图：node scripts/qa-shot.mjs <url> <theme|none> <outDir>
 *   探针：node scripts/qa-shot.mjs <url> <theme> - <navIndex> "<js 表达式>"
 *
 * theme 会写进 localStorage.cet_settings 并重载，用于预览非默认主题。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [url, theme, outDir, navIdx, expr] = process.argv.slice(2);
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'edge-qa-'));
if (outDir !== '-') mkdirSync(outDir, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,800', // 贴近 Electron 默认窗口
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
]);
edge.stderr.on('data', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) throw new Error('CDP 未就绪');

const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? {});
    pending.delete(msg.id);
  } else if (msg.method) events.push(msg.method);
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const waitLoad = async () => {
  for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
};
const ev = (expression) =>
  send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
});

events.length = 0;
await send('Page.navigate', { url: `${url}?t=${Math.random().toString(36).slice(2)}` });
await waitLoad();

if (theme && theme !== 'none') {
  await ev(`localStorage.setItem('cet_settings', JSON.stringify({ theme: '${theme}' }))`);
  events.length = 0;
  await send('Page.reload');
  await waitLoad();
}
await sleep(500);

const clickNav = async (i) => {
  await ev(`document.querySelectorAll('.nav-item')[${i}]?.click()`);
  await sleep(700);
};

if (outDir === '-') {
  if (navIdx) await clickNav(Number(navIdx));
  const shotPath = process.argv[7];
  if (shotPath) {
    // 抓「动画进行中」的一帧：表达式先异步跑起来（不要 await），隔 delay 拍一张再收结果
    const running = ev(expr ?? 'null');
    await sleep(Number(process.argv[8]) || 300);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotPath, Buffer.from(data, 'base64'));
    console.log('shot', shotPath);
    await running;
  } else {
    const r = await ev(expr ?? 'document.documentElement.dataset.theme');
    console.log(JSON.stringify(r.result?.value, null, 2));
  }
} else {
  // 侧边栏顺序：0 首页 1 单词 2 真题练习 3 试卷 4 错题本 5 听力 6 模考 7 AI 阅读 8 设置
  for (const [name, i] of [
    ['dashboard', 0],
    ['vocabulary', 1],
    ['practice', 2],
    ['mistakes', 4],
    ['exam', 6],
    ['settings', 8],
  ]) {
    await clickNav(i);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
    console.log('saved', name);
  }
  const diag = await ev(`JSON.stringify({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem('cet_settings'),
  })`);
  console.log('DIAG', diag.result?.value);
}

ws.close();
edge.kill();
process.exit(0);
