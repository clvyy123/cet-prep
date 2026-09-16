// 调试：模拟 build 脚本 Section B 的段落处理
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const buf = new Uint8Array(fs.readFileSync(path.resolve('scripts/.download/test.pdf')));
const doc = await pdfjs.getDocument({ data: buf }).promise;
let all = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  all += (tc.items || []).map((it) => it.str || '').join(' ') + '\n';
}
try { await doc.destroy(); } catch {}
const p3 = all.search(/\bPart\s+III\b/);
const p4 = all.search(/\bPart\s+IV\b/);
const part3 = all.slice(p3, p4 > -1 ? p4 : p3 + 15000);
const bIdx = part3.search(/Section B/);
const cIdx = part3.indexOf('Section C', bIdx);
const body = part3.slice(bIdx, cIdx > -1 ? cIdx : bIdx + 9000);
// 模拟 build 中的清理（localStripPrefix + stripDirections 效果近似）
const cleaned = body.replace(/\bSection\s*[A-F]\b[^:\n]*:/i, '').trim();
const stmtRe = /(?:^|[\s\n])(\d{1,2})\.\s+([^]{15,}?)(?=\s+\d{1,2}\.\s+[A-Z]|$)/g;
const paras = cleaned.replace(stmtRe, '\n');
console.log('paras 前 400 字符:', JSON.stringify(paras.slice(0, 400)));
console.log('paras 长度:', paras.length);
console.log('A) 出现次数:', (paras.match(/A\)/g) || []).length, ' K) 出现次数:', (paras.match(/K\)/g) || []).length);
const paragraphs = paras.split(/(?=[A-O]\))/).map((s) => s.trim()).filter((s) => s.length > 30);
console.log('段落数:', paragraphs.length);
console.log('段落预览:', paragraphs.map((s) => s.slice(0, 50)).join(' || '));
