// 统计 builtin-banks.ts 中听力/阅读空题干分布（P1 验收）
import fs from 'node:fs';

const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const banks = eval(src.slice(arrStart, src.lastIndexOf('];') + 1));

let lisEmpty = 0, readEmpty = 0;
const perSet = [];
for (const b of banks) {
  const lst = b.listening.reduce((n, s) => n + s.questions.filter(q => !q.question || !q.question.trim()).length, 0);
  const rd = b.reading.reduce((n, p) => n + p.questions.filter(q => !q.question || !q.question.trim()).length, 0);
  lisEmpty += lst; readEmpty += rd;
  if (lst + rd > 0) perSet.push(`${b.meta.id}: 听力空${lst} 阅读空${rd}`);
}
console.log(`听力空题干: ${lisEmpty} | 阅读空题干: ${readEmpty} | 合计: ${lisEmpty + readEmpty}`);
perSet.forEach(s => console.log(' ', s));
