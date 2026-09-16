#!/usr/bin/env node
// 清理 papers.ts / builtin-banks.ts 里混入的 HTML 残留
//
//   node scripts/fix-html-residue.mjs            # dry-run：只报告
//   node scripts/fix-html-residue.mjs --apply    # 落盘（备份 .bak-html）
//
// 成因：scripts/lz-build-2026.mjs 的 between() 按「属性位置」切分，
// 把 <section class="section section--warm" id="pitfalls"> 的前半截留在正文里；
// txt() 的 /<[^>]*>/g 需要闭合 > 才能匹配，清不掉这种无闭合残片 → 页面直接显示源码。
// 该脚本的 between/txt 已同步修复，这里是存量数据的一次性清洗。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');
const FILES = ['src/data/papers.ts', 'src/data/builtin-banks.ts'];

// 完整 HTML 标签：白名单标签名，或任何带 class/style/id/data-* 属性的尖括号片段
const TAG = /<\/?(?:section|div|span|p|br|strong|em|b|i|u|s|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|img|a|font|header|footer|nav|button|input|select|option|label|blockquote|pre|code|sup|sub|hr|iframe|video|audio|source|figure|figcaption|small|article|aside|main|details|summary)\b[^<>]*\/?>/gi;
const ATTR = /<[a-zA-Z][^<>]*\b(?:class|style|id|data-[\w-]+)\s*=[^<>]*?\/?>/g;
// 无闭合 > 的残片（切标签留下的半截），只在「行尾 / 串尾」清，避免误伤正文里的比较符
const TAIL = /<[a-zA-Z\/][^<>]*$/;

export function cleanText(s) {
  let t = s;
  t = t.replace(TAG, '');
  t = t.replace(ATTR, '');
  t = t.replace(TAIL, '');
  // 删标签后可能留下的悬空空格 / 行首尾空白
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
  return t;
}

const loadArr = (src) => {
  const m = /\][ \t]*=[ \t]*\[/.exec(src) || /=[ \t]*\[/.exec(src);
  const a = m.index + m[0].length - 1, b = src.lastIndexOf(']');
  return { arr: JSON.parse(src.slice(a, b + 1)), a, b };
};

let grand = 0;
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, 'utf8');
  const { arr, a, b } = loadArr(src);
  const hits = [];
  const walk = (n, p = '') => {
    if (Array.isArray(n)) return n.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (n && typeof n === 'object') return Object.entries(n).forEach(([k, v]) => walk(v, `${p}.${k}`));
    if (typeof n !== 'string') return;
    const c = cleanText(n);
    if (c !== n) hits.push({ p, before: n, after: c });
    return c;
  };
  // 原地写回
  const apply = (n, p = '') => {
    if (Array.isArray(n)) { n.forEach((v, i) => apply(v, `${p}[${i}]`)); return n; }
    if (n && typeof n === 'object') { Object.keys(n).forEach(k => { n[k] = apply(n[k], `${p}.${k}`); }); return n; }
    return typeof n === 'string' ? cleanText(n) : n;
  };
  walk(arr);
  console.log(`\n===== ${rel}：命中 ${hits.length} 处`);
  for (const h of hits) {
    console.log(`  ${h.p}`);
    console.log(`     - ${JSON.stringify(h.before.slice(-70))}`);
    console.log(`     + ${JSON.stringify(h.after.slice(-70))}`);
  }
  grand += hits.length;
  if (APPLY && hits.length) {
    const bak = file + '.bak-html';
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    apply(arr);
    fs.writeFileSync(file, src.slice(0, a) + JSON.stringify(arr, null, 2) + src.slice(b + 1));
    console.log(`  → 已写入（备份 ${path.basename(bak)}）`);
  }
}
console.log(`\n合计 ${grand} 处${APPLY ? '，已落盘' : '（dry-run，未写入）'}`);
