/**
 * 考试时间同步插件（exam-sync）。
 *
 * 职责（仅限大学英语四六级，不扩展至其他考试）：
 * 1. 启动时 + 按可配置周期（Settings.examSyncHours，默认 24h）自动联网抓取
 *    中国教育考试网（neea.edu.cn）的 CET 公告，解析四六级笔试/口试考试日期；
 * 2. 结构化 JSON 持久化（KEYS.examSchedule），按「考试名称+日期+类型」去重；
 * 3. 解析失败 / 全部来源失败时输出明确错误日志，绝不写入无效数据；
 * 4. 数据变化后广播 window 事件 'cet-exam-sync'，日历模块据此同步标记。
 *
 * 日历侧只读 items 的「名称/日期/类型」三个字段做高亮，不展示爬取时间、来源等元数据。
 */

import { KEYS, load, save, dateKey } from './storage';
import { getSettings } from './storage';

/** 四六级考试时间条目：仅 三个字段（需求口径） */
export interface CetExamTime {
  /** 考试名称：四级 / 六级 */
  name: '四级' | '六级';
  /** 考试日期 YYYY-MM-DD */
  date: string;
  /** 考试类型：笔试 / 口试 */
  type: '笔试' | '口试';
}

interface ScheduleStore {
  items: CetExamTime[];
  /** 最近一次成功同步的时间戳（仅用于调度，日历不展示） */
  lastSync: number;
}

/** 抓取入口：CET 官网首页（公告列表会随考次更新）；直连公告页作为兜底 */
const HOME_URLS = ['https://cet.neea.edu.cn/', 'https://www.neea.edu.cn/'];
const FALLBACK_URLS = ['https://www.neea.edu.cn/html1/report/2609/1-1.htm'];
/** 数据变化广播事件：日历等模块监听以同步刷新标记 */
export const EXAM_SYNC_EVENT = 'cet-exam-sync';
const ANNOUNCE_LIMIT = 2; // 最多解析最近 2 篇「报名工作启动」公告（上下半年各一篇）

// ============ 网络层：Electron 走主进程代抓（免 CORS），浏览器开发环境降级 fetch ============

async function fetchText(url: string): Promise<string> {
  if (window.cetAPI?.fetchText) {
    const r = await window.cetAPI.fetchText(url);
    if (!r.ok) throw new Error(r.error);
    return r.text;
  }
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ============ 解析层 ============

/** 去标签取正文（官方页面为 UTF-8 静态 HTML，结构稳定） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');
}

function validDate(y: number, m: number, d: number): string | null {
  // 年份合理窗：上一年 ~ 未来 3 年；月日必须构成真实日期
  const nowY = new Date().getFullYear();
  if (y < nowY - 1 || y > nowY + 3) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 从公告详情页解析四六级考试时间。
 * 公告口径（以 2026 下半年为例）：
 *   「…笔试（以下简称CET）将于12月12日举行，口试（以下简称CET-SET）将于11月21日至11月22日举行…」
 *   「11月21日 英语四级口语考试（CET-SET4）」「11月22日 英语六级口语考试（CET-SET6）」
 * 年份从标题「2026年下半年…」取；笔试日期四六级同日。
 */
export function parseAnnouncement(html: string): CetExamTime[] {
  const text = htmlToText(html);
  const items: CetExamTime[] = [];

  // 年份：优先标题里的「XXXX年上/下半年…报名工作启动」，兜底正文第一个年份
  const yearM =
    text.match(/(\d{4})年[上下]半年[^。]{0,30}?四、六级考试报名工作启动/) ??
    text.match(/(\d{4})年/);
  if (!yearM) throw new Error('未找到年份');
  const year = Number(yearM[1]);

  // 笔试：四六级同日。「笔试…将于12月12日举行」或「笔试考试时间（12月12日）」
  const writtenM = text.match(/笔试[^。；]{0,40}?(\d{1,2})月(\d{1,2})日/);
  if (writtenM) {
    const date = validDate(year, Number(writtenM[1]), Number(writtenM[2]));
    if (!date) throw new Error('笔试日期不合法');
    items.push({ name: '四级', date, type: '笔试' });
    items.push({ name: '六级', date, type: '笔试' });
  }

  // 口试：优先按级别明细行（四级/六级口语考试各占一天）；兜底取「口试…X月X日至X月X日」区间（首日四级、次日六级，官方惯例）
  const oral4 = text.match(/(\d{1,2})月(\d{1,2})日\s*英语四级口语考试/);
  const oral6 = text.match(/(\d{1,2})月(\d{1,2})日\s*英语六级口语考试/);
  if (oral4) {
    const date = validDate(year, Number(oral4[1]), Number(oral4[2]));
    if (date) items.push({ name: '四级', date, type: '口试' });
  }
  if (oral6) {
    const date = validDate(year, Number(oral6[1]), Number(oral6[2]));
    if (date) items.push({ name: '六级', date, type: '口试' });
  }
  if (!oral4 || !oral6) {
    const rangeM = text.match(/口试[^。；]{0,60}?(\d{1,2})月(\d{1,2})日至(?:\d{1,2}月)?(\d{1,2})日/);
    if (rangeM) {
      const d1 = validDate(year, Number(rangeM[1]), Number(rangeM[2]));
      // 「11月21日至22日」（次月省略）与「11月21日至11月22日」两种形态都兼容
      const d2 = validDate(year, rangeM[3] ? Number(rangeM[3]) : Number(rangeM[1]), Number(rangeM[4]));
      if (d1 && !items.some((i) => i.name === '四级' && i.type === '口试')) {
        items.push({ name: '四级', date: d1, type: '口试' });
      }
      if (d2 && !items.some((i) => i.name === '六级' && i.type === '口试')) {
        items.push({ name: '六级', date: d2, type: '口试' });
      }
    }
  }

  if (items.length === 0) throw new Error('页面中未解析到四六级笔试/口试日期');
  return items;
}

/** 从官网首页/列表页提取「四六级考试报名工作启动」公告链接（绝对地址，按出现序 = 最新在前） */
export function parseAnnouncementLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*四、六级考试报名工作启动[^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(new URL(m[1], base).toString());
    } catch {
      /* 跳过非法链接 */
    }
  }
  return [...new Set(out)].slice(0, ANNOUNCE_LIMIT);
}

// ============ 存储层：按 名称+日期+类型 去重，内容无变化不落盘 ============

const dedupKey = (i: CetExamTime) => `${i.name}|${i.date}|${i.type}`;

export function getExamSchedule(): ScheduleStore {
  return load<ScheduleStore>(KEYS.examSchedule, { items: [], lastSync: 0 });
}

/** 日历读取：当月可见的四六级考试时间（调用方自行按日期匹配格子） */
export function getCetExamTimes(): CetExamTime[] {
  return getExamSchedule().items;
}

function persist(items: CetExamTime[]): boolean {
  const prev = getExamSchedule();
  const prevSet = new Set(prev.items.map(dedupKey));
  const nextSet = new Set(items.map(dedupKey));
  const changed =
    prevSet.size !== nextSet.size || items.some((i) => !prevSet.has(dedupKey(i)));
  if (!changed) {
    // 内容没变：只刷新同步时间戳，避免重复写入相同数据
    save(KEYS.examSchedule, { items: prev.items, lastSync: Date.now() });
    return false;
  }
  save(KEYS.examSchedule, { items, lastSync: Date.now() });
  window.dispatchEvent(new Event(EXAM_SYNC_EVENT));
  return true;
}

// ============ 同步主流程 ============

export interface SyncResult {
  ok: boolean;
  /** 本次写入的条数（0 = 无变化或失败） */
  written: number;
  message: string;
}

export async function syncExamSchedule(): Promise<SyncResult> {
  const today = dateKey(new Date());
  const collected = new Map<string, CetExamTime>();
  const errors: string[] = [];

  // 1) 官网首页 → 公告链接；全部失败再用兜底直连页
  let announceUrls: string[] = [];
  for (const home of HOME_URLS) {
    try {
      const html = await fetchText(home);
      announceUrls = parseAnnouncementLinks(html, home);
      if (announceUrls.length > 0) break;
      errors.push(`${home}：未发现报名公告链接`);
    } catch (e) {
      errors.push(`${home}：${(e as Error).message}`);
    }
  }
  if (announceUrls.length === 0) announceUrls = [...FALLBACK_URLS];

  // 2) 逐篇公告解析（单篇失败不拖垮整体；全部失败才算失败）
  for (const url of announceUrls) {
    try {
      const html = await fetchText(url);
      for (const item of parseAnnouncement(html)) {
        // 已过期的考次不入库，避免日历标记历史噪音
        if (item.date >= today) collected.set(dedupKey(item), item);
      }
    } catch (e) {
      errors.push(`${url}：${(e as Error).message}`);
    }
  }

  // 3) 全部来源失败 / 解析结果为空 → 明确报错，不写入任何数据
  if (collected.size === 0) {
    const msg = `[exam-sync] 四六级考试时间同步失败，未写入数据。来源错误：${errors.join('；') || '无'}`;
    console.error(msg);
    return { ok: false, written: 0, message: msg };
  }

  const items = [...collected.values()];
  const changed = persist(items);
  const msg = changed
    ? `[exam-sync] 已更新 ${items.length} 条考试时间（${items.map((i) => `${i.name}${i.type}${i.date}`).join('、')}）`
    : `[exam-sync] 考试时间无变化（${items.length} 条），跳过写入`;
  console.info(msg);
  return { ok: true, written: changed ? items.length : 0, message: msg };
}

// ============ 调度层：启动即同步一次，之后按可配置周期轮询 ============

let started = false;

/** 周期（小时）：Settings.examSyncHours，夹在 [1,168] */
export function getSyncIntervalHours(): number {
  const h = Number(getSettings().examSyncHours ?? 24);
  return Number.isFinite(h) ? Math.min(168, Math.max(1, Math.round(h))) : 24;
}

/**
 * 程序启动时调用一次。返回停止函数（应用卸载时用；App 级常驻可忽略返回值）。
 * 首次同步延后 3s 触发，避免与应用启动的网络/渲染争抢。
 */
export function startExamSync(): () => void {
  if (started) return () => {};
  started = true;
  const timer = window.setTimeout(() => {
    syncExamSchedule().catch((e) => console.error('[exam-sync] 未捕获的同步异常', e));
  }, 3000);
  const interval = window.setInterval(() => {
    syncExamSchedule().catch((e) => console.error('[exam-sync] 未捕获的同步异常', e));
  }, getSyncIntervalHours() * 3600_000);
  return () => {
    window.clearTimeout(timer);
    window.clearInterval(interval);
    started = false;
  };
}
