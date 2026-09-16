// 连接已运行实例的 CDP（9222），评估表达式
// 用法: node scripts/cdp-eval.mjs "<js 表达式>"
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const expr = process.argv[2] ?? 'null';

if (expr === '__CLOSE__') {
  const l = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const w = l.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  if (!w) throw new Error('no page target');
  const s = new WebSocket(w);
  await new Promise((r, j) => { s.onopen = r; s.onerror = j; });
  s.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
}

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
if (!wsUrl) throw new Error('no page target');

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

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
if (r.result?.exceptionDetails) {
  console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails, null, 2));
} else {
  console.log(JSON.stringify(r.result?.result?.value, null, 2));
}
ws.close();
process.exit(0);
