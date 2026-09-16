import type { Book, Word } from '../types';
import { WORD_BY_TEXT } from '../data/words';
import { getAllWords, loadUserWords, saveUserWords } from './storage';
import { chat, isAIReady } from './ai';

// ============ 词典查询 ============
export interface DictEntry {
  word: string;
  phonetic?: string;
  meanings: { pos?: string; definitions: string[] }[];
  examples?: string[];
  source: 'online' | 'local';
}

interface RawDef {
  definition?: string;
  example?: string;
}
interface RawMeaning {
  partOfSpeech?: string;
  definitions?: RawDef[];
}
interface RawEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: RawMeaning[];
}

/** 有道词典（国内可直连，无需密钥） */
async function lookupYoudao(word: string): Promise<DictEntry | null> {
  try {
    const res = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ukphone?: string;
      usphone?: string;
      ec?: { word?: { trs?: { tr?: { l?: { i?: string[] } }[] }[] }[] };
    };
    const trs = data.ec?.word?.[0]?.trs ?? [];
    const definitions = trs
      .flatMap((t) => (t.tr ?? []).flatMap((r) => r.l?.i ?? []))
      .filter(Boolean);
    if (definitions.length === 0) return null;
    const phonetic = data.ukphone || data.usphone || '';
    return {
      word,
      phonetic,
      meanings: [{ pos: '', definitions: definitions.slice(0, 6) }],
      source: 'online',
    };
  } catch {
    return null;
  }
}

/** 免费 Dictionary API（海外服务，需可访问外网） */
async function lookupDictionaryApi(word: string): Promise<DictEntry | null> {
  const w = word.toLowerCase().trim();
  if (!w || !/^[a-z'\- ]+$/.test(w)) return null;
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
    if (!res.ok) return null;
    const arr = (await res.json()) as RawEntry[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const e = arr[0];
    const phonetic = e.phonetic || e.phonetics?.find((p) => p.text)?.text || '';
    const meanings = (e.meanings ?? [])
      .map((m) => ({
        pos: m.partOfSpeech,
        definitions: (m.definitions ?? []).map((d) => d.definition).filter((d): d is string => !!d).slice(0, 3),
        examples: (m.definitions ?? []).map((d) => d.example).filter((d): d is string => !!d).slice(0, 2),
      }))
      .filter((m) => m.definitions.length > 0);
    if (meanings.length === 0) return null;
    return {
      word: e.word,
      phonetic,
      meanings,
      examples: meanings.flatMap((m) => m.examples ?? []).slice(0, 3),
      source: 'online',
    };
  } catch {
    return null;
  }
}

/** 使用已配置的 AI 服务查词（国内可用 DeepSeek 等） */
async function lookupWithAI(word: string): Promise<DictEntry | null> {
  if (!isAIReady()) return null;
  try {
    const raw = await chat([
      {
        role: 'system',
        content:
          '你是一个英语词典。请给出单词的音标、词性与中文释义。只输出严格 JSON，不要输出其他内容：' +
          '{"phonetic":"音标或空","meanings":[{"pos":"词性","definitions":["释义1","释义2"]}]}',
      },
      { role: 'user', content: word },
    ]);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      phonetic?: string;
      meanings?: { pos?: string; definitions?: string[] }[];
    };
    const meanings = (parsed.meanings ?? [])
      .map((m) => ({ pos: m.pos ?? '', definitions: (m.definitions ?? []).filter(Boolean) }))
      .filter((m) => m.definitions.length > 0);
    if (meanings.length === 0) return null;
    return { word, phonetic: parsed.phonetic ?? '', meanings, source: 'online' };
  } catch {
    return null;
  }
}

/** 在线查词：有道（国内）→ Dictionary API（外网）→ AI（已配置时） */
export async function lookupOnline(word: string): Promise<DictEntry | null> {
  return (await lookupYoudao(word)) ?? (await lookupDictionaryApi(word)) ?? (await lookupWithAI(word));
}

/** 本地内置词库查询 */
export function lookupLocal(word: string): DictEntry | null {
  const w = word.toLowerCase().trim();
  if (!w) return null;
  const entry = WORD_BY_TEXT.get(w);
  if (!entry) return null;
  return {
    word: entry.word,
    meanings: [{ pos: entry.pos, definitions: [entry.meaning] }],
    examples: entry.example ? [entry.example] : [],
    source: 'local',
  };
}

/** 优先在线、失败回退本地 */
export async function lookupWord(word: string): Promise<DictEntry | null> {
  return (await lookupOnline(word)) ?? lookupLocal(word);
}

/** 从选中文本中提取首个英文单词 */
export function pickWord(text: string): string {
  const m = text.match(/[a-zA-Z][a-zA-Z'\-]*/);
  return m ? m[0].toLowerCase() : '';
}

/** 批量导入单词到词库（自动去重），返回统计 */
export function importWordList(
  words: { word: string }[],
  book: Book = 'cet4'
): { added: string[]; skipped: string[] } {
  const existing = new Set(getAllWords().map((w) => w.word.toLowerCase()));
  const list = loadUserWords();
  const added: string[] = [];
  const skipped: string[] = [];
  const base = Date.now();
  for (const { word } of words) {
    const w = word.toLowerCase().replace(/[^a-z'\-]/g, '');
    if (!w) continue;
    if (existing.has(w)) {
      skipped.push(w);
      continue;
    }
    list.push({
      id: `w-img-${base}-${added.length}`,
      word: w,
      book,
      pos: 'n.',
      meaning: '',
    });
    existing.add(w);
    added.push(w);
  }
  saveUserWords(list);
  return { added, skipped };
}
