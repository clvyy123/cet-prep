import type {
  ReadingPassage,
  BankedCloze,
  LongReading,
  TranslationItem,
  WritingItem,
} from '../types';
import { BUILTIN_BANKS, type BuiltinBank } from '../data/builtin-banks';

/** 供「真题练习」读取的题库（内置真题） */
export function buildBanks() {
  const builtin = <T>(k: keyof BuiltinBank) => BUILTIN_BANKS.flatMap((b) => b[k] as T[]);
  return {
    banked: builtin<BankedCloze>('banked'),
    longreading: builtin<LongReading>('long'),
    reading: builtin<ReadingPassage>('reading'),
    translation: builtin<TranslationItem>('translation'),
    writing: builtin<WritingItem>('writing'),
  };
}

/** 从内置题库 id 提取套卷年份：bi-cet4-2021_06_1-lst-2 -> 2021 */
export function yearOf(id: string): number | null {
  const m = id.match(/-(20\d{2})_/);
  return m ? Number(m[1]) : null;
}

/** 一组数据的可选年份列表（降序去重，新→旧） */
export function yearsOf(items: { id: string }[]): number[] {
  return Array.from(new Set(items.map((x) => yearOf(x.id)).filter((y): y is number => y != null))).sort((a, b) => b - a);
}
