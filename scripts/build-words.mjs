// 构建脚本：从英语词库 JSON 生成内置词库 TS 数据文件（src/data/words/*.ts）
// 用法：node scripts/build-words.mjs [词库输入目录]
// 默认输入目录：微信接收的 english-vocabulary-master/json
import fs from 'node:fs';
import path from 'node:path';

const INPUT_DIR =
  process.argv[2] ??
  'E:\\wxlt\\xwechat_files\\wxid_kgz5tyyssfgc22_a67c\\msg\\file\\2026-08\\english-vocabulary-master\\json';
const OUT_DIR = path.resolve('src/data/words');

const BOOKS = [
  { file: '1-初中-顺序.json', key: 'junior', constName: 'WORDS_JUNIOR', label: '初中' },
  { file: '2-高中-顺序.json', key: 'senior', constName: 'WORDS_SENIOR', label: '高中' },
  { file: '3-CET4-顺序.json', key: 'cet4', constName: 'WORDS_CET4', label: '四级' },
  { file: '4-CET6-顺序.json', key: 'cet6', constName: 'WORDS_CET6', label: '六级' },
  { file: '5-考研-顺序.json', key: 'kaoyan', constName: 'WORDS_KAOYAN', label: '考研' },
  { file: '6-托福-顺序.json', key: 'toefl', constName: 'WORDS_TOEFL', label: '托福' },
  { file: '7-SAT-顺序.json', key: 'sat', constName: 'WORDS_SAT', label: 'SAT' },
];

/** 转义单引号 / 反斜杠 / 换行，用于生成 TS 字符串字面量 */
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, ' ').replace(/\n/g, '\\n');
}

function toPos(type) {
  const t = String(type ?? '').trim();
  if (!t) return '';
  return t.endsWith('.') ? t : `${t}.`;
}

/** 同一单词在多个源词典中重复出现时，合并其释义与词性（释义最多保留 8 条） */
function convert(bookKey, raw) {
  const map = new Map(); // lowerWord -> { word, posTypes: Set, meanings: [] }
  for (const item of raw) {
    if (!item || typeof item.word !== 'string') continue;
    const word = item.word.trim();
    if (!word) continue;
    // 垃圾词条防护（源数据实跑发现两类）：word 混入中文（如 'a. 灵巧的， 熟练的'）、
    // 单字母带点的假缩写（如 'a.' → 天主教徒）。合法单字母词 'a'/'I' 不受影响。
    if (/[\u4e00-\u9fff]/.test(word) || /^[a-z]\.$/i.test(word)) continue;
    const key = word.toLowerCase();
    if (!map.has(key)) map.set(key, { word, posTypes: new Set(), meanings: [] });
    const e = map.get(key);
    const trs = Array.isArray(item.translations) ? item.translations : [];
    for (const t of trs) {
      if (t && typeof t.translation === 'string' && t.translation.trim()) {
        const m = t.translation.trim();
        if (!e.meanings.includes(m) && e.meanings.length < 8) e.meanings.push(m);
      }
      if (t && typeof t.type === 'string' && t.type.trim()) e.posTypes.add(t.type.trim());
    }
  }
  const out = [];
  for (const e of map.values()) {
    if (e.meanings.length === 0) continue;
    const pos = [...e.posTypes].map(toPos).join('/');
    out.push({
      word: e.word,
      book: bookKey,
      pos,
      meaning: e.meanings.join('；'),
    });
  }
  // 预设顺序规则：按字母序（不区分大小写）排列，再据此编号
  out.sort((a, b) => {
    const ka = a.word.toLowerCase();
    const kb = b.word.toLowerCase();
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  for (const w of out) w.id = `${bookKey}-${String(out.indexOf(w) + 1).padStart(6, '0')}`;
  return out;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let total = 0;
for (const b of BOOKS) {
  const src = path.join(INPUT_DIR, b.file);
  if (!fs.existsSync(src)) {
    console.error(`缺少输入文件: ${src}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
  const words = convert(b.key, raw);
  total += words.length;
  const lines = words.map(
    (w) =>
      `{id:'${esc(w.id)}',word:'${esc(w.word)}',book:'${w.book}',pos:'${esc(w.pos)}',meaning:'${esc(w.meaning)}'}`
  );
  const content =
    [
      '// 由 scripts/build-words.mjs 生成，勿手改',
      `import type { Word } from '../../types';`,
      '',
      `export const ${b.constName}: Word[] = [`,
      lines.join(',\n'),
      '];',
      '',
    ].join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_DIR, `${b.key}.ts`), content, 'utf8');
  console.log(`${b.label}: ${words.length} 词 -> ${b.constName}`);
}
console.log(`合计 ${total} 词`);
