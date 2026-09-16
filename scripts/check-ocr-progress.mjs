// 检查 OCR 进度：哪些已有 test-ocr.txt
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('scripts/.download');
const needsOcr = JSON.parse(fs.readFileSync('e:/词炬/scripts/needs-ocr.json', 'utf8'));

const done = [], remaining = [];
for (const key of needsOcr) {
  const ocrTxt = path.join(DIR, key, 'test-ocr.txt');
  if (fs.existsSync(ocrTxt) && fs.statSync(ocrTxt).size > 500) {
    done.push(key);
  } else {
    remaining.push(key);
  }
}
console.log('已完成:', done.length, done.join(', '));
console.log('\n剩余:', remaining.length, remaining.join(', '));
// 保存剩余列表
fs.writeFileSync('e:/词炬/scripts/needs-ocr-remaining.json', JSON.stringify(remaining, null, 2));
