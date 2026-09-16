// 校验 builtin-banks.ts 数据质量
import fs from 'node:fs';
const t = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const start = t.indexOf('export const BUILTIN_BANKS');
const jsonStr = t.slice(t.indexOf('= [', start) + 2, t.lastIndexOf('];') + 1);
const banks = JSON.parse(jsonStr);

let ok = 0, issues = [];
for (const b of banks) {
  const label = b.meta?.label || b.meta?.id;
  // 选词：答案必须在词库中
  const bk = b.banked[0];
  if (bk) {
    for (const a of bk.answers) {
      if (!bk.words.includes(a)) issues.push(`${label}: 选词答案 "${a}" 不在词库`);
    }
    if (bk.answers.length !== 10) issues.push(`${label}: 选词答案数 ${bk.answers.length}`);
  }
  // 长篇：答案 A-O
  const lg = b.long[0];
  if (lg) {
    for (const s of lg.statements) {
      if (s.answer && !/^[A-O]$/.test(s.answer)) issues.push(`${label}: 长篇${s.num} 答案 "${s.answer}" 非法`);
    }
  }
  // 阅读：答案 A-D
  for (const p of b.reading) {
    for (const q of p.questions) {
      if (q.answer && !/^[A-D]$/.test(q.answer)) issues.push(`${label}: 阅读${q.num} 答案 "${q.answer}" 非法`);
    }
  }
  ok++;
}
console.log(`共 ${ok} 套`);
console.log(issues.length ? issues.slice(0, 40).join('\n') : '结构校验全部通过');
console.log(issues.length > 40 ? `...共 ${issues.length} 条` : '');
