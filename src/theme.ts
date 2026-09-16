/**
 * 视觉主题。
 *
 * - bluechip：中性黑白灰底 + 电光蓝点缀（styles.css 的 :root 默认值）
 * - spacex：纯黑画布 + 发丝线 + 白色唯一强调（见 styles.css 第 31 节，来源 DESIGN.md）
 *
 * 新增风格只需在此登记 key，并在 styles.css 中补一段 `:root[data-theme='key']` 覆盖。
 */
export interface ThemeDef {
  key: string;
  name: string;
  color: string;
}

export const THEMES: ThemeDef[] = [
  { key: 'bluechip', name: '蓝白', color: '#0000ff' },
  { key: 'spacex', name: '黑白', color: '#000000' },
];

export const DEFAULT_THEME = 'bluechip';

function normalizeTheme(theme?: string): string {
  return THEMES.some((t) => t.key === theme) ? (theme as string) : DEFAULT_THEME;
}

export function applyTheme(theme?: string): void {
  document.documentElement.dataset.theme = normalizeTheme(theme);
  syncWindowChrome();
}

/**
 * 把当前主题的画布色（--bg）/前景色（--ink）同步到 Electron 窗口外框：
 * 标题栏覆盖层（最小化/最大化/关闭按钮那条）与窗口背景随之变色，
 * 让窗口外观和界面配色保持一致。直接读换肤后的计算值，新增主题零登记。
 * 纯浏览器环境（dev:web）没有 cetAPI，静默跳过。
 */
function syncWindowChrome(): void {
  try {
    const api = window.cetAPI;
    if (!api?.setWindowChrome) return;
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg').trim();
    const fg = cs.getPropertyValue('--ink').trim();
    if (bg && fg) void api.setWindowChrome(bg, fg);
  } catch {
    /* 非桌面环境忽略 */
  }
}

/** 触发切换的位置（一般是点击处），用来决定新皮肤从哪儿漾开 */
export interface ThemeSwitchOrigin {
  x: number;
  y: number;
}

/** 与 styles.css 第 23 节 vt-theme-reveal 同源：时长/曲线改一边必须同步另一边 */
const REVEAL_MS = 600;
const REVEAL_EASING: [number, number, number, number] = [0.4, 0, 0.2, 1];

/**
 * 把「动画输出进度 v（0..1）」反解成「时间进度 t（0..1）」。
 * cubic-bezier 的参数式 x(u)/y(u) 关于 u 单调（本曲线 y1=0≤y2=1 递增），
 * 二分求 y(u)=v 得 u，再取 t=x(u)。
 */
function revealTimeAtProgress(v: number): number {
  const [x1, y1, x2, y2] = REVEAL_EASING;
  const at = (u: number, a: number, b: number) =>
    3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  const yAt = (u: number) => at(u, y1, y2);
  const xAt = (u: number) => at(u, x1, x2);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (yAt(mid) < v) lo = mid;
    else hi = mid;
  }
  return xAt((lo + hi) / 2);
}

/** 尚未兑现的外框同步定时器；连点时上一次的作废，避免按旧几何提前翻色 */
let chromeTimer: number | null = null;

function scheduleChromeSync(delayMs: number): void {
  if (chromeTimer !== null) window.clearTimeout(chromeTimer);
  chromeTimer = window.setTimeout(() => {
    chromeTimer = null;
    syncWindowChrome();
  }, delayMs);
}

/**
 * 柔和切换：让新皮肤从点击处扩散着「揭开」整屏，而不是整页一起突变。
 * 遮罩几何算好后写进 --vt-mx/--vt-my/--vt-size，动画在 styles.css 的 vt-theme-reveal。
 * 不支持的浏览器直接应用。
 *
 * 与窗口外框（右上角的原生标题栏覆盖层 + 窗口底色）的同步策略：
 * 原生层的色变是瞬间的，没有过渡可言，想跟内容「同一时刻」，只能挑
 * 内容的圆形波前扫到屏幕顶边（覆盖层所在的那条）的那一帧翻色——
 * 原点到上两角取较远距离换算成波前进度，再反解成时间点，锚在
 * vt.ready（动画即将起播）上起算，而不是点击时刻，避免起播耗时累积误差。
 */
export function applyThemeSmooth(
  theme: string,
  origin?: ThemeSwitchOrigin,
  onSettled?: () => void,
): void {
  const key = normalizeTheme(theme);
  const root = document.documentElement;

  // 连点保护：上一次还没兑现的外框同步直接作废
  if (chromeTimer !== null) {
    window.clearTimeout(chromeTimer);
    chromeTimer = null;
  }

  // 用 || 而非 ??：键盘触发时 clientX/clientY 是 0，此时从屏幕中心漾开
  const x = origin?.x || window.innerWidth / 2;
  const y = origin?.y || window.innerHeight / 2;

  // 半径取到最远角的距离，再留 10% 余量：结尾时遮罩要彻底盖满，否则角落会漏出旧色
  const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const r = reach * 1.1;

  root.style.setProperty('--vt-mx', `${x - r}px`); // mask-position 收的是左上角
  root.style.setProperty('--vt-my', `${y - r}px`);
  root.style.setProperty('--vt-size', `${r * 2}px`);

  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => {
      ready: Promise<void>;
      finished: Promise<void>;
    };
  };
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 无过渡能力 / 减少动态：内容即时换肤，外框同步即时换，不存在错位窗口
  if (!doc.startViewTransition || reduced) {
    root.dataset.theme = key;
    syncWindowChrome();
    onSettled?.();
    return;
  }

  // 波前扫到顶边的时刻：进度 = 顶边较远角距离 / 满圆半径，反解成时间
  const dTop = Math.max(Math.hypot(x, y), Math.hypot(window.innerWidth - x, y));
  const delayMs = revealTimeAtProgress(Math.min(1, dTop / r)) * REVEAL_MS;

  // 更新回调只做换肤这一件事：getComputedStyle + IPC 外框同步都挪到动画时间轴上，
  // 新快照捕获前的主线程阻塞窗口才最小，起播不拖、播放不抢。
  let vt: ReturnType<NonNullable<typeof doc.startViewTransition>>;
  try {
    vt = doc.startViewTransition(() => {
      root.dataset.theme = key;
    });
  } catch {
    root.dataset.theme = key;
    syncWindowChrome();
    onSettled?.();
    return;
  }

  void vt.ready
    .then(() => scheduleChromeSync(delayMs))
    .catch(() => {
      /* 被下一次切换跳过：新一次的 ready 会接管同步 */
    });
  void vt.finished
    .then(() => onSettled?.())
    .catch(() => {
      /* finished 被跳过时也会 resolve；reject 视为无收尾 */
    });
}
