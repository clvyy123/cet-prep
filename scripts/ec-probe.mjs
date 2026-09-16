/**
 * 通用网页探针：headless Edge + CDP
 *   文本：node scripts/ec-probe.mjs <url> text
 *   截图：node scripts/ec-probe.mjs <url> shot <out.png>
 *   点击后文本：node scripts/ec-probe.mjs <url> text "<css选择器>"
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [url, mode, arg] = process.argv.slice(2);
const PORT = 9334;

const profile = mkdtempSync(join(tmpdir(), 'edge-probe-'));
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

await send('Page.enable');
await send('Runtime.enable');
if (mode === 'net') await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let i = 0; i < 100 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
await sleep(2500);

if (mode === 'shot') {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg || 'probe.png', Buffer.from(data, 'base64'));
  console.log('shot', arg);
} else if (mode === 'net') {
  const urls = await ev('JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name))');
  console.log(urls.result?.value);
  if (arg) {
    await ev(`document.querySelector(${JSON.stringify(arg)})?.click()`);
    await sleep(2500);
    const u2 = await ev('JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name))');
    console.log(u2.result?.value);
  }
} else if (mode === 'eval') {
  const r = await ev(arg);
  console.log(typeof r.result?.value === 'string' ? r.result.value : JSON.stringify(r.result?.value, null, 2));
} else {
  if (arg) {
    await ev(`document.querySelector(${JSON.stringify(arg)})?.click()`);
    await sleep(2000);
  }
  const r = await ev('document.body.innerText');
  console.log(r.result?.value ?? '(empty)');
}

ws.close();
edge.kill();
process.exit(0);
