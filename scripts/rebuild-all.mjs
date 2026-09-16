// 一键重建内置题库：删除旧数据 → 复制新试卷 → 生成答案/解析 → 构建题库
// 用法：node scripts/rebuild-all.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const DIR = path.join(ROOT, 'scripts', '.download');
const SRC_PAPERS = 'C:\\Users\\yy\\Desktop\\四级\\试卷';
const SRC_ANS = 'C:\\Users\\yy\\Desktop\\四级\\答案解析';
const LEVEL_DIR = { '四级': 'cet4', '六级': 'cet6' };
const levelName = { 4: '四级', 6: '六级' };

// ---------- Step 1: 删除旧 试卷/答案/解析 ----------
const DEL_TARGETS = ['test.pdf', 'test-ocr.txt', 'answers.json', 'analysis.json', 'answer-layer.txt', 'answers-auto.json', 'analysis-auto.json'];
let delCount = 0;
for (const lv of ['cet4', 'cet6']) {
  const base = path.join(DIR, lv);
  if (!fs.existsSync(base)) continue;
  for (const key of fs.readdirSync(base)) {
    const d = path.join(base, key);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of DEL_TARGETS) {
      const p = path.join(d, f);
      if (fs.existsSync(p)) { fs.unlinkSync(p); delCount++; }
    }
  }
}
console.log(`[1/4] 已删除 ${delCount} 个旧文件（试卷/答案/解析）`);

// ---------- Step 2: 复制新试卷 PDF ----------
let copyCount = 0, skipCount = 0;
for (const ln of ['四级', '六级']) {
  const dir = path.join(SRC_PAPERS, ln);
  if (!fs.existsSync(dir)) { console.warn('缺少目录:', dir); continue; }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.pdf')) continue;
    const m = f.match(/^(四级|六级)_(\d{4})年(\d{1,2})月 第(\d+(?:-\d+)?)套_试卷\.pdf$/);
    if (!m) { console.warn('文件名不匹配:', f); skipCount++; continue; }
    const y = m[2];
    const mm = String(Number(m[3])).padStart(2, '0');
    const s = m[4];
    const key = `${y}_${mm}_${s}`;
    const dest = path.join(DIR, LEVEL_DIR[ln], key);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(dir, f), path.join(dest, 'test.pdf'));
    copyCount++;
  }
}
console.log(`[2/4] 已复制 ${copyCount} 份试卷 PDF（跳过 ${skipCount} 份）`);

// ---------- Step 3: 生成 answers.json + analysis.json ----------
function findAnsTxt(level, key) {
  const y = key.slice(0, 4);
  const mm = String(Number(key.slice(5, 7)));
  const s = key.slice(8);
  const base = path.join(SRC_ANS, levelName[level]);
  if (!fs.existsSync(base)) return null;
  for (const f of fs.readdirSync(base)) {
    if (f.includes(`${y}年${mm}月 第${s}套`) && f.endsWith('.txt')) return path.join(base, f);
  }
  return null;
}

let ansDone = 0, ansNoTxt = 0;
for (const level of ['4', '6']) {
  const base = path.join(DIR, `cet${level}`);
  if (!fs.existsSync(base)) continue;
  for (const key of fs.readdirSync(base).sort()) {
    const dir = path.join(base, key);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!fs.existsSync(path.join(dir, 'test.pdf'))) continue;
    const ansTxt = findAnsTxt(level, key);
    if (!ansTxt) { console.log(`  无解析txt: cet${level}/${key}`); ansNoTxt++; continue; }
    // answers.json
    execFileSync('node', ['scripts/import-answers.mjs', ansTxt, path.join(dir, 'answers.json')], { stdio: 'inherit' });
    // analysis.json
    execFileSync('node', ['scripts/import-analyzes.mjs', ansTxt, path.join(dir, 'analysis.json')], { stdio: 'inherit' });
    ansDone++;
  }
}
console.log(`[3/4] 已生成答案/解析 ${ansDone} 套（无解析txt ${ansNoTxt} 套）`);

// ---------- Step 4: 构建内置题库 ----------
console.log('[4/4] 构建内置题库...');
execFileSync('node', ['scripts/build-banks.mjs', '--auto'], { stdio: 'inherit', cwd: ROOT });
console.log('\n✅ 全部完成！内置题库已重建。');
