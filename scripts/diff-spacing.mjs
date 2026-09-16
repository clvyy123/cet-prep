/** 打印 fixEnSpacing 的全部改动（前后对照），用于人工抽查 */
import fs from 'node:fs';
import { fixEnSpacing, buildVocab } from './lib-spacing.mjs';

const t = fs.readFileSync('src/data/papers.ts', 'utf8');
const PAPERS = JSON.parse(t.slice(t.indexOf('Paper[] = [') + 'Paper[] = '.length, t.lastIndexOf('];') + 1));
buildVocab(PAPERS);

const max = Number(process.argv[2] || 40);
const only = process.argv[3]; // 可选：只看某个字段
let n = 0;

/** 找出第一处不同的片段上下文 */
function diffCtx(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const s = Math.max(0, i - 55);
  return { before: a.slice(s, i + 55).replace(/\n/g, '⏎'), after: b.slice(s, i + 55).replace(/\n/g, '⏎') };
}

function check(paperId, label, field, v) {
  if (typeof v !== 'string' || !v.trim()) return;
  if (only && field !== only) return;
  const nv = fixEnSpacing(v);
  if (nv === v) return;
  n++;
  if (n > max) return;
  const d = diffCtx(v, nv);
  console.log(`\n── ${paperId} ${label}.${field}`);
  console.log(`   - ${d.before}`);
  console.log(`   + ${d.after}`);
}

for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      for (const f of ['material', 'prompt', 'reference', 'sample']) check(p.id, b.id, f, b[f]);
      for (const [L, w] of Object.entries(b.wordBank || {})) {
        const nw = fixEnSpacing(w);
        if (nw !== w) {
          n++;
          if (n <= max) console.log(`\n── ${p.id} ${b.id}.wordBank.${L}\n   - ${w}\n   + ${nw}`);
        }
      }
      for (const q of b.questions || []) {
        check(p.id, `${b.id}#${q.num}`, 'stem', q.stem);
        for (const [L, v] of Object.entries(q.options || {})) check(p.id, `${b.id}#${q.num}`, `opt${L}`, v);
      }
    }
  }
}
console.log(`\n共 ${n} 处改动`);
