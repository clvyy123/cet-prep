// 检查题干空但 analysis 有文本的题：文本开头 120 字，理解为何提取失败
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const banks = eval(src.slice(arrStart, src.lastIndexOf('];') + 1));

const samples = [
  ['bi-cet4-2021_12_1', [1, 4, 5]],
  ['bi-cet4-2021_06_1', [2, 3]],
  ['bi-cet4-2022_06_1', [2, 3]],
];

for (const [id, nums] of samples) {
  const lv = id.includes('cet4') ? 'cet4' : 'cet6';
  const key = id.replace(`bi-${lv}-`, '');
  const ana = JSON.parse(fs.readFileSync(path.join('scripts/.download', lv, key, 'analysis.json'), 'utf8')).analysis || {};
  console.log(`\n===== ${id} =====`);
  for (const n of nums) {
    const t = (ana.listening?.[n] || '').replace(/\s+/g, ' ').trim();
    console.log(`[Q${n}] ${t.slice(0, 150)}`);
  }
}
