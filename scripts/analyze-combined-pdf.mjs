// 分析合并版真题 PDF：找出 3 套题的页码边界
// 用法：node scripts/analyze-combined-pdf.mjs <pdf>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const PDFJS_OPTS = {
  wasmUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/wasm')).href + '/',
  cMapUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/cmaps')).href + '/',
  cMapPacked: true,
  standardFontDataUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts')).href + '/',
};

const file = process.argv[2];
if (!file) { console.error('用法: node analyze-combined-pdf.mjs <pdf>'); process.exit(1); }
const buf = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data: buf, ...PDFJS_OPTS }).promise;
console.log(`总页数: ${doc.numPages}`);
console.log('===== 各页关键标记 =====');
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  const txt = (tc.items || []).map((it) => it.str || '').join(' ');
  // 查找套题标记
  const setMark = txt.match(/第\s*[一二三四1234]\s*套/g) || [];
  const partMark = txt.match(/Part\s*[IVX|\[\]了Jl]{1,4}\s*(?:Writing|Listening|Reading|Translation)/gi) || [];
  const keysMark = txt.match(/KEYS|参考\s*答案|Answer\s*Keys?/i) ? ['KEYS'] : [];
  const writingMark = txt.match(/Writing\s*\(\s*30\s*minutes\s*\)/i) ? ['Writing'] : [];
  const head = txt.slice(0, 300).replace(/\s+/g, ' ').trim();
  console.log(`P${i}: set=${JSON.stringify(setMark)} part=${JSON.stringify(partMark)} keys=${keysMark.length} writing=${writingMark.length}`);
  console.log(`   ${head}`);
}
try { await doc.destroy(); } catch {}
