/**
 * 启动 Electron，并先把「会让主进程炸掉」的环境变量从 env 里真正删掉。
 *
 *   node scripts/launch-electron.mjs [--soft] [electron 参数...]
 *
 * 为什么需要这层壳：用 npm 脚本 / cross-env 是清不掉这些变量的。
 * Chromium 侧判的是「变量存在与否」（base::Environment::HasVar），
 * 把 ELECTRON_RUN_AS_NODE 设成空串仍然会让 electron.exe 退化成纯 Node：
 *   - --no-sandbox 等 Chromium 开关会被当成非法选项 → "bad option: --no-sandbox"
 *   - require('electron') 会返回二进制路径字符串 → 主进程首行
 *     "Cannot read properties of undefined (reading 'whenReady')"
 * 只有从传下去的 env 对象里 delete 掉才算真干净。
 *
 * --soft：追加无沙箱 + 软件渲染开关，并开 CET_DISABLE_GPU=1
 *         （受限会话里没有可用 GPU 进程，否则 FATAL: GPU process isn't usable）。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const soft = argv.includes('--soft')
let appArgs = argv.filter((a) => a !== '--soft')
if (!appArgs.length) appArgs = ['.']

const SWITCHES = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-gpu-sandbox',
]

let electronBin
try {
  // 在普通 Node 下 require('electron') 返回的就是二进制路径
  electronBin = require('electron')
} catch {
  electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
if (soft) env.CET_DISABLE_GPU = env.CET_DISABLE_GPU || '1'

// Chromium 开关必须排在应用路径「前面」，否则会被当成应用自己的 argv 丢掉
const args = soft ? [...SWITCHES, ...appArgs] : [...appArgs]

const child = spawn(electronBin, args, { cwd: root, stdio: 'inherit', env })
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
child.on('error', (err) => {
  console.error('[launch-electron] failed to start electron:', err.message)
  process.exit(1)
})
