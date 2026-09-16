// 导出指定词库的完整词汇列表（按当前数据顺序，即字母序）为 TXT。
// 用法：node scripts/export-wordlists.mjs kaoyan toefl
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('outputs/词库排序');
const LABELS = { kaoyan: '考研词汇', toefl: '托福词汇', cet4: '四级词汇', cet6: '六级词汇', junior: '初中词汇', senior: '高中词汇', sat: 'SAT词汇' };
const names = process.argv.slice(2);

if (names.length === 0) {
  console.error('用法：node scripts/export-wordlists.mjs <book> [book...]');
  process.exit(1);
}

function unesc(s) {
  return s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const name of names) {
  const file = path.resolve(`src/data/words/${name}.ts`);
  const src = fs.readFileSync(file, 'utf8');
  const rows = [];
  for (const line of src.split('\n')) {
    if (!line.startsWith("{id:'")) continue;
    const m = line.match(/^\{id:'([^']*)',word:'((?:[^'\\]|\\.)*)',book:'([^']*)',pos:'((?:[^'\\]|\\.)*)',meaning:'((?:[^'\\]|\\.)*)'\}/);
    if (!m) throw new Error(`${file} 无法解析行: ${line.slice(0, 80)}`);
    rows.push({ id: m[1], word: unesc(m[2]), book: m[3], pos: unesc(m[4]), meaning: unesc(m[5]) });
  }

  const label = LABELS[name] ?? name;
  const header = [
    `【${label}】完整词汇列表`,
    `所属词库：${label}（book key: ${name}）`,
    `词条总数：${rows.length}`,
    `排序规则：按字母顺序排列（不区分大小写；词条 ID 保持生成时的原编号，仅调整排列顺序）`,
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '序号\t单词\t词性\t释义\t词条ID',
    '-'.repeat(72),
  ];
  const body = rows.map((w, i) => [String(i + 1).padStart(4, '0'), w.word, w.pos || '-', w.meaning, w.id].join('\t'));
  const out = path.join(OUT_DIR, `词库排序-${label}.txt`);
  fs.writeFileSync(out, [...header, ...body].join('\n') + '\n', 'utf8');
  console.log(`${label}: ${rows.length} 词条 -> ${out}`);
  // 校验输出内部有序
  const keys = rows.map((w) => w.word.toLowerCase());
  let ok = true;
  for (let k = 1; k < keys.length; k++) if (keys[k] < keys[k - 1]) { ok = false; break; }
  console.log(`  有序性校验: ${ok ? '通过' : '失败'}`);
  if (!ok) process.exit(1);
}
