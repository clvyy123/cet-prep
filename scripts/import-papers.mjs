// 导入桌面试卷 PDF：C:\Users\yy\Desktop\四级\试卷\{四级,六级}\*.pdf
// 复制为 scripts/.download/cet{4,6}/{y}_{mm}_{s}/test.pdf，供 build-banks.mjs --auto 生成内置题库
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'C:\\Users\\yy\\Desktop\\四级\\试卷';
const DEST = path.resolve('scripts/.download');

const LEVEL_DIR = { '四级': 'cet4', '六级': 'cet6' };

const files = [];
for (const levelName of ['四级', '六级']) {
  const dir = path.join(SRC, levelName);
  if (!fs.existsSync(dir)) {
    console.warn('缺少目录:', dir);
    continue;
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.pdf')) continue;
    files.push({ levelName, file: f, src: path.join(dir, f) });
  }
}
console.log('找到', files.length, '份试卷 PDF');

let count = 0;
let skipped = 0;
for (const { levelName, file, src } of files) {
  const m = file.match(/^(四级|六级)_(\d{4})年(\d{1,2})月 第(\d+(?:-\d+)?)套_试卷\.pdf$/);
  if (!m) {
    console.warn('文件名不匹配，跳过:', file);
    skipped++;
    continue;
  }
  const y = m[2];
  const mm = String(Number(m[3])).padStart(2, '0');
  const s = m[4];
  const key = `${y}_${mm}_${s}`;
  const dir = path.join(DEST, LEVEL_DIR[levelName], key);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, 'test.pdf'));
  count++;
}
console.log(`已复制 ${count} 套到 scripts/.download（跳过 ${skipped} 份），下一步：node scripts/build-banks.mjs --auto`);
