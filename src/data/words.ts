import type { Book, Word } from '../types';
import { WORDS_JUNIOR } from './words/junior';
import { WORDS_SENIOR } from './words/senior';
import { WORDS_CET4 } from './words/cet4';
import { WORDS_CET6 } from './words/cet6';
import { WORDS_KAOYAN } from './words/kaoyan';
import { WORDS_TOEFL } from './words/toefl';
import { WORDS_SAT } from './words/sat';

export const WORDS: Word[] = [
  ...WORDS_JUNIOR,
  ...WORDS_SENIOR,
  ...WORDS_CET4,
  ...WORDS_CET6,
  ...WORDS_KAOYAN,
  ...WORDS_TOEFL,
  ...WORDS_SAT,
];

/** 按 id 快速索引（构建时检测重复 id） */
export const WORD_MAP: Record<string, Word> = (() => {
  const map: Record<string, Word> = {};
  const seen = new Set<string>();
  for (const w of WORDS) {
    if (seen.has(w.id)) {
      console.warn(`[words] 检测到重复 id：${w.id}（word="${w.word}"），后一项将覆盖前一项`);
    }
    seen.add(w.id);
    map[w.id] = w;
  }
  return map;
})();

/** 按小写词形索引，供 O(1) 查词（避免对数万词条做线性扫描） */
export const WORD_BY_TEXT: Map<string, Word> = (() => {
  const m = new Map<string, Word>();
  for (const w of WORDS) {
    const key = w.word.toLowerCase();
    if (!m.has(key)) m.set(key, w); // 同形词保留首次出现，与 WORDS 顺序一致
  }
  return m;
})();

export function findWord(text: string): Word | undefined {
  const t = text.trim().toLowerCase();
  return WORD_BY_TEXT.get(t) ?? WORD_MAP[t];
}

/** 内置词库分类元信息（用于学习范围筛选与标签展示） */
export const BOOK_META: { key: Book; label: string; tone: 'blue' | 'green' | 'orange' | 'red' | 'gray' | 'purple' }[] = [
  { key: 'junior', label: '初中', tone: 'green' },
  { key: 'senior', label: '高中', tone: 'blue' },
  { key: 'cet4', label: '四级', tone: 'blue' },
  { key: 'cet6', label: '六级', tone: 'purple' },
  { key: 'kaoyan', label: '考研', tone: 'orange' },
  { key: 'toefl', label: '托福', tone: 'purple' },
  { key: 'sat', label: 'SAT', tone: 'gray' },
];

export function bookMeta(key: Book): { label: string; tone: 'blue' | 'green' | 'orange' | 'red' | 'gray' | 'purple' } {
  return BOOK_META.find((b) => b.key === key) ?? { label: key, tone: 'gray' };
}
