/**
 * 考试日期常量（S1 考试倒计时的数据源）。
 *
 * 诊断报告（S1 注）要求：2026 下半年考试日期「需核实后写死进常量，建议放 src/data/ 一并维护」。
 * 已核实 —— 教育部教育考试院《2026年下半年全国大学英语四、六级考试报名工作启动》
 * （中国教育考试网 www.neea.edu.cn，2026-09 公告）：
 *   - 笔试：2026 年 12 月 12 日（四级上午 9:00–11:20，六级下午 15:00–17:25）
 *   - 口试：2026 年 11 月 21–22 日（本产品暂不涉及口试）
 *
 * 下一考次更新点：{{EXAM_DATE}}（核实新考次公告后替换下方日期字面量，键名与结构保持不变）
 */

import type { Level } from '../types';

export interface ExamSession {
  /** 笔试日期 YYYY-MM-DD */
  date: string;
  /** 考试全称 */
  name: string;
  /** 开考时段（官方公告口径） */
  time: string;
}

export const EXAM_SESSIONS: Record<'cet4' | 'cet6', ExamSession> = {
  cet4: { date: '2026-12-12', name: '大学英语四级', time: '上午 9:00 – 11:20' },
  cet6: { date: '2026-12-12', name: '大学英语六级', time: '下午 15:00 – 17:25' },
};

/** 按数字级别（Settings.examLevel: Level = 4 | 6）取考次信息 */
export const EXAM_BY_LEVEL: Record<Level, ExamSession> = {
  4: EXAM_SESSIONS.cet4,
  6: EXAM_SESSIONS.cet6,
};

/** 距考试日（本地时区零点对齐）还有多少天；考试当天为 0，已过期为 0 */
export function daysUntilExam(dateStr: string, now = new Date()): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((target - today) / 86400000));
}
