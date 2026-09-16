// 批量：为 scripts/.download 下所有套件生成 answers.json + analysis.json 初稿
// 答案/解析来源：C:\Users\yy\Desktop\四级\答案解析\{四级,六级}\{级别}_{y}年{m}月 第{s}套_答案解析.txt
// 用法：node scripts/run-import.mjs [--only 2022_06_1] [--level cet4]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = path.resolve('scripts/.download');
const ANS_SRC = 'C:\\Users\\yy\\Desktop\\四级\\答案解析';
const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const ONLY = argVal('--only');
const ONLY_LEVEL = argVal('--level');
const FORCE = args.includes('--force');

const levelName = { 4: '四级', 6: '六级' };

function findAnsTxt(level, key) {
  // key: 2022_06_1 → 2022年6月 第1套
  const y = key.slice(0, 4);
  const mm = String(Number(key.slice(5, 7)));
  let s = key.slice(8);
  const base = path.join(ANS_SRC, levelName[level]);
  if (!fs.existsSync(base)) return null;
  for (const f of fs.readdirSync(base)) {
    if (f.includes(`${y}年${mm}月 第${s}套`) && f.endsWith('.txt')) return path.join(base, f);
  }
  return null;
}

let done = 0;
let noAns = 0;
for (const level of ['4', '6']) {
  if (ONLY_LEVEL && `cet${level}` !== ONLY_LEVEL) continue;
  const base = path.join(DIR, `cet${level}`);
  if (!fs.existsSync(base)) continue;
  for (const key of fs.readdirSync(base).sort()) {
    if (ONLY && key !== ONLY) continue;
    const dir = path.join(base, key);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!fs.existsSync(path.join(dir, 'test.pdf'))) continue;
    const ansTxt = findAnsTxt(level, key);
    if (!ansTxt) {
      console.log(`无解析txt: cet${level}/${key}`);
      noAns++;
      continue;
    }
    console.log(`\n== cet${level}/${key} <= ${path.basename(ansTxt)}`);
    // answers.json
    execFileSync('node', ['scripts/import-answers.mjs', ansTxt, path.join(dir, 'answers.json')], { stdio: 'inherit' });
    // analysis.json 初稿（存在且非 --force 时跳过，避免覆盖人工修正）
    const analysisFile = path.join(dir, 'analysis.json');
    if (!fs.existsSync(analysisFile) || FORCE) {
      execFileSync('node', ['scripts/import-analyzes.mjs', ansTxt, analysisFile], { stdio: 'inherit' });
    } else {
      console.log('analysis.json 已存在，跳过');
    }
    done++;
  }
}
console.log(`\n完成：处理 ${done} 套（无解析txt ${noAns} 套）`);
