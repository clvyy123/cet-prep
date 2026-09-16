/**
 * examcrafts 全量采集：登录 → 卡片列表 → 逐套解密整卷内容（含答案）
 *   node scripts/ec-crawl.mjs <user> <pass> <outDir>
 *
 * 内容接口强制 AES-GCM 加密：cet-content/<id> → {payload(b64), iv(b64), key_id}
 * → decrypt-key-v2/<key_id> → {key(hex)}。解密必须在页面上下文里做（绕过 EdgeOne 挑战）。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [USER, PASS, outDir] = process.argv.slice(2);
const PORT = 9500 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), 'edge-ec5-'));
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
const go = async (url, wait = 2500) => {
  events.length = 0;
  await send('Page.navigate', { url });
  for (let i = 0; i < 120 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
  await sleep(wait);
};
const loginJs = `(() => {
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const ins = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox');
  setVal(ins[0], ${JSON.stringify(USER)});
  setVal(ins[1], ${JSON.stringify(PASS)});
  [...document.querySelectorAll('button')].find(b => /登录/.test(b.textContent))?.click();
})()`;

await send('Page.enable');
await send('Runtime.enable');
await go('https://examcrafts.com/auth');
await ev(loginJs);
await sleep(5000);
for (let i = 0; i < 3; i++) {
  const chk = await ev(`document.body.innerText.includes('登录')`);
  if (chk.result?.value !== true) break;
  console.log('登录未生效，重试', i + 1);
  await go('https://examcrafts.com/auth', 2000);
  await ev(loginJs);
  await sleep(5000);
}

await go('https://examcrafts.com/cet4', 1500);

// ---- 1. 卡片列表（优先用上次已抓到的 _cards.json，避免重复触发限频） ----
const USER_J = JSON.stringify(USER);
const PASS_J = JSON.stringify(PASS);
let cardsData;
const cardsFile = join(outDir, '_cards.json');
if (existsSync(cardsFile) && JSON.parse(readFileSync(cardsFile, 'utf8')).length > 40) {
  cardsData = { cards: JSON.parse(readFileSync(cardsFile, 'utf8')) };
  console.log('卡片（缓存）:', cardsData.cards.length);
} else {
  const cardsRes = await ev(`(async () => {
  const r0 = await fetch('https://admin.examcrafts.com/api/auth/login/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ${USER_J}, password: ${PASS_J} }),
  });
  const j0 = await r0.json();
  const tok = j0.access || j0.data?.access;
  if (!tok) return JSON.stringify({ err: 'no token' });
  const H = { Authorization: 'Bearer ' + tok };
  const all = [];
  for (const subject of ['CET4', 'CET6']) {
    for (const year of [2026, 2025, 2024, 2023, 2022, 2021, 2020]) {
      for (const month of [6, 12, 3, 9, 8]) {
        try {
          const r = await fetch('https://admin.examcrafts.com/api/exams/exam-cards/?subject=' + subject + '&year=' + year + '&month=' + month, { headers: H });
          const j = await r.json();
          const list = Array.isArray(j) ? j : j.results || [];
          all.push(...list);
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  }
  const seen = new Set();
  const uniq = all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return JSON.stringify({ tok, cards: uniq.map((c) => ({ id: c.id, title: c.title, subject: c.subject, year: c.year, month: c.month, version: c.version })) });
})()`);
  const cardsData0 = JSON.parse(cardsRes.result?.value || '{}');
  if (!cardsData0.cards?.length) {
    console.log('卡片获取失败:', cardsRes.result?.value?.slice(0, 300));
    process.exit(1);
  }
  cardsData = cardsData0;
  writeFileSync(cardsFile, JSON.stringify(cardsData.cards, null, 1));
}
console.log('卡片:', cardsData.cards.length);

// ---- 2. 逐套：一次 evaluate 内完成 登录→取内容→取key→解密；被挑战就重载页面重试 ----
const todo = cardsData.cards.filter((c) => !existsSync(join(outDir, `ec-${c.id}.json`)));
console.log('待抓:', todo.length);
const fetchOne = (c) => `(async () => {
  const login = async () => {
    const r0 = await fetch('https://admin.examcrafts.com/api/auth/login/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ${USER_J}, password: ${PASS_J} }),
    });
    const j0 = await r0.json();
    return j0.access || j0.data?.access || '';
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const tok = await login();
    if (!tok) { await new Promise((r) => setTimeout(r, 4000)); continue; }
    try {
      const H = { Authorization: 'Bearer ' + tok };
      const r = await fetch('https://admin.examcrafts.com/api/exams/cet/cet-content/' + ${JSON.stringify(c.id)} + '/?mode=answer&encrypt=false', { headers: H });
      const j = await r.json();
      if (typeof j !== 'object' || j === null || !('encrypted' in j)) { lastErr = 'content:' + JSON.stringify(j).slice(0,80); await new Promise((r) => setTimeout(r, 5000)); continue; }
      if (!j.encrypted) return JSON.stringify({ ok: true, data: j });
      const rk = await fetch('https://admin.examcrafts.com/api/exams/decrypt-key-v2/' + j.key_id + '/', { headers: H });
      const jk = await rk.json();
      const b64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
      const hex2b = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
      const key = await crypto.subtle.importKey('raw', hex2b(jk.key), 'AES-GCM', false, ['decrypt']);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(j.iv) }, key, b64(j.payload));
      return JSON.stringify({ ok: true, data: JSON.parse(new TextDecoder().decode(pt)) });
    } catch (e) { lastErr = String(e.message || e); await new Promise((r) => setTimeout(r, 5000)); }
  }
  return JSON.stringify({ ok: false, err: lastErr });
})()`;
for (const c of todo) {
  let res = await ev(fetchOne(c));
  let d = {};
  try { d = JSON.parse(res.result?.value || '{}'); } catch {}
  if (!d.ok && /IP_BLOCKED/.test(d.err || '')) {
    console.log('  …', c.id, 'IP 封禁，等待 90s');
    await sleep(90000);
  }
  if (!d.ok) {
    console.log('  …', c.id, '被挑战，重载页面重试');
    await go('https://examcrafts.com/cet4', 3000);
    await sleep(6000);
    res = await ev(fetchOne(c));
    try { d = JSON.parse(res.result?.value || '{}'); } catch {}
  }
  if (d.ok && d.data && typeof d.data === 'object') {
    writeFileSync(join(outDir, `ec-${c.id}.json`), JSON.stringify(d.data, null, 1));
    console.log(`  ✓ ${c.id} ${(JSON.stringify(d.data).length / 1024).toFixed(0)} KB`);
  } else {
    console.log(`  ✗ ${c.id} err=${d.err || JSON.stringify(d).slice(0,120)}`);
  }
  await sleep(30000);
}
console.log('done');
ws.close();
edge.kill();
process.exit(0);
