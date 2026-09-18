const { contextBridge, webFrame, ipcRenderer } = require('electron');

// 全局显示缩放（等比放大整个界面；调到 1.0 即恢复 100%）
webFrame.setZoomFactor(1.08);

// 渲染进程通过 window.cetAPI 访问受控的桌面能力
contextBridge.exposeInMainWorld('cetAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // 弹出系统文件选择框（筛选 Word 文档）并在主进程解析，返回统一结果对象
  pickWordDoc: () => ipcRenderer.invoke('doc:import'),
  // 统一文档导入（Markdown / 文本 / Word）：返回原始文本，格式识别由渲染进程解析插件完成
  pickDocFile: () => ipcRenderer.invoke('file:import'),
  // 窗口外框随主题变色：传入当前主题的画布色（bg）与前景色（fg）
  setWindowChrome: (bg, fg) => ipcRenderer.invoke('win:chrome', { bg, fg }),
  // 考试时间同步：经主进程代抓 neea.edu.cn 页面文本（绕过渲染进程 CORS 限制）
  fetchText: (url) => ipcRenderer.invoke('net:get', { url }),
});
