// 从带文字层的真题 PDF 提取整卷文本（按坐标还原行），输出到文件
// 用法：node scripts/dump-paper-text.mjs <pdf> <out.txt>
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, out] = process.argv.slice(2);
const buf = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data: buf }).promise;

const outLines = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const items = (tc.items || [])
    .map((it) => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }))
    .filter((it) => it.str.trim());

  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 3) {
      // 同一行：按 x 顺序拼接，列间距大时补两个空格
      const gap = it.x - last.x1;
      last.text += (gap > 12 ? '    ' : '') + it.str;
      last.x1 = Math.max(last.x1, it.x);
    } else {
      lines.push({ y: it.y, x1: it.x + it.str.length * 5, text: it.str });
    }
  }
  outLines.push(`\n===== PAGE ${p} =====`);
  for (const l of lines) outLines.push(l.text.replace(/[ \t]+/g, ' ').trim());
}

fs.writeFileSync(out, outLines.join('\n'), 'utf8');
console.log(`页数 ${doc.numPages} → ${out} (${outLines.length} 行)`);
