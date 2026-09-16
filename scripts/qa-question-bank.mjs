/**
 * 全量审计 src/data/papers.ts（61 套真题）的四类问题：
 *   1. 选项缺失   — options / optionCn 为空或不足 4 项
 *   2. 空格间断缺失 — 英文文本词间空格被吞（OCR 粘连）；选词填空篇章缺 ___NN___ 占位
 *   3. 内容冗余   — 解析里混入词汇表/页脚/广告/重复片段
 *   4. 信息缺失   — 题干、译文、答案、解析、篇章、词库为空
 *
 * 用法：node scripts/qa-question-bank.mjs [--json out.json]
 */
import fs from 'node:fs';
import { buildVocab, _splitGlued } from './lib-spacing.mjs';

const OUT = (() => {
  const i = process.argv.indexOf('--json');
  return i !== -1 ? process.argv[i + 1] : null;
})();

const t = fs.readFileSync('src/data/papers.ts', 'utf8');
const s = t.indexOf('Paper[] = [') + 'Paper[] = '.length;
const e = t.lastIndexOf('];');
const PAPERS = JSON.parse(t.slice(s, e + 1));

/* 词典交给 lib-spacing 统一建（61 套语料 + CET 词表），审计与修复共用一套判据 */
buildVocab(PAPERS);

/**
 * 检测英文词间空格缺失。
 * 直接问 lib-spacing「这个串你敢不敢拆」——敢拆才算问题。
 * 之前这里用的是自带的 200 词小词典，把 handbook / workplace / headteacher /
 * something / anywhere / whatever 这类真复合词全报成粘连，误报几百条。
 */
function findGluedWords(text) {
  if (!text) return [];
  const hits = [];
  for (const m of text.matchAll(/\b[A-Za-z]{8,30}\b/g)) {
    if (_splitGlued(m[0])) hits.push(m[0]);
  }
  return hits;
}

/**
 * 解析里的「重复片段」：双栏串扰会把同一句解析连贴两次。
 * 判据：① 小句（≥12 字，去空白后）完全重复；② 存在重复的 24 字连续片段。
 *
 * 老写法（正则里用到 \1 但分组带 ?）是坏的：分组未参与匹配时 JS 的反向引用退化成空串，
 * 整条式子退化成「开头空白 + 任意内容 + 空白」，恒真 —— 2400 条全是误报。
 */
function hasDupFragment(an) {
  if (!an) return false;
  const cjk = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;
  // 只看中文：长篇阅读的解析天然会两处引用同一英文关键短语，英文重复不算冗余
  const parts = an
    .split(/[。；;！!？?\n]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 12 && cjk(x) >= 6);
  const seen = new Set();
  for (const x of parts) {
    const key = x.replace(/\s+/g, '');
    if (seen.has(key)) return true;
    seen.add(key);
  }
  const flat = an.replace(/\s+/g, '');
  if (flat.length < 100) return false;
  const N = 40;
  const grams = new Set();
  for (let i = 0; i + N <= flat.length; i++) {
    const g = flat.slice(i, i + N);
    if (cjk(g) >= 20 && grams.has(g)) return true;
    grams.add(g);
  }
  return false;
}

const isHan = (s) => /[\u4e00-\u9fff]/.test(s || '');
const noisePatterns = [
  [/老师说[\s\S]{0,200}?二维码/, '广告·扫码看视频'],
  [/扫(描)?二维码/, '广告·扫码'],
  [/^\s*[·•]\s*\w+\s*(adj|adv|n|v|vt|vi|prep|conj)\./m, '解析混入词汇表'],
  [/\w+(adj|adv|n|v|vt|vi|prep)\.[一-龥]/, '解析混入词汇表'],
  [/^\s*\d{0,3}\s*[四六]级\s*\d{4}\s*[.\-·年]\s*\d{1,2}/m, '页脚噪声'],
  [/\[第\s*\d+\s*页\]/, '页脚·页码'],
  [/^\s*第?\s*\d+\s*页\s*$/m, '页脚·页码'],
];

const stats = {
  papers: PAPERS.length,
  blocks: 0,
  questions: 0,
  issues: [],
};

function add(paperId, blockId, qnum, type, detail) {
  stats.issues.push({ paperId, blockId, num: qnum ?? null, type, detail });
}

const BLANK_RE = /_{2,}\s*(\d{1,2})\s*_{2,}/g;

for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      stats.blocks++;
      const bid = b.id;

      /* ---------- 选词填空：词库 + 空格占位 ---------- */
      if (bid.includes('banked')) {
        const wb = b.wordBank || {};
        const wbN = Object.keys(wb).length;
        if (wbN < 15) add(p.id, bid, null, '信息缺失', `词库仅 ${wbN} 项（应为 15 个 A–O）`);
        for (const [k, v] of Object.entries(wb)) {
          if (!v || !String(v).trim()) add(p.id, bid, null, '信息缺失', `词库 ${k} 为空`);
          if (isHan(v)) add(p.id, bid, null, '内容冗余', `词库 ${k} 含中文「${v}」`);
        }
        const blanks = [...String(b.material || '').matchAll(BLANK_RE)].map((m) => Number(m[1]));
        if (blanks.length < 10) add(p.id, bid, null, '空格缺失', `篇章仅 ${blanks.length} 个空格占位（应为 10）`);
        const dup = blanks.filter((v, i) => blanks.indexOf(v) !== i);
        if (dup.length) add(p.id, bid, null, '空格缺失', `空格编号重复：${[...new Set(dup)].join(',')}`);
      }

      /* ---------- 篇章类：内容 ---------- */
      if (b.material) {
        const m = String(b.material);
        if (m.length < 200) add(p.id, bid, null, '信息缺失', `篇章过短（${m.length} 字符）`);
        if (isHan(m) && !bid.includes('translation')) {
          const hanRatio = (m.match(/[\u4e00-\u9fff]/g) || []).length / m.length;
          if (hanRatio > 0.3) add(p.id, bid, null, '内容冗余', `英文篇章混入中文（占比 ${(hanRatio * 100).toFixed(0)}%）`);
        }
        const glued = findGluedWords(m);
        if (glued.length) add(p.id, bid, null, '空格缺失', `篇章词间空格缺失：${[...new Set(glued)].slice(0, 6).join(' / ')}`);
        if (/\s{4,}/.test(m)) add(p.id, bid, null, '空格缺失', '篇章含异常连续空白');
        if (/(.)\1{6,}/.test(m)) add(p.id, bid, null, '内容冗余', '篇章含重复字符噪声');
      } else if (bid.includes('L') || bid.includes('banked') || bid.includes('long') || bid.includes('rd')) {
        add(p.id, bid, null, '信息缺失', '篇章/听力原文缺失');
      }

      /* ---------- 长篇阅读：段落标题 ---------- */
      if (bid.includes('long')) {
        const qs = b.questions || [];
        if (qs.length < 10) add(p.id, bid, null, '信息缺失', `长篇阅读仅 ${qs.length} 题（应为 10）`);
      }

      for (const q of b.questions || []) {
        stats.questions++;
        const groups = Object.keys(q.options || {}).length;
        const isBanked = bid.includes('banked');
        // 选词填空（26–35）与长篇阅读（36–45）的选项就是 A–O 字母格，
        // UI 走 letterOnly 渲染，数据里 options 恒为 {} —— 属正常，不算缺失。
        const isLettersOnly = isBanked || bid.includes('long');

        /* 1. 选项缺失 */
        if (!isLettersOnly) {
          if (groups === 0) add(p.id, bid, q.num, '选项缺失', '选项为空');
          else if (groups < 4) add(p.id, bid, q.num, '选项缺失', `仅 ${groups} 个选项（应为 4）`);
          else if (groups > 4) add(p.id, bid, q.num, '内容冗余', `${groups} 个选项（应为 4）`);
        }
        for (const [k, v] of Object.entries(q.options || {})) {
          if (!v || !String(v).trim()) add(p.id, bid, q.num, '选项缺失', `选项 ${k} 内容为空`);
        }
        const ocn = Object.keys(q.optionCn || {}).length;
        if (!isBanked && groups >= 4 && ocn === 0) add(p.id, bid, q.num, '信息缺失', '选项译文缺失');

        /* 4. 信息缺失：题干 / 答案 / 解析 */
        // 选词填空的「题干」就是篇章里的 ___26___，独立 stem 字段恒空，属正常
        if (!isBanked && (!q.stem || !String(q.stem).trim())) add(p.id, bid, q.num, '信息缺失', '题干为空');
        if (!q.answer) add(p.id, bid, q.num, '信息缺失', '答案缺失');
        if (!q.analysis || String(q.analysis).trim().length < 10)
          add(p.id, bid, q.num, '信息缺失', '解析缺失或过短');

        /* 2. 空格缺失：题干/选项里的英文粘连 */
        const en = [q.stem, ...Object.values(q.options || {})].filter(Boolean).join(' ');
        const gq = findGluedWords(en);
        if (gq.length) add(p.id, bid, q.num, '空格缺失', `题干/选项词间空格缺失：${[...new Set(gq)].slice(0, 5).join(' / ')}`);

        /* 3. 内容冗余：解析噪声 */
        const an = String(q.analysis || '');
        for (const [re, label] of noisePatterns) {
          if (re.test(an)) add(p.id, bid, q.num, '内容冗余', `解析·${label}`);
        }
        if (an.length > 1200) add(p.id, bid, q.num, '内容冗余', `解析过长（${an.length} 字符）`);
        if (hasDupFragment(an)) add(p.id, bid, q.num, '内容冗余', '解析重复片段');
      }
    }
  }
}

/* ---------- 汇总 ---------- */
const byType = {};
for (const i of stats.issues) byType[i.type] = (byType[i.type] || 0) + 1;

console.log(`试卷 ${stats.papers} 套 / 区块 ${stats.blocks} / 题目 ${stats.questions}`);
console.log(`问题总数 ${stats.issues.length}`);
console.log('\n按类型：');
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(6)} ${v}`);

console.log('\n按试卷（前 15）：');
const byPaper = {};
for (const i of stats.issues) byPaper[i.paperId] = (byPaper[i.paperId] || 0) + 1;
for (const [k, v] of Object.entries(byPaper).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k.padEnd(18)} ${v}`);

console.log('\n样例（每类前 8）：');
const shown = {};
for (const i of stats.issues) {
  shown[i.type] = (shown[i.type] || 0) + 1;
  if (shown[i.type] <= 8) console.log(`  [${i.type}] ${i.paperId} ${i.blockId}#${i.num ?? '-'} — ${i.detail}`);
}

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(stats.issues, null, 2), 'utf8');
  console.log(`\n明细已写入 ${OUT}`);
}
