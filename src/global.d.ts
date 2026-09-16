interface CetAPI {
  platform: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  pickWordDoc: () => Promise<
    | { ok: true; name: string; text: string }
    | { ok: false; reason: 'cancel' | 'type' | 'empty' | 'parse'; message?: string }
  >;
  /** 统一文档导入：Markdown / 文本 / Word，返回原始文本（格式识别由解析插件完成） */
  pickDocFile: () => Promise<
    | { ok: true; name: string; ext: string; content: string }
    | { ok: false; reason: 'cancel' | 'type' | 'empty' | 'parse'; message?: string }
  >;
  /** 把当前主题的画布色/前景色同步到窗口标题栏覆盖层与窗口背景 */
  setWindowChrome: (bg: string, fg: string) => Promise<void>;
}

interface Window {
  cetAPI?: CetAPI;
}
