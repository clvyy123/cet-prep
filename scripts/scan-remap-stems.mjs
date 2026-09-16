// 错位归位：对题干空题，在所有 listening 文本中搜索该题题干（按题号附近文本匹配）
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const banks = eval(src.slice(arrStart, src.lastIndexOf('];') + 1));

// 对每套，用全局问句扫描：先提取所有问句，再按缺失题号分配（保证 1-25 全覆盖优先）
const Q_RE = /(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here)\b[^?!\n]{8,200}?[?!]/gi;
const cleanQ = (s) => s.replace(/\s+/g, ' ').replace(/^[^A-Za-z]*/, '').replace(/\s*\|.*$/, '').trim();
const isGuide = (s) => /^Questions?\s+\d{1,2}(?:\s+(?:and|to)\s+\d{1,2})?\s+are based on/i.test(s);

let totalEmpty = 0, recoverable = 0;
const report = [];
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
  totalEmpty += emptyNums.length;

  // 全局收集问句
  const allText = Object.values(ana.listening || {}).join(' \n ');
  const qs = [];
  let m;
  Q_RE.lastIndex = 0;
  while ((m = Q_RE.exec(allText)) !== null) {
    const q = cleanQ(m[0]);
    if (q.length > 12 && !isGuide(q)) qs.push(q);
  }
  const uniq = [...new Set(qs)];
  // 分配：按顺序给空题号
  const qIter = [...uniq];
  const recovered = [];
  for (const n of emptyNums) {
    const idx = qIter.findIndex(q => !isGuide(q));
    if (idx === -1) break;
    recovered.push({ n, q: qIter[idx] });
    qIter.splice(idx, 1);
  }
  recoverable += recovered.length;
  report.push({ id: b.meta.id, empty: emptyNums.length, rec: recovered.length, samples: recovered.slice(0, 3).map(x => `${x.n}=${x.q.slice(0, 35)}`) });
}
console.log(`全局错位归位：可恢复 ${recoverable}/${totalEmpty}\n`);
report.filter(r => r.rec > 0).sort((a, b) => a.rec - b.rec).forEach(r => {
  console.log(`${r.id}: 空${r.empty} 可恢复${r.rec} [${r.samples.join(' | ')}]`);
});
