const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// 调试开关：CET_DEBUG=1 时开启 CDP 调试端口（仅开发诊断用）
if (process.env.CET_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

// 部分虚拟机 / 远程桌面 / 受限会话没有可用的 GPU 进程，Electron 会因
// "GPU process isn't usable" 直接崩溃。这类环境用 CET_DISABLE_GPU=1 启动即可切到软件渲染。
if (process.env.CET_DISABLE_GPU) {
  app.disableHardwareAcceleration();
}

let mainWindow = null;

// ============ 文档导入（选择 + 解析，主进程完成，渲染进程拿纯文本） ============
// 管道分工：doc:import 是旧的 Word 专用入口；file:import 是统一入口，
// 读取原始文本/文档后交由渲染进程的解析插件注册表（src/services/parsers）
// 自动识别 Markdown / 纯文本并产出统一 IR。
const DOC_EXTS = ['doc', 'docx'];
const TEXT_EXTS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];

/** 从 Word 二进制文档提取纯文本（docx → mammoth，doc → word-extractor） */
async function extractWordText(ext, buf) {
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    const res = await mammoth.extractRawText({ buffer: buf });
    return res.value || '';
  }
  const WordExtractor = require('word-extractor');
  const doc = await new WordExtractor().extract(buf);
  return doc.getBody() || '';
}

/** 规整空白：不间断空格归一、去掉行尾空白 */
function normalizeText(text) {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+(\r?\n)/g, '$1').trim();
}

ipcMain.handle('doc:import', async () => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const picked = await dialog.showOpenDialog(win, {
    title: '选择 Word 文档',
    // 文件筛选器默认只显示 Word 文档
    filters: [{ name: 'Word 文档', extensions: DOC_EXTS }],
    properties: ['openFile'],
  });
  // 用户取消选择或未选中任何文件
  if (picked.canceled || !picked.filePaths.length) {
    return { ok: false, reason: 'cancel' };
  }
  const filePath = picked.filePaths[0];
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  // 对话框筛选器可被「手动输入文件名」绕过，这里再校验一次扩展名
  if (!DOC_EXTS.includes(ext)) {
    return { ok: false, reason: 'type', message: '仅支持 .doc 或 .docx 格式的 Word 文档' };
  }
  try {
    const buf = fs.readFileSync(filePath);
    const text = normalizeText(await extractWordText(ext, buf));
    if (!text) {
      return { ok: false, reason: 'empty', message: '未能从文档中提取到文字内容' };
    }
    return { ok: true, name: path.basename(filePath), text };
  } catch (err) {
    return { ok: false, reason: 'parse', message: (err && err.message) || String(err) };
  }
});

// 统一文档导入：Markdown / 文本 / Word 一次搞定，格式识别交给渲染进程插件
ipcMain.handle('file:import', async () => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const picked = await dialog.showOpenDialog(win, {
    title: '选择要解析的文档',
    filters: [
      { name: '支持的文档', extensions: [...TEXT_EXTS, ...DOC_EXTS] },
      { name: 'Markdown 文档', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'Word 文档', extensions: DOC_EXTS },
      { name: '文本文件', extensions: ['txt'] },
    ],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths.length) {
    return { ok: false, reason: 'cancel' };
  }
  const filePath = picked.filePaths[0];
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  if (![...TEXT_EXTS, ...DOC_EXTS].includes(ext)) {
    return {
      ok: false,
      reason: 'type',
      message: `暂不支持 .${ext} 文件：目前支持 Markdown（.md/.markdown/.mdown/.mkd）、文本（.txt）与 Word（.doc/.docx）`,
    };
  }
  try {
    let content = '';
    if (DOC_EXTS.includes(ext)) {
      content = normalizeText(await extractWordText(ext, fs.readFileSync(filePath)));
    } else {
      // 文本类：按 UTF-8 读取（BOM 交由渲染进程插件去除）。
      // 只做首尾 trim，不动行内空白——Markdown 的行尾双空格是硬换行语义，不能抹掉。
      content = fs.readFileSync(filePath, 'utf8').trim();
    }
    if (!content) {
      return { ok: false, reason: 'empty', message: '文件内容为空' };
    }
    return { ok: true, name: path.basename(filePath), ext, content };
  } catch (err) {
    return { ok: false, reason: 'parse', message: (err && err.message) || String(err) };
  }
});

// ============ 本地静态服务（生产环境使用，避免 file:// 限制并支持离线 OCR 等 fetch 资源） ============
const DIST_DIR = path.join(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};
const DEFAULT_PORT = 17380;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath;
      try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      } catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
      }
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.normalize(path.join(DIST_DIR, urlPath));
      // 严格校验：必须等于 DIST_DIR 或以其 + 路径分隔符开头，防止前缀匹配穿越
      if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          // SPA 路由回退到首页
          fs.readFile(path.join(DIST_DIR, 'index.html'), (e2, html) => {
            if (e2) {
              res.writeHead(404);
              res.end('Not found');
              return;
            }
            res.writeHead(200, { 'Content-Type': MIME['.html'] });
            res.end(html);
          });
          return;
        }
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
      });
    });
    // 固定端口保证 localStorage 持久；占用则顺延
    const tryListen = (port) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && port < DEFAULT_PORT + 10) tryListen(port + 1);
        else reject(e);
      });
      server.listen(port, '127.0.0.1', () => resolve({ server, port }));
    };
    tryListen(DEFAULT_PORT);
  });
}

function createWindow() {
  // 窗口图标（标题栏左上角 + 任务栏）。打包后由 exe 资源接管，开发态用仓库里的文件。
  const iconIco = path.join(__dirname, '..', 'build', 'icon.ico');
  const iconPng = path.join(__dirname, '..', 'build', 'icon.png');
  const windowIcon = fs.existsSync(iconIco) ? iconIco : iconPng;

  // Windows 上隐藏原生标题栏，改用系统绘制的「标题栏覆盖层」：
  // 最小化/最大化/关闭仍由操作系统绘制（原生手感不变），但底色/图标色
  // 可在运行时经 setTitleBarOverlay 动态改，让窗口外框跟随应用主题。
  // 初始值对应默认主题 bluechip；主题切换后渲染进程会经 IPC 同步新颜色。
  // 覆盖层只占顶部 32px 高的一条，网页内容在其下铺满，由渲染层留出拖拽区。
  const winOptions = {
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'CET备考助手',
    icon: windowIcon,
    backgroundColor: '#f3f3f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  };
  if (process.platform === 'win32') {
    winOptions.titleBarStyle = 'hidden';
    winOptions.titleBarOverlay = {
      color: '#f3f3f3', // 对应 bluechip 的 --bg
      symbolColor: '#0a0a0a', // 对应 bluechip 的 --ink
      height: 32,
    };
  }

  mainWindow = new BrowserWindow(winOptions);

  // 窗口外框随主题变色：渲染进程在 applyTheme 时把当前主题的
  // 画布色（--bg）/前景色（--ink）经 IPC 送过来
  const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
  ipcMain.handle('win:chrome', (_e, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'no-window' };
    const bg = typeof payload?.bg === 'string' ? payload.bg.trim() : '';
    const fg = typeof payload?.fg === 'string' ? payload.fg.trim() : '';
    const result = { ok: true, bg: false, overlay: false };
    // 画布色：顺带把窗口背景（启动闪屏、拖出边缘露出的底色）一起换掉
    try {
      if (HEX_COLOR.test(bg)) {
        mainWindow.setBackgroundColor(bg);
        result.bg = true;
      }
    } catch (err) {
      result.bgError = err?.message || String(err);
    }
    // 覆盖层颜色：仅 Windows 支持运行时更新
    try {
      if (
        process.platform === 'win32' &&
        typeof mainWindow.setTitleBarOverlay === 'function' &&
        HEX_COLOR.test(bg) &&
        HEX_COLOR.test(fg)
      ) {
        mainWindow.setTitleBarOverlay({ color: bg, symbolColor: fg });
        result.overlay = true;
      }
    } catch (err) {
      result.overlayError = err?.message || String(err);
    }
    return result;
  });

  // 移除默认菜单
  Menu.setApplicationMenu(null);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    startServer()
      .then(({ server, port }) => {
        app.__staticServer = server;
        mainWindow.loadURL(`http://127.0.0.1:${port}/`);
        // 拦截主窗口内导航到外部站点（绕过 setWindowOpenHandler 的途径）
        mainWindow.webContents.on('will-navigate', (event, url) => {
          if (!url.startsWith(`http://127.0.0.1:${port}/`)) event.preventDefault();
        });
      })
      .catch((err) => {
        dialog.showErrorBox('启动失败', `本地服务端口被占用或启动失败：${err.message || err}`);
        app.quit();
      });
  }

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (app.__staticServer) {
    app.__staticServer.close();
    app.__staticServer = null;
  }
});
