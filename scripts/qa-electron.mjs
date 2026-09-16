/**
 * 用 CDP 检查正在跑的 Electron 窗口（不只是「进程在不在」，而是「画面渲没渲染出来」）。
 *
 * 前提：以 CET_DEBUG=1 启动应用，main.cjs 会打开 9222 调试端口。
 *   CET_DEBUG=1 npm run dev:soft
 *   node scripts/qa-electron.mjs                 # 报告标题/URL/渲染规模，然后关闭窗口
 *   node scripts/qa-electron.mjs --keep          # 只报告，不关
 *   node scripts/qa-electron.mjs --shot .qa/win.png
 *   node scripts/qa-electron.mjs --eval "document.querySelectorAll('.nav-item').length"
 *
 * 为什么不看窗口标题：BrowserWindow 的 title 是构造参数写死的，白屏也照样有。
 */
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const value = (n) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : undefined
}

const PORT = Number(value('--port') || 9222)
const KEEP = flag('--keep')
const SHOT = value('--shot')
const EVAL = value('--eval')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let targets
try {
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
} catch {
  console.error(`[qa-electron] cannot reach CDP on :${PORT}. start the app with CET_DEBUG=1.`)
  process.exit(1)
}

const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('[qa-electron] no page target found')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params) =>
  new Promise((res, rej) => {
    const i = ++id
    const timer = setTimeout(() => rej(new Error(`${method} timed out`)), 15000)
    pending.set(i, (m) => {
      clearTimeout(timer)
      if (m.error) rej(new Error(`${method}: ${m.error.message}`))
      else res(m.result)
    })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  const cb = pending.get(m.id)
  if (cb) {
    pending.delete(m.id)
    cb(m)
  }
}
await new Promise((r, j) => {
  ws.onopen = r
  ws.onerror = () => j(new Error('CDP socket error'))
})

console.log('title:', page.title)
console.log('url  :', page.url)

const probe = await send('Runtime.evaluate', {
  expression: `(function(){
    const root = document.querySelector('#root');
    return JSON.stringify({
      navItems: document.querySelectorAll('.nav-item').length,
      rootChildren: root ? root.children.length : -1,
      chars: (document.body.innerText || '').length,
      theme: document.documentElement.dataset.theme || ''
    });
  })()`,
  returnByValue: true,
})
console.log('render:', probe.result.value)

if (EVAL) {
  const r = await send('Runtime.evaluate', { expression: EVAL, returnByValue: true })
  console.log('eval  :', JSON.stringify(r.result.value))
}

if (SHOT) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const out = path.resolve(SHOT)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'))
  console.log('shot  :', out)
}

if (KEEP) {
  console.log('kept open')
  ws.close()
  process.exit(0)
}

// 不要用 taskkill /IM electron.exe：宿主 WorkBuddy 本身也是 Electron
send('Browser.close', {}).catch(() => {})
await sleep(300)
console.log('closed')
process.exit(0)
