/**
 * 高保真局部截图：以 DPR 3 抓某个选择器覆盖的区域，
 * 用来判断图标、字重在真实 1× 尺寸下的抗锯齿质量（qa-shot.mjs 是 DPR 1 的整页图）。
 *
 *   用法：node scripts/qa-crop.mjs <url> <theme|none> <navIndex|none> <cssSelector> <out.png>
 *   例：  node scripts/qa-crop.mjs http://127.0.0.1:5173/ bluechip 7 ".grid-2" .qa/settings.png
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [url, theme, navIdx, selector, out] = process.argv.slice(2);
const PORT = 9345;
const profile = mkdtempSync(join(tmpdir(), 'edge-crop-'));

const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,800',
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
const waitLoad = async () => {
  for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 3,
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
if (navIdx !== 'none') {
  await ev(`document.querySelectorAll('.nav-item')[${Number(navIdx)}]?.click()`);
  await sleep(800);
}

const box = await ev(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: Math.min(r.width + 12, 1276), height: Math.min(r.height + 12, 796) };
})()`);
const clip = box.result?.value;
if (!clip) throw new Error('未找到 ' + selector);
const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
writeFileSync(out, Buffer.from(data, 'base64'));
console.log('shot', out, JSON.stringify(clip));
ws.close();
edge.kill();
process.exit(0);
