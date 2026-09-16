// OCR 扫描版试卷：渲染 PDF 页面 → tesseract 识别（中英混合）→ 生成 test-ocr.txt
// 用法：
//   node scripts/ocr-papers.mjs --only 2022_06_1   # 只处理指定套题（可在 cet4/cet6 下）
//   node scripts/ocr-papers.mjs --level cet4        # 只处理某级别全部扫描版
//   node scripts/ocr-papers.mjs                     # 处理全部扫描版
// 说明：文字层 > 500 字符的 PDF 视为已有文字层，跳过；生成的 test-ocr.txt 带
//       "===== PAGE N =====" 页标记（build-banks.mjs 的 OCR 清洗逻辑依赖该格式）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';

const DIR = path.resolve('scripts/.download');
const SCALE = 2; // 2x 渲染，保证 OCR 可读
const PDFJS_OPTS = {
  wasmUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/wasm')).href + '/',
  cMapUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/cmaps')).href + '/',
  cMapPacked: true,
  standardFontDataUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts')).href + '/',
};

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const ONLY = argVal('--only'); // 如 2022_06_1
const ONLY_LEVEL = argVal('--level'); // 如 cet4

/** 提取 PDF 文字层长度（用于判断是否扫描版） */
async function textLength(testPdf) {
  const buf = new Uint8Array(fs.readFileSync(testPdf));
  const doc = await pdfjs.getDocument({ data: buf, ...PDFJS_OPTS }).promise;
  let all = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    all += (tc.items || []).map((it) => it.str || '').join(' ');
  }
  try { await doc.destroy(); } catch {}
  return all.replace(/\s/g, '').length;
}

/** 渲染 PDF 全部页面为 PNG */
async function renderPages(testPdf) {
  const buf = new Uint8Array(fs.readFileSync(testPdf));
  const doc = await pdfjs.getDocument({ data: buf, ...PDFJS_OPTS }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas.toBuffer('image/png'));
  }
  try { await doc.destroy(); } catch {}
  return pages;
}

/** 找出需要 OCR 的套题 */
function targets() {
  const out = [];
  for (const level of ['4', '6']) {
    const base = path.join(DIR, `cet${level}`);
    if (!fs.existsSync(base)) continue;
    for (const key of fs.readdirSync(base)) {
      const dir = path.join(base, key);
      if (!fs.statSync(dir).isDirectory()) continue;
      if (ONLY_LEVEL && `cet${level}` !== ONLY_LEVEL) continue;
      if (ONLY && key !== ONLY) continue;
      const testPdf = path.join(dir, 'test.pdf');
      if (!fs.existsSync(testPdf)) continue;
      if (fs.existsSync(path.join(dir, 'test-ocr.txt'))) {
        console.log(`跳过（已 OCR）: cet${level}/${key}`);
        continue;
      }
      out.push({ level, key, dir, testPdf });
    }
  }
  return out;
}

const list = targets();
if (list.length === 0) {
  console.log('没有需要 OCR 的套题。');
  process.exit(0);
}
console.log(`待 OCR 套题 ${list.length} 套`);

const worker = await createWorker(['eng', 'chi_sim'], 1, {
  cachePath: path.resolve('node_modules/.cache/tesseract-ocr'),
  langPath: path.resolve('public/tess'),
  gzip: true,
});

const t0 = Date.now();
for (const t of list) {
  const len = await textLength(t.testPdf);
  if (len >= 500) {
    console.log(`跳过（已有文字层 ${len} 字符）: cet${t.level}/${t.key}`);
    continue;
  }
  console.log(`OCR cet${t.level}/${t.key} (${t.dir}) …`);
  const pngs = await renderPages(t.testPdf);
  const parts = [];
  for (let i = 0; i < pngs.length; i++) {
    const { data } = await worker.recognize(pngs[i]);
    parts.push(`===== PAGE ${i + 1} =====\n${data.text.trim()}`);
    console.log(`  page ${i + 1}/${pngs.length} done`);
  }
  const ocrText = parts.join('\n\n');
  fs.writeFileSync(path.join(t.dir, 'test-ocr.txt'), ocrText, 'utf8');
  console.log(`  已生成 test-ocr.txt (${ocrText.length} 字符)`);
}

await worker.terminate();
console.log(`完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
