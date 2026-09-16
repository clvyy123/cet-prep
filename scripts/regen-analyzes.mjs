// 批量重新生成 analysis.json（仅 import-analyzes，不动 answers.json）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = path.resolve('scripts/.download');
const ANS_SRC = 'C:\\Users\\yy\\Desktop\\四级\\答案解析';
const levelName = { 4: '四级', 6: '六级' };

function findAnsTxt(level, key) {
  const y = key.slice(0, 4);
  const mm = String(Number(key.slice(5, 7)));
  const s = key.slice(8);
  const base = path.join(ANS_SRC, levelName[level]);
  if (!fs.existsSync(base)) return null;
  for (const f of fs.readdirSync(base)) {
    if (f.includes(`${y}年${mm}月 第${s}套`) && f.endsWith('.txt')) return path.join(base, f);
  }
  return null;
}

let done = 0, noAns = 0;
for (const level of ['4', '6']) {
  const base = path.join(DIR, `cet${level}`);
  if (!fs.existsSync(base)) continue;
  for (const key of fs.readdirSync(base).sort()) {
    const dir = path.join(base, key);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!fs.existsSync(path.join(dir, 'test.pdf'))) continue;
    const ansTxt = findAnsTxt(level, key);
    if (!ansTxt) { console.log(`无解析txt: cet${level}/${key}`); noAns++; continue; }
    execFileSync('node', ['scripts/import-analyzes.mjs', ansTxt, path.join(dir, 'analysis.json')], { stdio: 'pipe' });
    done++;
  }
}
console.log(`\n完成：重生成 ${done} 套（无解析txt ${noAns} 套）`);
