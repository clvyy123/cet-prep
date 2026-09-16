import type { WordProgress, WordStatus } from '../types';

// 艾宾浩斯复习间隔（天）
export const INTERVALS = [1, 2, 4, 7, 15, 30];

export function defaultProgress(): WordProgress {
  return {
    status: 'new',
    stage: 0,
    reviewCount: 0,
    correctCount: 0,
    wrongCount: 0,
    nextReviewAt: 0,
    lastReviewAt: 0,
  };
}

export function reviewWord(p: WordProgress, correct: boolean): WordProgress {
  const now = Date.now();
  if (correct) {
    const stage = Math.min(p.stage + 1, INTERVALS.length - 1);
    const status: WordStatus = stage >= INTERVALS.length - 1 ? 'mastered' : p.status === 'new' ? 'learning' : p.status;
    // 使用递增前的 stage 作为间隔索引，保证 INTERVALS[0]=1 天的首次复习间隔生效
    const intervalIdx = Math.min(p.stage, INTERVALS.length - 1);
    return {
      ...p,
      status,
      stage,
      reviewCount: p.reviewCount + 1,
      correctCount: p.correctCount + 1,
      lastReviewAt: now,
      nextReviewAt: now + INTERVALS[intervalIdx] * 86400000,
    };
  }
  const stage = Math.max(0, p.stage - 1);
  return {
    ...p,
    status: 'learning',
    stage,
    reviewCount: p.reviewCount + 1,
    wrongCount: p.wrongCount + 1,
    lastReviewAt: now,
    nextReviewAt: now + 60 * 60 * 1000, // 1 小时后重新出现
  };
}

export function isDue(p: WordProgress | undefined): boolean {
  if (!p || p.status === 'new') return false;
  return p.nextReviewAt <= Date.now();
}
