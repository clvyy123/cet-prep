// 提取 PDF 文字层（带坐标，便于判断双栏排版）
// 用法：node scripts/pdf-text.mjs <pdf> [page] [--raw]
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2];
const pageArg = process.argv[3] && !process.argv[3].startsWith('--') ? Number(process.argv[3]) : 1;
const raw = process.argv.includes('--raw');

const buf = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data: buf }).promise;
console.log('页数', doc.numPages);

const page = await doc.getPage(pageArg);
const tc = await page.getTextContent();
const items = tc.items || [];
console.log('文本项数', items.length);

if (raw) {
  for (const it of items) {
    const x = it.transform[4].toFixed(1);
    const y = it.transform[5].toFixed(1);
    console.log(`${x}\t${y}\t${it.str}`);
  }
} else {
  console.log('--- 按行拼接 ---');
  console.log(items.map((it) => it.str).join('').slice(0, 1500));
}
