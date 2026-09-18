/**
 * 今日任务卡（诊断报告 S2）。
 *
 * 把 Dashboard 写死的 `const todayGoal = 30` 升级为三项任务：
 *   ① 单词 —— 动态取「SRS 到期数 + 新词配额」（配额 = 设置里的每日目标单词数）
 *   ② 听力 —— 从带音频的真题听力 section（papers.ts 内 audioUrl，79 个）按天轮转一段
 *   ③ 阅读 —— 从真题池 Part III 阅读篇章按天轮转一篇
 *
 * 实现要点：
 * - 计划按「天」生成快照落 localStorage（KEYS.taskPlan），当天目标数不随复习进度漂移；
 * - papers.ts 约 4.3MB，走动态 import 保证它仍只随用到的 chunk 解析（与 App.tsx 的
 *   按需加载约定一致），加载失败时听力/阅读任务降级为空，不影响单词任务；
 * - 三项全部完成置 allDone 并记入 KEYS.taskHistory，供 S1 倒计时旁的「本周计划完成度」。
 */
import type { DayPlan, TaskResource, WordProgress } from '../types';
import type { PageKey } from '../App';
import { KEYS, load, save, dateKey, getSettings, getAllWords } from './storage';
import { isDue } from './srs';

/** 侧栏页面的中文名（「一键继续上次」按钮文案用） */
export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: '总览',
  vocabulary: '单词记忆',
  practice: '真题练习',
  papers: '试卷',
  mistakes: '错题本',
  exam: '模拟考试',
  aireader: 'AI 阅读',
  settings: '设置',
};

/** 今天应完成的单词量：SRS 到期数 + 新词配额（配额下限 5，与设置页 min 一致） */
export function wordTarget(): { due: number; quota: number } {
  const progress = load<Record<string, WordProgress>>(KEYS.progress, {});
  const words = getAllWords();
  const due = words.filter(
    (w) => progress[w.id] && isDue(progress[w.id]) && progress[w.id].status !== 'mastered'
  ).length;
  const quota = Math.max(5, getSettings().dailyGoal);
  return { due, quota };
}

/**
 * 取今日计划；没有（或已跨天）则生成今日快照。
 * 听力/阅读的轮转索引用「Unix 天数」，同一天内稳定、跨天自动轮换。
 */
export async function ensureTodayPlan(): Promise<DayPlan> {
  const today = dateKey(new Date());
  const existing = load<DayPlan | null>(KEYS.taskPlan, null);
  if (existing && existing.date === today) return existing;

  const { due, quota } = wordTarget();
  let listening: TaskResource | null = null;
  let reading: TaskResource | null = null;

  try {
    const { PAPERS } = await import('../data/papers');
    const dayIdx = Math.floor(Date.now() / 86400000);

    // 听力：所有带音频的听力 section（同一音频文件的 variant 只计一次）
    const lis: Omit<TaskResource, 'done'>[] = [];
    const seenAudio = new Set<string>();
    for (const p of PAPERS) {
      for (const s of p.sections) {
        if (!s.audioUrl || seenAudio.has(s.audioUrl)) continue;
        seenAudio.add(s.audioUrl);
        lis.push({ paperId: p.id, paperTitle: p.title, label: `听力 · ${s.partName}` });
      }
    }
    if (lis.length) listening = { ...lis[dayIdx % lis.length], done: false };

    // 阅读：Part III 的篇章块（有材料、有小题才算「一篇」）
    const rds: Omit<TaskResource, 'done'>[] = [];
    for (const p of PAPERS) {
      for (const s of p.sections) {
        if (s.partNo !== 'III') continue;
        for (const b of s.blocks) {
          if (!b.questions.length || !b.material) continue;
          rds.push({ paperId: p.id, paperTitle: p.title, label: `阅读 · ${b.groupCn || b.label}` });
        }
      }
    }
    if (rds.length) reading = { ...rds[(dayIdx * 7 + 3) % rds.length], done: false };
  } catch {
    // papers chunk 加载失败：听/读任务降级为空，单词任务照常
  }

  const plan: DayPlan = { date: today, word: { due, quota }, listening, reading, allDone: false };
  save(KEYS.taskPlan, plan);
  return plan;
}

/** 勾选 / 取消听力或阅读任务 */
export function togglePlanTask(plan: DayPlan, kind: 'listening' | 'reading'): DayPlan {
  const cur = plan[kind];
  if (!cur) return plan;
  const next: DayPlan = { ...plan, [kind]: { ...cur, done: !cur.done } };
  save(KEYS.taskPlan, next);
  return next;
}

/** 三项全部完成：置位 allDone 并写入完成历史（幂等） */
export function recordPlanComplete(plan: DayPlan): DayPlan {
  if (plan.allDone) return plan;
  const next: DayPlan = { ...plan, allDone: true };
  save(KEYS.taskPlan, next);
  const hist = load<Record<string, boolean>>(KEYS.taskHistory, {});
  if (!hist[plan.date]) {
    hist[plan.date] = true;
    save(KEYS.taskHistory, hist);
  }
  return next;
}

/** 最近 n 天里「三项全完成」的天数（S1 倒计时旁的本周计划完成度） */
export function weekPlanDone(days = 7): { done: number; total: number } {
  const hist = load<Record<string, boolean>>(KEYS.taskHistory, {});
  const base = new Date();
  let done = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    if (hist[dateKey(d)]) done++;
  }
  return { done, total: days };
}

/** 记录最近访问的任务页（总览不算任务页）；「一键继续上次」用 */
export function recordVisit(page: PageKey): void {
  if (page === 'dashboard') return;
  save(KEYS.lastVisit, { page, at: Date.now() });
}

export function getLastVisit(): { page: PageKey; at: number } | null {
  const v = load<{ page: PageKey; at: number } | null>(KEYS.lastVisit, null);
  return v && v.page && v.page !== 'dashboard' ? v : null;
}
