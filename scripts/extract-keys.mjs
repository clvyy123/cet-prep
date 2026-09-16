// 为文字层 PDF（2024+）从 KEYS 区提取答案 → answers.json
// 选词填空(26-35) KEYS 给的是字母，需按试卷 Section A 词库 A-O 顺序转成单词
// 用法：node scripts/extract-keys.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const DIR = path.resolve('scripts/.download');

async function extractPdf(file) {
  const buf = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let all = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    all += (tc.items || []).map((it) => it.str || '').join(' ') + '\n';
  }
  try { await doc.destroy(); } catch {}
  return all;
}

// KEYS 区解析（与 build-banks.mjs parseAnswerMap 一致）
function parseKeys(text) {
  const map = new Map();
  const secStart = text.search(/KEYS\b|参考\s*答案|Answer\s*Keys?/i);
  if (secStart === -1) return map;
  const sec = text.slice(secStart);
  const rangeRe = /(\d{1,2})\s*[-~—–]\s*(\d{1,2})\s*[:：]?\s*([A-Oa-o](?:[\s,，、/]*[A-Oa-o]){0,9})/g;
  let m;
  while ((m = rangeRe.exec(sec)) !== null) {
    const s = parseInt(m[1], 10), e = parseInt(m[2], 10);
    const letters = m[3].replace(/[^A-Oa-o]/g, '').toUpperCase();
    for (let i = 0; i < letters.length && s + i <= e; i++) map.set(s + i, letters[i]);
  }
  const tokens = sec.match(/\b\d{1,2}\b|(?<![A-Za-z])[A-Oa-o](?![A-Za-z])/g) ?? [];
  let i = 0;
  while (i < tokens.length) {
    const nums = [];
    while (i < tokens.length && /^\d{1,2}$/.test(tokens[i])) { nums.push(tokens[i]); i++; }
    const letters = [];
    while (i < tokens.length && /^[A-Oa-o]$/.test(tokens[i])) { letters.push(tokens[i]); i++; }
    if (nums.length >= 3 && letters.length === nums.length) {
      for (let k = 0; k < nums.length; k++) {
        const n = parseInt(nums[k], 10);
        if (!map.has(n)) map.set(n, letters[k].toUpperCase());
      }
    }
  }
  return map;
}

// 试卷 Section A 词库（A-O 顺序单词）
function extractBankedWords(block) {
  const words = [];
  const re = /(?:^|[\s(])([A-O])([\)\.])\s*([a-zA-Z][a-zA-Z'\-]*)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const w = m[3].toLowerCase();
    if (w.length > 1 && !words.includes(w)) words.push(w);
  }
  return words;
}

let done = 0, noKeys = 0;
for (const level of ['4', '6']) {
  const base = path.join(DIR, `cet${level}`);
  if (!fs.existsSync(base)) continue;
  for (const key of fs.readdirSync(base).sort()) {
    const dir = path.join(base, key);
    if (!fs.statSync(dir).isDirectory()) continue;
    const pdf = path.join(dir, 'test.pdf');
    if (!fs.existsSync(pdf)) continue;
    if (fs.existsSync(path.join(dir, 'answers.json'))) continue; // 已有人工答案，跳过
    const text = await extractPdf(pdf);
    const keys = parseKeys(text);
    if (!keys.size) { console.log(`无KEYS: cet${level}/${key}`); noKeys++; continue; }
    // Section A 词库：在 "Part III Reading" 之后（避免搜到听力 Section A），取整段直到 Section B
    const ri = text.search(/Part\s*[IVX|Jl了\[0-9N]+\s*Reading|Reading\s*Comprehension/i);
    const si = ri !== -1 ? text.indexOf('Section A', ri) : -1;
    let bankedWords = [];
    if (si !== -1) {
      const endIdx = text.indexOf('Section B', si);
      const seg = text.slice(si, endIdx === -1 ? si + 9000 : endIdx);
      bankedWords = extractBankedWords(seg).slice(0, 15);
    }
    const out = {};
    for (let n = 1; n <= 55; n++) {
      const l = keys.get(n);
      if (!l) continue;
      if (n >= 26 && n <= 35) {
        const idx = 'ABCDEFGHIJKLMNO'.indexOf(l);
        const w = bankedWords[idx];
        if (w) out[n] = w; else out[n] = l; // 找不到单词时保留字母
      } else {
        out[n] = l;
      }
    }
    fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(out, null, 2), 'utf8');
    const bankedWordsCount = Object.keys(out).filter((k) => Number(k) >= 26 && Number(k) <= 35).length;
    console.log(`cet${level}/${key}: ${Object.keys(out).length} 答案, 选词${bankedWordsCount}, 词库${bankedWords.length}`);
    done++;
  }
}
console.log(`完成 ${done} 套（无KEYS ${noKeys} 套）`);
