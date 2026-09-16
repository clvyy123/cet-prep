// 通用：网络"答案文本" → 本地选项字母 → 写入 answers.json
// 用法：node scripts/apply-web-text.mjs <bankId> <section> -- "1|答案文本1" "2|答案文本2" ...
// 只写入能可靠文本匹配的题；匹配失败则跳过并提示
import fs from 'node:fs';

const [bankId, section] = process.argv.slice(2, 4);
const pairs = [];
const args = process.argv.slice(4);
for (const a of args) {
  const i = a.indexOf('|');
  pairs.push([Number(a.slice(0, i)), a.slice(i + 1)]);
}

const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const arrEnd = src.lastIndexOf('];');
const banks = eval(src.slice(arrStart, arrEnd + 1));
const bank = banks.find(b => b.meta.id === bankId);
if (!bank) { console.log(bankId + ' 未找到'); process.exit(1); }

const items = section === 'listening' ? bank.listening[0].questions
  : section === 'reading' ? bank.reading.flatMap(r => r.questions)
  : bank.long.flatMap(l => l.questions);

const norm = s => (s || '').toLowerCase().replace(/[’'‘’]/g, "'").replace(/£/g, '£');
const results = {}; // {n: letter}
const skipped = [];
for (const [n, kwRaw] of pairs) {
  const kw = norm(kwRaw);
  const q = items.find(x => x.num === n);
  if (!q) { skipped.push(`Q${n}: 本地无此题`); continue; }
  let hits = [];
  for (let i = 0; i < q.options.length; i++) {
    const opt = norm(q.options[i]);
    if (opt.includes(kw)) hits.push('ABCD'[i]);
  }
  if (hits.length === 1) results[n] = hits[0];
  else if (hits.length === 0) skipped.push(`Q${n}: 文本「${kwRaw}」未匹配（选项: ${q.options.map(o=>o.slice(0,30)).join(' | ')}）`);
  else skipped.push(`Q${n}: 文本「${kwRaw}」匹配多个选项 ${hits.join(',')}（选项污染）`);
}

if (!Object.keys(results).length) { console.log('无可用映射'); process.exit(1); }

// 映射到该套题目录的 answers.json
const dirMap = { 'bi-cet4-2021_06_3':'cet4/2021_06_3', 'bi-cet4-2022_06_1':'cet4/2022_06_1', 'bi-cet4-2022_12_1':'cet4/2022_12_1', 'bi-cet4-2022_12_2':'cet4/2022_12_2', 'bi-cet4-2023_06_1':'cet4/2023_06_1', 'bi-cet4-2023_12_1':'cet4/2023_12_1', 'bi-cet4-2023_12_2':'cet4/2023_12_2', 'bi-cet6-2021_06_1':'cet6/2021_06_1', 'bi-cet6-2022_09_1':'cet6/2022_09_1' };
const setPath = 'scripts/.download/' + dirMap[bankId];
const ansPath = setPath + '/answers.json';
let existing = {};
try { existing = JSON.parse(fs.readFileSync(ansPath, 'utf8')); } catch {}

let changed = 0;
for (const [n, a] of Object.entries(results)) {
  existing[n] = a;
  changed++;
}
// 记录本次验证过的题号（供 build-banks.mjs 白名单 override 使用）
const verifiedNums = Object.keys(results).map(Number);
const prev = Array.isArray(existing._verified) ? existing._verified : [];
existing._verified = [...new Set([...prev, ...verifiedNums])];
fs.writeFileSync(ansPath, JSON.stringify(existing, null, 2));
console.log(`✅ ${bankId} (${section}): 写入 ${changed} 题`);
console.log('  映射:', Object.entries(results).map(([n,a])=>n+'='+a).join(' '));
if (skipped.length) console.log('  跳过:', skipped.join(' | '));
