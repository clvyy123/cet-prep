// 分析听力题干空：每套缺失题号 + analysis.json 是否有对应文本
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const banks = eval(src.slice(arrStart, src.lastIndexOf('];') + 1));

const hasHan = (s) => /[\u4e00-\u9fff]/.test(s || '');
let totalEmpty = 0;
const perSet = [];

for (const b of banks) {
  const lst = b.listening[0];
  if (!lst) continue;
  const qs = lst.questions || [];
  const emptyNums = qs.filter(q => !q.question || !q.question.trim()).map(q => q.num);
  if (!emptyNums.length) continue;
  totalEmpty += emptyNums.length;

  // 检查 analysis.json 是否有对应题的文本
  const lv = b.meta.level === 4 ? 'cet4' : 'cet6';
  const key = b.meta.id.replace(`bi-${lv}-`, '');
  const anaPath = path.join('scripts/.download', lv, key, 'analysis.json');
  let ana = {};
  if (fs.existsSync(anaPath)) {
    try { ana = JSON.parse(fs.readFileSync(anaPath, 'utf8')).analysis || {}; } catch {}
  }
  const withAnaText = emptyNums.filter(n => ana.listening?.[n]);
  const noAnaText = emptyNums.filter(n => !ana.listening?.[n]);
  // 检查是否有其他题干源文件
  const hasLayer = fs.existsSync(path.join('scripts/.download', lv, key, 'answer-layer.txt'));
  const hasOcr = fs.existsSync(path.join('scripts/.download', lv, key, 'ocr-full.txt'));
  perSet.push({ id: b.meta.id, empty: emptyNums, withAna: withAnaText, noAna: noAnaText, hasLayer, hasOcr, total: qs.length });
}

// 输出摘要
console.log(`共 ${totalEmpty} 题题干空 / ${perSet.length} 套\n`);
console.log('按严重度排序（缺失数降序）:');
perSet.sort((a, b) => b.empty.length - a.empty.length).forEach(s => {
  const anaInfo = s.withAna.length ? `analysis有文本${s.withAna.length}题(提取失败)` : '';
  const noAna = s.noAna.length ? `analysis无文本${s.noAna.length}题` : '';
  const srcInfo = [s.hasLayer ? '有answer-layer' : '', s.hasOcr ? '有ocr-full' : ''].filter(Boolean).join('+') || '无其他源';
  console.log(`${s.id}: 空${s.empty.length}题 [${s.empty.join(',')}] | ${noAna} | ${anaInfo} | ${srcInfo}`);
});
