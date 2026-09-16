// 抽样检查题干空但 analysis 有文本的题，看文本里是否其实藏着题干（题号错位）
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const banks = eval(src.slice(arrStart, src.lastIndexOf('];') + 1));

const cases = [
  ['bi-cet4-2021_12_1', [1, 2, 3, 4]],
  ['bi-cet4-2021_06_1', [2, 3, 4]],
  ['bi-cet4-2022_06_1', [1, 2, 3]],
  ['bi-cet6-2024_12_1', [1, 2, 3]],
];

for (const [id, nums] of cases) {
  const lv = id.includes('cet4') ? 'cet4' : 'cet6';
  const key = id.replace(`bi-${lv}-`, '');
  const anaPath = path.join('scripts/.download', lv, key, 'analysis.json');
  if (!fs.existsSync(anaPath)) continue;
  const ana = JSON.parse(fs.readFileSync(anaPath, 'utf8')).analysis || {};
  console.log(`\n===== ${id} =====`);
  for (const n of nums) {
    const t = (ana.listening?.[n] || '').replace(/\s+/g, ' ').trim();
    console.log(`\n[Q${n}] analysis文本前200字:\n  ${t.slice(0, 200)}`);
  }
}
