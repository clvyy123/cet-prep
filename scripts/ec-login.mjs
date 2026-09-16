/**
 * 登录 examcrafts.com 并采集试卷页参考（headless Edge + CDP）
 *   node scripts/ec-login.mjs <user> <pass> <outDir>
 *
 * 一次进程内完成：登录 → 科目页 → 试卷列表 → 打开一套卷 → 截图 + 文本。
 * 因为每次启动都是全新 profile，登录态不跨进程保留。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [USER, PASS, outDir] = process.argv.slice(2);
const PORT = 9400 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), 'edge-ec-'));
mkdirSync(outDir, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1440,1100',
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
const go = async (url) => {
  events.length = 0;
  await send('Page.navigate', { url });
  for (let i = 0; i < 120 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
  await sleep(2000);
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('  shot', name);
};
const text = async (name, chars = 3000) => {
  const r = await ev('document.body.innerText');
  writeFileSync(join(outDir, `${name}.txt`), r.result?.value ?? '', 'utf8');
  console.log('  text', name);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

console.log('→ 登录页');
await go('https://examcrafts.com/auth');
await shot('auth-before');

// 只负责填值 + 提交（不等待切页，否则导航会销毁 JS 上下文导致 promise 悬空）
const filled = await ev(`(() => {
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const ins = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox');
  if (ins.length < 2) return 'NO_INPUTS n=' + ins.length;
  setVal(ins[0], ${JSON.stringify(USER)});
  setVal(ins[1], ${JSON.stringify(PASS)});
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '登录');
  if (!btn) return 'NO_BUTTON';
  btn.click();
  return 'CLICKED u=' + ins[0].value + ' p=' + ins[1].value.length;
})()`);
console.log('填表:', filled.result?.value);

await sleep(5000);
const after = await ev(`JSON.stringify({
  url: location.href,
  len: document.body.innerText.length,
  head: document.body.innerText.slice(0, 200),
  ls: Object.keys(localStorage),
})`);
console.log('登录后:', after.result?.value);
await shot('auth-after');

console.log('→ 试卷列表');
await go('https://examcrafts.com/cet4');
await sleep(2500);
await shot('cet4-list');
await text('cet4-list');

console.log('→ 打开第一套卷');
const opened = await ev(`(async () => {
  const els = [...document.querySelectorAll('button,a,div')].filter(e => {
    const t = e.textContent.trim();
    return /^\\d{4}年\\d{1,2}月/.test(t) && t.length < 40;
  });
  const names = els.map(e => e.textContent.trim()).slice(0, 20);
  const target = [...document.querySelectorAll('button,a')].find(b => /进入|开始|练习|查看/.test(b.textContent) && b.textContent.length < 12);
  if (target) { target.click(); await new Promise(r => setTimeout(r, 3500)); }
  return JSON.stringify({ names, after: location.href });
})()`);
console.log('试卷条目:', opened.result?.value);
await shot('paper-open');
await text('paper-open');
await go('https://examcrafts.com/cet4');
await sleep(1500);

ws.close();
edge.kill();
process.exit(0);
