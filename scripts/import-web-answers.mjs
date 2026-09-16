// 从抓取的网页文本解析答案，写入 answers.json
// 输入：网页文本（含 "1.D) 2.C)..." 或 "1-5: D C B..." 格式）
// 用法：node scripts/import-web-answers.mjs <setDir> "<webText>"
import fs from 'node:fs';
import path from 'node:path';

const setDir = process.argv[2];
if (!setDir || !fs.existsSync(setDir)) {
  console.error('用法: node import-web-answers.mjs <setDir> "<webText 或文件路径>"');
  process.exit(1);
}

// 读取答案文本（第二个参数是文件路径或直接文本）
let text = process.argv[3] || '';
if (text && fs.existsSync(text)) text = fs.readFileSync(text, 'utf8');
if (!text) {
  console.error('无答案文本');
  process.exit(1);
}

// 解析答案：支持多种格式
const map = new Map();

// 格式1: "1.D)Its finding..." 或 "1. D) ..." 或 "1.D" 或 "1=A"
const re1 = /(\d{1,2})\s*[\.\)、=]\s*([A-Oa-o])\s*[\)）]?/g;
let m;
while ((m = re1.exec(text)) !== null) {
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= 55) map.set(n, m[2].toUpperCase());
}

// 格式2: "1-5: D C B A D" 范围
const re2 = /(\d{1,2})\s*[-~—–]\s*(\d{1,2})\s*[:：]?\s*([A-Oa-o](?:[\s,，、/]*[A-Oa-o]){0,9})/g;
while ((m = re2.exec(text)) !== null) {
  const s = parseInt(m[1], 10), e = parseInt(m[2], 10);
  const letters = m[3].replace(/[^A-Oa-o]/g, '').toUpperCase();
  for (let i = 0; i < letters.length && s + i <= e; i++) {
    if (!map.has(s + i)) map.set(s + i, letters[i]);
  }
}

if (map.size === 0) {
  console.error('未解析到任何答案');
  process.exit(1);
}

// 读现有 answers.json，合并
const ansPath = path.join(setDir, 'answers.json');
let existing = {};
try { existing = JSON.parse(fs.readFileSync(ansPath, 'utf8')); } catch {}

// --no-overwrite: 仅补充缺失题号，不覆盖已有答案
const NO_OVERWRITE = process.argv.includes('--no-overwrite');
let added = 0;
const verifiedNums = [];
for (const [n, a] of map) {
  // 题号范围校验
  if (n >= 26 && n <= 45 && !'ABCDEFGHIJKLMNO'.includes(a)) continue;
  if ((n <= 25 || n >= 46) && !'ABCD'.includes(a)) continue;
  if (NO_OVERWRITE) {
    if (!existing[n]) { existing[n] = a; added++; verifiedNums.push(n); }
  } else {
    // 值相同也计入 verifiedNums：该题号答案已与网络源确认一致
    if (!existing[n]) { existing[n] = a; added++; }
    else if (existing[n] !== a) { existing[n] = a; added++; }
    verifiedNums.push(n);
  }
}

// 记录本次验证过的题号（供 build-banks.mjs 白名单 override 使用）
if (verifiedNums.length) {
  const prev = Array.isArray(existing._verified) ? existing._verified : [];
  existing._verified = [...new Set([...prev, ...verifiedNums])];
}

fs.writeFileSync(ansPath, JSON.stringify(existing, null, 2));
console.log(`✅ ${path.basename(setDir)}: 解析 ${map.size} 题，写入 ${added} 题`);
console.log('  答案:', [...map.entries()].sort((a,b)=>a[0]-b[0]).map(([n,a])=>n+'='+a).join(' '));
