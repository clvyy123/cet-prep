// 实验：全局扫描 analysis.listening 所有文本中的问句，按顺序归位，看能否覆盖题干空的题
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const banks = eval(src.slice(arrStart, src.lastIndexOf('];') + 1));

const Q_RE = /(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here|Could|Would|Should)\b[^?!\n]{8,200}?[?!]/gi;
// 跳过引导句："Questions 1 and 2 are based on..."
const isGuide = (s) => /^Questions?\s+\d{1,2}(?:\s+(?:and|to)\s+\d{1,2})?\s+are based on/i.test(s);

function cleanQ(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z]*/, '')
    .replace(/\s*\|.*$/, '')
    .trim();
}

let total = 0, covered = 0;
const results = [];
for (const b of banks) {
  const lv = b.meta.level === 4 ? 'cet4' : 'cet6';
  const key = b.meta.id.replace(`bi-${lv}-`, '');
  const anaPath = path.join('scripts/.download', lv, key, 'analysis.json');
  if (!fs.existsSync(anaPath)) continue;
  const ana = JSON.parse(fs.readFileSync(anaPath, 'utf8')).analysis || {};
  const lst = b.listening[0];
  if (!lst) continue;
  const emptyNums = lst.questions.filter(q => !q.question || !q.question.trim()).map(q => q.num);
  if (!emptyNums.length) continue;

  // 全局收集问句（按文本顺序）
  const allText = Object.values(ana.listening || {}).join(' \n ');
  const qs = [];
  let m;
  Q_RE.lastIndex = 0;
  while ((m = Q_RE.exec(allText)) !== null) {
    const q = cleanQ(m[0]);
    if (q.length > 12 && !isGuide(q)) qs.push(q);
  }
  // 去重（双栏重复）
  const uniq = [...new Set(qs)];
  // 尝试覆盖：按顺序匹配
  const coveredNums = [];
  const qIter = [...uniq];
  for (const n of emptyNums) {
    // 找第一个非引导问句
    const idx = qIter.findIndex(q => !isGuide(q));
    if (idx === -1) break;
    coveredNums.push({ n, q: qIter[idx] });
    qIter.splice(idx, 1);
  }
  total += emptyNums.length;
  covered += coveredNums.length;
  results.push({ id: b.meta.id, empty: emptyNums.length, got: coveredNums.length, samples: coveredNums.slice(0, 2).map(x => `${x.n}=${x.q.slice(0, 40)}`) });
}
console.log(`全局问句扫描：可覆盖 ${covered}/${total}`);
console.log('\n每套:');
results.sort((a, b) => a.empty - b.empty).forEach(r => {
  console.log(`${r.id}: 空${r.empty} 可覆盖${r.got} ${r.samples.join(' | ')}`);
});
