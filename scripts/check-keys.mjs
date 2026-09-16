// 检查 PDF 文字层是否含答案区（KEYS/参考答案/答案：）
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const dir = process.argv[2];
const buf = new Uint8Array(fs.readFileSync(dir + '/test.pdf'));
const doc = await pdfjs.getDocument({ data: buf }).promise;
let all = '';
for (let i = 1; i <= doc.numPages; i++) {
  const p = await doc.getPage(i);
  const tc = await p.getTextContent();
  all += (tc.items || []).map((it) => it.str).join(' ') + '\n';
}
try { await doc.destroy(); } catch {}
console.log('总字符:', all.length);
for (const k of ['KEYS', '参考答案', 'Answer Keys', '答案：', '答案:', 'keys']) {
  console.log(k, (all.match(new RegExp(k, 'gi')) || []).length);
}
const i = all.search(/KEYS|参考答案|Answer\s*Keys|答案\s*[:：]/i);
if (i >= 0) console.log('--- keys区 ---\n' + all.slice(i, i + 700).replace(/\n+/g, ' | '));
