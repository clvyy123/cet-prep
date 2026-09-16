/**
 * 整卷页滚动探针：headless Edge + CDP，验证「卷面 / 题号目录」两栏滚动是否已分离。
 *
 *   node scripts/qa-paper-scroll.mjs [url] [theme|none] [shotPath]
 *
 * 关注点：
 *   1. mainScroll     .main 不该再有滚动（scrollHeight == clientHeight），滚动全在栏内
 *   2. topbar         滚卷面时顶栏 rect 不动（已脱离滚动流）
 *   3. mainPane/aside 两栏各自有滚动容器；滚卷面时题号目录的 scrollTop 必须保持 0
 *   4. edges          卷面卡片 / 题号目录 / 顶栏的右边界是否对齐
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const theme = process.argv[3] ?? 'none';
const shot = process.argv[4];
const cardIdx = Number(process.argv[5] ?? 0);
const viewport = { w: Number(process.argv[6] ?? 1280), h: Number(process.argv[7] ?? 800) };
const PORT = 9337;

const profile = mkdtempSync(join(tmpdir(), 'edge-probe-'));
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,800',
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
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: viewport.w, height: viewport.h, deviceScaleFactor: 1, mobile: false });

events.length = 0;
await send('Page.navigate', { url: `${url}?t=${Math.random().toString(36).slice(2)}` });
await waitLoad();

if (theme !== 'none') {
  await ev(`localStorage.setItem('cet_settings', JSON.stringify({ theme: '${theme}' }))`);
  events.length = 0;
  await send('Page.reload');
  await waitLoad();
}
await sleep(500);

const entered = await ev(`(async () => {
  [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('试卷'))?.click();
  await new Promise(r => setTimeout(r, 600));
  document.querySelectorAll('.paper-card .btn-primary')[${cardIdx}]?.click();
  await new Promise(r => setTimeout(r, 600));
  return !!document.querySelector('.paper-main');
})()`);
if (!entered) throw new Error('未能进入整卷页');

const probe = `(() => {
  const r = (el) => el ? (({top, bottom, height, left, right, width}) => ({top: Math.round(top), bottom: Math.round(bottom), height: Math.round(height), left: Math.round(left), right: Math.round(right), width: Math.round(width)}))(el.getBoundingClientRect()) : null;
  const box = (el) => el ? { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: Math.round(el.scrollTop), overflowY: getComputedStyle(el).overflowY } : null;
  const main = document.querySelector('.main');
  const mPane = document.querySelector('.paper-main');
  const aPane = document.querySelector('.paper-aside');
  const topbar = document.querySelector('.paper-topbar');
  const card = document.querySelector('.ps');
  const aCard = document.querySelector('.pa-card');
  return {
    mainScroll: { clientHeight: main.clientHeight, scrollHeight: main.scrollHeight, scrollTop: Math.round(main.scrollTop) },
    topbar: r(topbar),
    mainPane: { ...r(mPane), ...box(mPane), position: getComputedStyle(mPane).position },
    asidePane: { ...r(aPane), ...box(aPane), position: getComputedStyle(aPane).position },
    edges: { topbarRight: r(topbar).right, mainCardRight: r(card).right, asideRight: r(aPane).right, asideCardRight: r(aCard).right, asideCardLeft: r(aCard).left },
  };
})()`;

const out = { viewport: { w: 1280, h: 800 } };
out.initial = await ev(probe);

// 滚卷面 600px：题号目录与顶栏都不该动
await ev(`document.querySelector('.paper-main').scrollTop = 600`);
await sleep(250);
out.paperScrolled600 = await ev(probe);

// 滚题号目录：卷面不该动
await ev(`document.querySelector('.paper-aside').scrollTop = 80`);
await sleep(250);
out.asideScrolled80 = await ev(probe);

// 点题号目录里的一个题号，看是否只滚卷面
await ev(`(() => { const b = document.querySelector('.paper-aside .pa-cell'); if (b) b.click(); })()`);
await sleep(900);
out.afterJumpToQ1 = await ev(probe);

// 点最后一个题号：量目标题距卷面容器顶部的偏移（应≈8px，且只能落在卷面容器里）
out.jumpToLast = await ev(`(async () => {
  const cells = [...document.querySelectorAll('.paper-aside .pa-cell')];
  const n = cells[cells.length - 1]?.textContent.trim();
  cells[cells.length - 1]?.click();
  await new Promise(r => setTimeout(r, 1200));
  const box = document.querySelector('.paper-main');
  const el = document.querySelector('#pq-' + n);
  return {
    num: n,
    offsetInPane: Math.round(el.getBoundingClientRect().top - box.getBoundingClientRect().top),
    paneScrollTop: Math.round(box.scrollTop),
    paneMaxScroll: box.scrollHeight - box.clientHeight,
    asideScrollTop: Math.round(document.querySelector('.paper-aside').scrollTop),
    mainScrollTop: Math.round(document.querySelector('.main').scrollTop),
  };
})()`);

if (shot) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(data, 'base64'));
  console.error('shot', shot);
}

console.log(JSON.stringify(out, null, 2));
ws.close();
edge.kill();
process.exit(0);
