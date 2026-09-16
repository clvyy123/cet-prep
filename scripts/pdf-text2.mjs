/** 提取 PDF 文字层：node scripts/pdf-text2.mjs <file.pdf> [out.txt] */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const file = process.argv[2];
const out = process.argv[3];
const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
const parts = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  parts.push(`===== PAGE ${i} =====\n` + tc.items.map((it) => it.str).join('\n'));
}
const text = parts.join('\n');
if (out) fs.writeFileSync(out, text, 'utf8');
else console.log(text);
console.error(`pages=${doc.numPages} chars=${text.length}`);
