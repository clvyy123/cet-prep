import type { MistakeItem, MistakeSourceType } from '../types';
import { WORD_BY_TEXT } from '../data/words';
import { load, save, KEYS } from './storage';

// ============ 错题本存储 ============
export function loadMistakes(): MistakeItem[] {
  return load<MistakeItem[]>(KEYS.mistakes, []);
}

export function saveMistakes(list: MistakeItem[]): void {
  save(KEYS.mistakes, list);
}

export type MistakeInput = Omit<MistakeItem, 'id' | 'addedAt' | 'mastered'>;

export function mistakeKey(item: Pick<MistakeItem, 'sourceType' | 'sourceId' | 'questionId'>): string {
  return `${item.sourceType}:${item.sourceId}:${item.questionId}`;
}

/** 添加错题；已存在时返回 false */
export function addMistake(item: MistakeInput): boolean {
  const list = loadMistakes();
  const key = mistakeKey(item);
  if (list.some((m) => mistakeKey(m) === key)) return false;
  const entry: MistakeItem = {
    ...item,
    id: `m-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    addedAt: Date.now(),
    mastered: false,
  };
  list.unshift(entry);
  saveMistakes(list);
  return true;
}

export function hasMistake(item: Pick<MistakeItem, 'sourceType' | 'sourceId' | 'questionId'>): boolean {
  const key = mistakeKey(item);
  return loadMistakes().some((m) => mistakeKey(m) === key);
}

export function removeMistake(id: string): void {
  saveMistakes(loadMistakes().filter((m) => m.id !== id));
}

export function toggleMastered(id: string): void {
  const list = loadMistakes();
  const target = list.find((m) => m.id === id);
  if (!target) return;
  target.mastered = !target.mastered;
  saveMistakes(list);
}

// ============ 高频词 / 易错词梳理（本地词频） ============
const STOP_WORDS = new Set(
  (
    'the a an and or but of to in on at for with by from as is are was were be been being ' +
    'it its this that these those i you he she we they them his her their our your my me him us ' +
    'do does did done doing have has had having will would shall should can could may might must ' +
    'not no nor so if then than too very just also only more most much many some any all each ' +
    'about into over under between through during before after against while because when where ' +
    'what who whom which how why there here out up down off again once etc s t don doesnt didnt ' +
    "isn't"
  ).split(' ')
);

export interface FreqWord {
  word: string;
  count: number;
  inBank: boolean;
  meaning?: string;
}

/** 从英文文本中提取高频词（过滤停用词，合并内置词库释义） */
export function extractFrequentWords(text: string, topN = 12): FreqWord[] {
  const tokens = text.toLowerCase().match(/[a-z][a-z']{2,}/g) ?? [];
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (STOP_WORDS.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w, count]) => {
      const entry = WORD_BY_TEXT.get(w);
      return {
        word: w,
        count,
        inBank: !!entry,
        meaning: entry ? `${entry.pos} ${entry.meaning}` : undefined,
      };
    });
}
