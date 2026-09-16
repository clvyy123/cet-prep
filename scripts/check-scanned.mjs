// 检查哪些 test.pdf 是扫描版（文字层 <500 字符，需要 OCR）
// 直接复用 build-banks.mjs 的 extractPdf 逻辑
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const DIR = path.resolve('scripts/.download');
const PDFJS_OPTS = {
  wasmUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/wasm')).href + '/',
  cMapUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/cmaps')).href + '/',
  cMapPacked: true,
  standardFontDataUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts')).href + '/',
};

async function extractPdfTextLen(file) {
  const buf = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data: buf, ...PDFJS_OPTS }).promise;
  let all = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    all += (tc.items || []).map((it) => it.str || '').join(' ') + '\n';
  }
  try { await doc.destroy(); } catch {}
  return all.replace(/\s/g, '').length;
}

const out = [];
for (const lv of ['cet4', 'cet6']) {
  const b = path.join(DIR, lv);
  if (!fs.existsSync(b)) continue;
  for (const k of fs.readdirSync(b).sort()) {
    const d = path.join(b, k);
    if (!fs.statSync(d).isDirectory()) continue;
    const tp = path.join(d, 'test.pdf');
    if (!fs.existsSync(tp)) continue;
    const len = await extractPdfTextLen(tp);
    const status = len < 500 ? '需OCR' : '有文字层';
    console.log(`${lv}/${k}: ${len} 字符 → ${status}`);
    if (len < 500) out.push(`${lv}/${k}`);
  }
}
fs.writeFileSync('e:/词炬/scripts/needs-ocr.json', JSON.stringify(out, null, 2));
console.log(`\n需OCR: ${out.length} 套`);
