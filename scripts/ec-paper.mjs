/**
 * 登录 examcrafts.com，采集「试卷列表 / 答案解析 / 考试页」三个参考页
 *   node scripts/ec-paper.mjs <user> <pass> <outDir>
 *
 * 长页面用「先量 scrollHeight 再把视口设高」的方式整页截图。
 * （不用 captureBeyondViewport —— 实测会挂住 CDP。）
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [USER, PASS, outDir] = process.argv.slice(2);
const PORT = 9500 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), 'edge-ec-'));
mkdirSync(outDir, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1440,1000',
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
const ev = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
const setVp = (h) =>
  send('Emulation.setDeviceMetricsOverride', { width: 1440, height: Math.min(h, 8000), deviceScaleFactor: 1, mobile: false });
const go = async (url, wait = 2500) => {
  events.length = 0;
  await send('Page.navigate', { url });
  for (let i = 0; i < 120 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
  await sleep(wait);
};
const shotFull = async (name) => {
  const h = await ev('Math.ceil(document.documentElement.scrollHeight)');
  await setVp(Number(h.result?.value) || 1000);
  await sleep(600);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  if (data) writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  await setVp(1000);
  console.log('  shot', name, `h=${h.result?.value}`);
};
const dump = async (name) => {
  const r = await ev('document.body.innerText');
  writeFileSync(join(outDir, `${name}.txt`), r.result?.value ?? '', 'utf8');
  console.log('  text', name);
};
// 整页图太高看不了细节，再按视口切几张局部图
const shotClips = async (name, count = 3) => {
  const h = Number((await ev('Math.ceil(document.documentElement.scrollHeight)')).result?.value) || 1000;
  await setVp(1000);
  const step = Math.max(600, Math.floor((h - 900) / (count - 1)));
  for (let i = 0; i < count; i++) {
    const y = Math.min(i * step, Math.max(0, h - 900));
    await ev(`window.scrollTo(0, ${y})`);
    await sleep(500);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    if (data) writeFileSync(join(outDir, `${name}-c${i + 1}.png`), Buffer.from(data, 'base64'));
  }
  console.log('  clips', name);
};

await send('Page.enable');
await send('Runtime.enable');
await setVp(1000);

// ---- 登录 ----
await go('https://examcrafts.com/auth');
await ev(`(() => {
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const ins = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox');
  setVal(ins[0], ${JSON.stringify(USER)});
  setVal(ins[1], ${JSON.stringify(PASS)});
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '登录')?.click();
})()`);
await sleep(5000);
const who = await ev(`JSON.stringify({url: location.href, ls: Object.keys(localStorage)})`);
console.log('登录:', who.result?.value);

// ---- 试卷列表 ----
await go('https://examcrafts.com/cet4');
await shotFull('list');
await dump('list');

// ---- 点第一个「答案解析」----
const clickByText = (t) => `(() => {
  const b = [...document.querySelectorAll('button,a')].find(x => x.textContent.trim() === ${JSON.stringify(t)});
  if (!b) return 'NOT_FOUND';
  b.click();
  return 'CLICKED';
})()`;

const r1 = await ev(clickByText('答案解析'));
console.log('答案解析按钮:', r1.result?.value);
await sleep(4000);
console.log('  url:', (await ev('location.href')).result?.value);
await shotFull('analysis');
await shotClips('analysis', 4);
await dump('analysis');

// ---- 回列表，点第一个「开始考试」----
await go('https://examcrafts.com/cet4');
const r2 = await ev(clickByText('开始考试'));
console.log('开始考试按钮:', r2.result?.value);
await sleep(4000);
console.log('  url:', (await ev('location.href')).result?.value);
await shotFull('exam');
await shotClips('exam', 4);
await dump('exam');

ws.close();
edge.kill();
process.exit(0);
