// 校验「题库内置音频 key ↔ 整卷听力」是不是同一份卷：
// 题库 ListeningSet 的题干/选项/原文 与 整卷 papers.ts 的听力块做文本相似度比对。
// 用法：node scripts/check-bank-audio-match.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const cut = (f) => {
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  return JSON.parse(raw.slice(raw.indexOf('= [') + 2, raw.lastIndexOf(']') + 1));
};
const PAPERS = cut('src/data/papers.ts');
const BANKS = cut('src/data/builtin-banks.ts');

const bankSets = new Map();
for (const b of BANKS) for (const s of b.listening || []) bankSets.set(s.id, s);

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 词级 Dice 相似度，抗语序/噪声 */
function dice(a, b) {
  const A = new Map();
  for (const w of norm(a).split(' ')) if (w) A.set(w, (A.get(w) || 0) + 1);
  const B = new Map();
  for (const w of norm(b).split(' ')) if (w) B.set(w, (B.get(w) || 0) + 1);
  let inter = 0;
  let na = 0;
  let nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [w, v] of A) inter += Math.min(v, B.get(w) || 0);
  return !na || !nb ? 0 : (2 * inter) / (na + nb);
}

const targets = process.argv.slice(2);
const list = targets.length ? targets : PAPERS.map((p) => p.id);

for (const id of list) {
  const p = PAPERS.find((x) => x.id === id);
  if (!p) {
    console.log(`${id}  未找到整卷`);
    continue;
  }
  const sets = p.sections.filter((s) => s.partName === '听力理解');
  for (const sec of sets) {
    const srcKey = sec.sourceSet ? id.replace(/_\d+$/, '_' + sec.sourceSet.replace(/^第(\d)套$/, '$1')) : id;
    const bank = bankSets.get(`bi-${srcKey}-lst-2`);
    const paperQ = sec.blocks.flatMap((b) => b.questions.map((q) => q.stem || ''));
    const paperOpts = sec.blocks
      .flatMap((b) => b.questions)
      .flatMap((q) => Object.values(q.options || {}))
      .join(' ');
    const paperMat = sec.blocks.map((b) => b.material || '').join(' ');
    if (!bank) {
      console.log(`${id}${sec.sourceSet ? ' [' + sec.sourceSet + ']' : ''}  题库无 bi-${srcKey}-lst-2 → 无内置音频可复用`);
      continue;
    }
    const bankQ = (bank.questions || []).map((q) => q.question || '').join(' ');
    const bankOpts = (bank.questions || []).flatMap((q) => q.options || []).join(' ');
    console.log(
      `${id}${sec.sourceSet ? ' [' + sec.sourceSet + ']' : ''}  → bi-${srcKey}-lst-2 | 题干 ${(dice(bankQ, paperQ) * 100).toFixed(0)}% 选项 ${(dice(bankOpts, paperOpts) * 100).toFixed(0)}% 原文 ${(dice(bank.transcript, paperMat) * 100).toFixed(0)}% | bank.audioUrl=${bank.audioUrl || '-'}`
    );
  }
}
