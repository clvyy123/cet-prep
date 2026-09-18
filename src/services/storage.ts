import type { Book, Settings, DailyActivity, Word, WordProgress, Level } from '../types';
import { WORDS, findWord } from '../data/words';
import { DEFAULT_THEME } from '../theme';

export const KEYS = {
  words: 'cet_words',
  progress: 'cet_progress',
  settings: 'cet_settings',
  activity: 'cet_activity',
  exams: 'cet_exams',
  mistakes: 'cet_mistakes',
  forget: 'cet_forget',
  paperAnswers: 'cet_paper_answers',
  seedVersion: 'cet_seed_version',
  /** S2 今日任务卡：当日计划快照 */
  taskPlan: 'cet_task_plan',
  /** S2 任务完成历史（date -> true），本周计划完成度用 */
  taskHistory: 'cet_task_history',
  /** 「一键继续上次」记录的最近任务页 */
  lastVisit: 'cet_last_visit',
  /** S4 首启引导完成标记 */
  onboarded: 'cet_onboarded',
  /** 日历标记（date -> 'study' | 'rest'），Dashboard 日历面板的学习/休息日期 */
  dayMarks: 'cet_day_marks',
  /** 考试时间同步插件：爬取到的四六级考试时间（笔试/口试） */
  examSchedule: 'cet_exam_schedule',
} as const;

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('保存失败', e);
    return false;
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const DEFAULT_SETTINGS: Settings = {
  dailyGoal: 30,
  ttsRate: 1,
  ttsVoice: '',
  theme: DEFAULT_THEME,
  examLevel: 4,
  targetScore: 425,
  /** 自定义考试日期 YYYY-MM-DD；留空 = 使用 src/data/exam-dates.ts 的官方常量 */
  examDate: '',
  /** 考试时间同步插件的爬取周期（小时），默认每天一次 */
  examSyncHours: 24,
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
};

export function getSettings(): Settings {
  const loaded = load<Partial<Settings>>(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...loaded, ai: { ...DEFAULT_SETTINGS.ai, ...loaded.ai } };
}

export function saveSettings(s: Settings): boolean {
  return save(KEYS.settings, s);
}

// ============ 学习活动记录 ============
/** 本地日期键 YYYY-MM-DD（学习活动记录的唯一分组依据） */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function getActivity(): Record<string, DailyActivity> {
  return load<Record<string, DailyActivity>>(KEYS.activity, {});
}

export function addActivity(partial: Partial<DailyActivity>): void {
  const act = getActivity();
  const key = todayKey();
  const cur = act[key] ?? { learned: 0, reviewed: 0, practiced: 0, correct: 0, wrong: 0 };
  act[key] = {
    learned: cur.learned + (partial.learned ?? 0),
    reviewed: cur.reviewed + (partial.reviewed ?? 0),
    practiced: cur.practiced + (partial.practiced ?? 0),
    correct: cur.correct + (partial.correct ?? 0),
    wrong: cur.wrong + (partial.wrong ?? 0),
  };
  save(KEYS.activity, act);
}

export function getRecentActivity(days: number): { date: string; act: DailyActivity }[] {
  const act = getActivity();
  const result: { date: string; act: DailyActivity }[] = [];
  const base = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    result.push({
      date: key,
      act: act[key] ?? { learned: 0, reviewed: 0, practiced: 0, correct: 0, wrong: 0 },
    });
  }
  return result;
}

export function clearAllData(): void {
  Object.values(KEYS).forEach((k) => remove(k));
}

/** 首次启动 / 词库版本升级时执行数据迁移（在页面加载词库前调用） */
const SEED_VERSION = 2;

/** 完整词库 = 内置词库（随代码发布）+ 用户词（存 localStorage） */
export function getAllWords(): Word[] {
  return [...WORDS, ...loadUserWords()];
}

/**
 * 单行文本规范化（展示/入库通用的兜底清洗）：
 * - 零宽字符、控制字符直接删除；
 * - 换行、制表符、全角空格等折叠为单个半角空格；
 * - 去掉首尾空白。
 * 保证任何来源的文本字段都不会把「换行/不可见字符」带进展示与存储。
 */
export function normalizeSingleLine(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u2028\u2029\uFEFF]/g, '')
    .replace(/[\r\n\t\f\v\u3000]+/g, ' ')
    .trim();
}

/** 规范化用户词：word 折叠为无空白单行 token（与 importWordList 的入库规则一致），pos/meaning 单行化 */
function normalizeUserWord(w: Word): Word {
  const word = w.word.replace(/\s+/g, '').toLowerCase();
  const pos = normalizeSingleLine(w.pos ?? '');
  const meaning = normalizeSingleLine(w.meaning ?? '');
  if (word === w.word && pos === (w.pos ?? '') && meaning === (w.meaning ?? '')) return w;
  return { ...w, word, pos, meaning };
}

/** 仅用户自建 / 导入的词（读取时统一规范化，兜住历史遗留脏数据） */
export function loadUserWords(): Word[] {
  return load<Word[]>(KEYS.words, []).map(normalizeUserWord);
}

export function saveUserWords(list: Word[]): void {
  save(KEYS.words, list);
}

/** 旧数据迁移：老版本把整个词库（含内置词）存进 localStorage，现改为只存用户词 */
function migrateSeedIfNeeded(): void {
  const ver = load<number>(KEYS.seedVersion, 0);
  if (ver >= SEED_VERSION) return;
  const oldWords = load<Word[]>(KEYS.words, []);
  const oldProgress = load<Record<string, WordProgress>>(KEYS.progress, {});
  const userWords: Word[] = [];
  const idMap: Record<string, string> = {}; // 旧内置词 id -> 新库 id（按单词文本映射）
  for (const w of oldWords) {
    if (!w || typeof w.word !== 'string') continue;
    if (/^w\d+$/.test(w.id)) {
      const match = findWord(w.word);
      if (match) idMap[w.id] = match.id;
    } else {
      // 用户自建/导入词：保留，并补全 book 字段（旧数据仅含 level）；文本字段统一单行化
      const legacy = w as Word & { level?: number };
      userWords.push(
        normalizeUserWord({ ...legacy, book: legacy.book ?? (legacy.level === 6 ? 'cet6' : 'cet4') })
      );
    }
  }
  const progress: Record<string, WordProgress> = {};
  for (const [oldId, p] of Object.entries(oldProgress)) {
    const newId = idMap[oldId] ?? (userWords.some((u) => u.id === oldId) ? oldId : undefined);
    if (newId) progress[newId] = p;
  }
  // 只有数据保存成功后才标记迁移完成，避免配额满导致数据永久丢失
  const okWords = save(KEYS.words, userWords);
  const okProgress = save(KEYS.progress, progress);
  if (okWords && okProgress) {
    save(KEYS.seedVersion, SEED_VERSION);
  }
}

export function ensureSeeded(): void {
  migrateSeedIfNeeded();
}

// ============ 数据导出 / 导入 ============
export function exportAll(): string {
  const dump: Record<string, unknown> = {};
  Object.values(KEYS).forEach((k) => {
    const v = localStorage.getItem(k);
    if (v === null) return;
    try {
      dump[k] = JSON.parse(v);
    } catch {
      // 跳过损坏的 key，不影响其他数据导出
    }
  });
  return JSON.stringify(dump, null, 2);
}

export function importAll(json: string): boolean {
  try {
    const dump = JSON.parse(json) as Record<string, unknown>;
    const validKeys = new Set(Object.values(KEYS));
    Object.entries(dump).forEach(([k, v]) => {
      // 仅导入已知的 key，避免写入脏数据
      if (validKeys.has(k as (typeof KEYS)[keyof typeof KEYS])) save(k, v);
    });
    // 导入旧数据后触发迁移
    migrateSeedIfNeeded();
    return true;
  } catch {
    return false;
  }
}
