// 详细分析剩余 144 个非答案类问题的分布
import fs from 'node:fs';
const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const arrEnd = src.lastIndexOf('];');
const banks = eval(src.slice(arrStart, arrEnd + 1));

const hasHan = (s) => /[\u4e00-\u9fff]/.test(s || '');
const detail = {}; // 分类 -> {套题ID: 具体描述}

function add(cat, bankId, desc) {
  if (!detail[cat]) detail[cat] = {};
  if (!detail[cat][bankId]) detail[cat][bankId] = [];
  detail[cat][bankId].push(desc);
}

for (const b of banks) {
  const id = b.meta.id;
  const lv = b.meta.level === 4 ? '四级' : '六级';
  const set = id.replace(`bi-cet${b.meta.level}-`, '').replace('_', '-').replace('_', '/');

  // ---------- 听力 ----------
  const lst = b.listening[0];
  if (lst) {
    const qs = lst.questions || [];
    if (qs.length < 25) add('听力题数不足', id, `只有${qs.length}题（应25题）`);
    for (const q of qs) {
      if (!q.question || !q.question.trim()) add('听力题干空', id, `Q${q.num} 题干为空`);
      if (q.options.length !== 4) add('听力选项异常', id, `Q${q.num} 只有${q.options.length}个选项`);
    }
    // 题干空的比例
  } else {
    add('无听力', id, '整个 listening 数组为空');
  }

  // ---------- 选词填空 ----------
  const bk = b.banked[0];
  if (bk) {
    if ((bk.words || []).length < 10) add('选词词库不足', id, `词库${bk.words?.length}个（应≥10）`);
    if ((bk.answers || []).length < 10) add('选词答案不足', id, `答案${bk.answers?.length}个（应≥10）`);
  } else {
    add('无选词填空', id, 'banked 数组为空');
  }

  // ---------- 长阅读 ----------
  if ((b.long || []).length === 0) add('无长阅读', id, 'long 数组为空');
  else {
    const l0 = b.long[0];
    if ((l0.statements || []).length < 10) add('长阅读题数不足', id, `只有${l0.statements?.length}题`);
    if ((l0.paragraphs || []).length < 1) add('长阅读无段落', id, '段落数为0');
  }

  // ---------- 仔细阅读 ----------
  for (const r of (b.reading || [])) {
    const pid = r.id || id;
    const tag = pid.includes('-rd-') ? `P${pid.split('-rd-')[1]}` : '';
    if (!r.passage || r.passage.length < 200) add('阅读passage短', id, `${tag} 正文仅${r.passage?.length || 0}字符`);
    if (hasHan(r.passage)) add('阅读混中文', id, `${tag} 正文含中文`);
    for (const q of (r.questions || [])) {
      if (q.options.length !== 4) add('阅读选项异常', id, `${tag} Q${q.num} 只有${q.options.length}个选项`);
    }
    if ((r.questions || []).length !== 5) add('阅读题数异常', id, `${tag} 有${r.questions?.length}题（应5题）`);
  }
  if ((b.reading || []).length === 0) add('无仔细阅读', id, 'reading 数组为空');

  // ---------- 翻译 ----------
  if (!(b.translation[0]?.prompt)) add('无翻译', id, 'translation 为空或 prompt 缺失');
}

// ---------- 输出 ----------
const cats = Object.keys(detail).sort();
let grandTotal = 0;
for (const cat of cats) {
  const sets = Object.keys(detail[cat]);
  const total = sets.reduce((s, k) => s + detail[cat][k].length, 0);
  grandTotal += total;
  console.log(`\n=== ${cat}: ${total} 处 / ${sets.length} 套 ===`);
  for (const s of sets.sort()) {
    for (const d of detail[cat][s]) console.log(`  ${s.replace('bi-cet4-','四级 ').replace('bi-cet6-','六级 ')}: ${d}`);
  }
}
console.log(`\n总计: ${grandTotal} 处`);
