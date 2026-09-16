/**
 * 用全语料自建词频表，精准定位「词间空格被吞」的 OCR 粘连词。
 * 思路：合法英文词在 61 套真题里会反复出现；若一个长 token 整体从未出现过，
 * 却能切成两个高频词，则判定为粘连（handbook / workplace 这类真复合词会自然通过）。
 *
 * 用法：node scripts/detect-glued.mjs [--json out.json] [--top N]
 */
import fs from 'node:fs';

const t = fs.readFileSync('src/data/papers.ts', 'utf8');
const s = t.indexOf('Paper[] = [') + 'Paper[] = '.length;
const PAPERS = JSON.parse(t.slice(s, t.lastIndexOf('];') + 1));

/* ---------- 1. 收集语料 ---------- */
const texts = [];
for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      if (b.material) texts.push(String(b.material));
      if (b.prompt) texts.push(String(b.prompt));
      if (b.sample) texts.push(String(b.sample));
      if (b.reference) texts.push(String(b.reference));
      for (const q of b.questions || []) {
        if (q.stem) texts.push(String(q.stem));
        for (const v of Object.values(q.options || {})) texts.push(String(v));
      }
    }
  }
}
const CORPUS = texts.join('\n');

/* ---------- 2. 词频表（只收「纯字母 + 合理长度」的 token） ---------- */
const freq = new Map();
for (const m of CORPUS.matchAll(/[A-Za-z][a-z]{1,20}(?:['’][a-z]{1,4})?/g)) {
  const w = m[0].toLowerCase();
  if (w.length < 2) continue;
  freq.set(w, (freq.get(w) || 0) + 1);
}
console.log('语料词表规模:', freq.size);

/* 一个 token 是否「可信单词」：出现 >=2 次，或在 CET 词表里 */
const cetWords = new Set();
for (const f of ['cet4', 'cet6', 'toefl', 'kaoyan', 'senior', 'junior', 'sat']) {
  const p = `src/data/words/${f}.ts`;
  if (!fs.existsSync(p)) continue;
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/word:'([^']+)'/g)) cetWords.add(m[1].toLowerCase());
}
console.log('CET 词表规模:', cetWords.size);

const isWord = (w) => (freq.get(w) || 0) >= 2 || cetWords.has(w);

/* ---------- 3. 找粘连 ---------- */
/** 把 token 切成两半，两半都得是可信词，且整体不是可信词 */
function split2(w) {
  const low = w.toLowerCase();
  if (isWord(low)) return null;
  if (low.length < 7 || low.length > 26) return null;
  const cands = [];
  for (let i = 3; i <= low.length - 3; i++) {
    const a = low.slice(0, i);
    const b = low.slice(i);
    if (!isWord(a) || !isWord(b)) continue;
    // 倾向两边都常见的切法
    cands.push({ a, b, score: (freq.get(a) || 1) + (freq.get(b) || 1) });
  }
  if (!cands.length) return null;
  cands.sort((x, y) => y.score - x.score);
  return cands[0];
}

const hits = new Map(); // token -> {count, splits}
for (const m of CORPUS.matchAll(/\b[A-Za-z][A-Za-z'’]{6,30}\b/g)) {
  const w = m[0];
  const r = split2(w);
  if (!r) continue;
  const cur = hits.get(w) || { n: 0, fix: `${r.a} ${r.b}` };
  cur.n++;
  hits.set(w, cur);
}

const list = [...hits.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(`\n可疑粘连词 ${list.length} 种 / 共 ${list.reduce((a, b) => a + b[1].n, 0)} 处`);

const topArg = process.argv.indexOf('--top');
const top = topArg !== -1 ? Number(process.argv[topArg + 1]) : 60;
for (const [w, v] of list.slice(0, top)) console.log(`  ${String(v.n).padStart(3)}×  ${w.padEnd(22)} → ${v.fix}`);

const outArg = process.argv.indexOf('--json');
if (outArg !== -1) {
  fs.writeFileSync(
    process.argv[outArg + 1],
    JSON.stringify(
      list.map(([w, v]) => ({ word: w, count: v.n, fix: v.fix })),
      null,
      2
    ),
    'utf8'
  );
  console.log(`\n已写入 ${process.argv[outArg + 1]}`);
}
