/**
 * 内置题库（src/data/builtin-banks.ts，66 套）修复：
 *   1. 选项缺失 — 从真题卷 OCR 原文 / papers.ts 补齐被丢掉的 C、D 选项
 *   2. 空格间断 — 选词填空篇章的 `____` 补上题号（`___26___`…`___35___`）
 *   3. 内容冗余 — 清页眉页脚、混入解析的词汇表、「题干译文」前缀
 *   4. 信息缺失 — 只在答案为空时回填（已有答案一律不动）
 *
 * 用法：node scripts/fix-builtin-banks.mjs [--apply]
 */
import fs from 'node:fs';
import { loadTestOcr } from './lib-parse-testocr.mjs';
import { fixEnSpacing, buildVocab } from './lib-spacing.mjs';

const APPLY = process.argv.includes('--apply');
const FILE = 'src/data/builtin-banks.ts';
const src = fs.readFileSync(FILE, 'utf8');
// 注意：不能简单取 'BUILTIN_BANKS' 之后的第一个 '[' —— 那是类型标注 BuiltinBank[] 里的括号
const declIdx = src.indexOf('BUILTIN_BANKS');
const eqIdx = src.indexOf('= [', declIdx);
if (declIdx === -1 || eqIdx === -1) throw new Error('未找到 BUILTIN_BANKS 声明');
const headEnd = eqIdx + 2; // 指向数组字面量的 '['
const tailStart = src.lastIndexOf('];') + 1;
const BANKS = eval(src.slice(headEnd, tailStart));

/* papers.ts：答案与选项的第二数据源 */
const pt = fs.readFileSync('src/data/papers.ts', 'utf8');
const PAPERS = JSON.parse(pt.slice(pt.indexOf('Paper[] = [') + 'Paper[] = '.length, pt.lastIndexOf('];') + 1));
buildVocab(PAPERS);
const paperById = new Map(PAPERS.map((p) => [p.id, p]));
/** paperId -> num -> {options:{A..D}, answer} */
const paperQ = new Map();
for (const p of PAPERS) {
  const m = new Map();
  for (const sec of p.sections || [])
    for (const b of sec.blocks || [])
      for (const q of b.questions || []) m.set(q.num, q);
  paperQ.set(p.id, m);
}

const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * 选项文本整形：OCR 会把词间空格写成连字符，还会把卷面指令串进选项末尾。
 *   "-8)-His-GPS-system-went out of-order;--" → "His GPS system went out of order."
 *   "Customers in a hurry. At the end of each conversation," → "Customers in a hurry."
 */
function tidyOption(v) {
  if (typeof v !== 'string') return v;
  let o = v.trim();
  o = o.replace(/(?:\s*At the end of each (?:conversation|passage|news report),?).*$/i, '');
  const hyphenGarbage = /^-\d+\)-/.test(o) || (o.match(/-/g) || []).length >= 3;
  if (hyphenGarbage) {
    o = o.replace(/-{2,}$/, '');
    o = o.replace(/^\s*-?\d*\)?-\s*/, '');
    o = o.replace(/-/g, ' ').replace(/\s{2,}/g, ' ');
  }
  o = o.replace(/[;:]+\s*$/, '');
  o = o.replace(/\s{2,}/g, ' ').trim();
  return o;
}
const r = {
  optFilled: 0,
  optRepaired: 0,
  blankNumbered: 0,
  answerFilled: 0,
  redundancy: 0,
  spacing: 0,
  unmatched: [],
  details: [],
};

const stripPageNo = (s) => s.replace(/[【\[]\s*第\s*\d+\s*页\s*[\]】]/g, ' ');
const VOCAB_RUN =
  /(?:[·•・]\s*[A-Za-z][A-Za-z\s'-]{1,20}\s*(?:adj|adv|n|v|vt|vi|prep|conj|pron)\s*[.．:：]\s*[^\s·•][^\n·•]{0,40}\s*){2,}/g;

function cleanText(v) {
  if (typeof v !== 'string' || !v.trim()) return v;
  let o = stripPageNo(v);
  o = o.replace(VOCAB_RUN, ' ');
  o = o.replace(/^\s*(?:题干译文|题干翻译|答案解[折析]|答案解析)\s*[:：]?\s*/, '');
  o = o.replace(/\s{2,}/g, ' ').trim();
  return o;
}

for (const bk of BANKS) {
  const key = bk.meta.id.replace(/^bi-/, '');
  const paper = paperById.get(key);
  const pq = paperQ.get(key);
  const keyShort = key.replace(/^cet[46]-/, '');
  const ocr = loadTestOcr(bk.meta.level, keyShort);

  /* ---------- 听力 / 仔细阅读：选项 ---------- */
  const sets = [
    ...(bk.listening || []).flatMap((L) => (L.questions || []).map((q) => ({ q, kind: 'L' }))),
    ...(bk.reading || []).flatMap((rd) => (rd.questions || []).map((q) => ({ q, kind: 'R' }))),
  ];
  for (const { q, kind } of sets) {
    if (Array.isArray(q.options)) q.options = q.options.map(tidyOption);
    const want4 = (ocr?.options.get(q.num) && Object.values(ocr.options.get(q.num))) || null;
    const fromPaper = pq?.get(q.num);
    const paperOpts = fromPaper && Object.keys(fromPaper.options || {}).length === 4 ? fromPaper.options : null;

    if (kind === 'R' && want4 && Object.keys(want4).length === 4 && (q.options || []).length === 4) {
      // 仔细阅读：卷面原文可用时，仅修正空格，不改内容
      for (let i = 0; i < 4; i++) {
        const want = [want4.A, want4.B, want4.C, want4.D][i];
        if (want && q.options[i] !== want && normKey(q.options[i]) === normKey(want)) {
          q.options[i] = want;
          r.optRepaired++;
        }
      }
    }

    if ((q.options || []).length !== 4) {
      const cur = q.options || [];
      let nextOpts = null;
      let from = '';
      if (want4 && [want4.A, want4.B, want4.C, want4.D].every((v) => typeof v === 'string' && v.trim())) {
        nextOpts = [want4.A, want4.B, want4.C, want4.D];
        from = '卷面OCR';
      } else if (paperOpts && [paperOpts.A, paperOpts.B, paperOpts.C, paperOpts.D].every((v) => typeof v === 'string' && v.trim())) {
        nextOpts = [paperOpts.A, paperOpts.B, paperOpts.C, paperOpts.D];
        from = 'papers.ts';
      }
      if (nextOpts) {
        // 已有的选项如果与新选项去空格后一致，保留原文，只补齐缺失的
        const merged = nextOpts.slice();
        for (const c of cur) {
          const i = merged.findIndex((m) => normKey(m) === normKey(c));
          if (i !== -1 && normKey(c)) merged[i] = c;
        }
        q.options = merged;
        r.optFilled++;
        r.details.push(`${bk.meta.id} ${kind}#${q.num} 选项 ${cur.length}→4（源：${from}）`);
      } else {
        r.unmatched.push(`${bk.meta.id} ${kind}#${q.num} 只有 ${cur.length} 个选项且无来源`);
      }
    }

    /* ---------- 信息缺失：只填空着的答案 ---------- */
    if (!q.answer && fromPaper?.answer) {
      q.answer = fromPaper.answer;
      r.answerFilled++;
    }
  }

  /* ---------- 长篇阅读：只填空着的答案 ---------- */
  for (const lg of bk.long || []) {
    for (const st of lg.statements || []) {
      if (!st.answer && pq?.get(st.num)?.answer) {
        st.answer = pq.get(st.num).answer;
        r.answerFilled++;
      }
    }
  }

  /* ---------- 选词填空：空格编号 + 词库 ---------- */
  for (const bd of bk.banked || []) {
    const p2 = paper?.sections?.flatMap((s) => s.blocks || []).find((b) => b.id.includes('banked'));
    if (bd.passage && !/_{2,}\s*\d+\s*_{2,}/.test(bd.passage)) {
      let i = 0;
      bd.passage = bd.passage.replace(/_{2,}/g, () => `___${26 + i++}___`);
      r.blankNumbered++;
      r.details.push(`${bk.meta.id} 选词填空空格编号 ${i} 个`);
    }
    // 词库缺项时从 papers.ts 补
    if (p2?.wordBank && Array.isArray(bd.words) && bd.words.length < 15) {
      const have = new Set(bd.words.map((w) => normKey(w)));
      for (const w of Object.values(p2.wordBank)) if (!have.has(normKey(w))) bd.words.push(w);
    }
  }

  /* ---------- 内容冗余 + 空格 ---------- */
  const cleanField = (obj, f) => {
    if (typeof obj?.[f] !== 'string') return;
    const o = cleanText(obj[f]);
    if (o !== obj[f]) {
      obj[f] = o;
      r.redundancy++;
    }
  };
  for (const L of bk.listening || []) {
    cleanField(L, 'transcript');
    for (const q of L.questions || []) cleanField(q, 'analysis');
  }
  for (const rd of bk.reading || []) {
    cleanField(rd, 'passage');
    for (const q of rd.questions || []) cleanField(q, 'analysis');
  }
  for (const bd of bk.banked || []) {
    cleanField(bd, 'passage');
    cleanField(bd, 'analysis');
    if (Array.isArray(bd.analysisList)) bd.analysisList = bd.analysisList.map(cleanText);
  }
  for (const lg of bk.long || []) {
    if (Array.isArray(lg.paragraphs)) lg.paragraphs = lg.paragraphs.map(cleanText);
    for (const st of lg.statements || []) cleanField(st, 'text');
  }
  for (const tr of bk.translation || []) cleanField(tr, 'reference');
  for (const wr of bk.writing || []) cleanField(wr, 'sample');

  /* ---------- 空格间断 ---------- */
  for (const rd of bk.reading || []) {
    if (typeof rd.passage === 'string') {
      const n = fixEnSpacing(rd.passage);
      if (n !== rd.passage) {
        rd.passage = n;
        r.spacing++;
      }
    }
  }
  for (const L of bk.listening || []) {
    if (typeof L.transcript === 'string') {
      const n = fixEnSpacing(L.transcript);
      if (n !== L.transcript) {
        L.transcript = n;
        r.spacing++;
      }
    }
    for (const q of L.questions || []) {
      if (typeof q.question === 'string' && q.question) {
        const n = fixEnSpacing(q.question);
        if (n !== q.question) {
          q.question = n;
          r.spacing++;
        }
      }
      if (Array.isArray(q.options)) q.options = q.options.map((o) => (typeof o === 'string' ? fixEnSpacing(o) : o));
    }
  }
  for (const bd of bk.banked || []) {
    if (typeof bd.passage === 'string') {
      const n = fixEnSpacing(bd.passage);
      if (n !== bd.passage) {
        bd.passage = n;
        r.spacing++;
      }
    }
    if (Array.isArray(bd.words)) bd.words = bd.words.map((w) => (typeof w === 'string' ? fixEnSpacing(w) : w));
  }
}

console.log(`套数 ${BANKS.length}`);
console.log(`选项补齐 ${r.optFilled} 题，选项空格修正 ${r.optRepaired} 处`);
console.log(`选词填空空格编号 ${r.blankNumbered} 篇`);
console.log(`答案回填 ${r.answerFilled} 个（仅补空缺）`);
console.log(`冗余清理 ${r.redundancy} 处，空格修复 ${r.spacing} 处`);
if (r.details.length) console.log('\n明细样例：\n  ' + r.details.slice(0, 12).join('\n  '));
if (r.unmatched.length) console.log('\n无法自动补齐：\n  ' + r.unmatched.join('\n  '));

if (APPLY) {
  const body = JSON.stringify(BANKS, null, 2);
  const next = src.slice(0, headEnd) + body + src.slice(tailStart);
  fs.writeFileSync(FILE, next, 'utf8');
  console.log(`\n已写回 ${FILE}（${(next.length / 1024 / 1024).toFixed(2)} MB）`);
} else {
  console.log('\n[dry-run] 加 --apply 生效');
}
