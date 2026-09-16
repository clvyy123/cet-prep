#!/usr/bin/env node
// 修 papers.ts 里「有明显错误」的选项文本
//
//   node scripts/lz-fix-options.mjs            # dry-run：只出统计与样例
//   node scripts/lz-fix-options.mjs --apply    # 落盘（自动备份 .bak4）
//
// 错误形态（都是抓取/OCR 的伤）：
//   1. 选项尾巴吞进了下一节的 Directions 或页脚 ——
//      D: "To boost the growth of the chocolate industry Section B Directions: In this section, you
//          will hear two long conversations. ... four choices marked"
//      D: "It doesn't seem to be a balanced diet. ===== PAGE 2 ====="
//   2. 词被拆开：Deter mining / As king Jake / un wan ted
//
// 做法：站点的选项文本是干净的，按「文本相似」把本地每个字母配到一个站点字母，再按规则覆盖：
//         · 原文相等 / 去非字母数字后相等  → 直接采用站点文本（处理拆词）
//         · 前缀命中（本地尾巴多了东西）    → 截断成站点文本
//         · dice ≥ 0.75                  → 用站点文本
//
// **字母顺序以站点为准（OPT_REORDER）**。证据（2026-09-13 实测，推翻本文件早先的相反结论）：
//   站点有两套独立页面 —— 「试卷排版页」/cetX/paper/<套>/<题型>/ 自称「与考试一致」，
//   和「解析页」/cetX/sections/<套>/<题型>/。两者对 cet4-2025-12-1 第 1 题给出**完全相同**的
//   选项顺序（A Outside the office… / B Inside the car… / C Under the engine… / D At the gate…），
//   而本地恰好是整题倒序。本地卷面来自扫描件 OCR，HANDOVER §2.4 记录的根因正是
//   「双栏排版 A)…C)… 换行 B)…D)…，早期导入只取到左栏」—— 顺序错位是已知失败模式。
//   且 HANDOVER §2.2 用户定版：「站点是权威源，选项无条件以站点为准」。
//   仓库里并不存在支撑「站点顺序错」的报告。
//
// 两道门禁，防止拿错套卷的选项去覆盖：
//   ① 该题每个本地选项都要配上站点选项（不允许只剩半个）；
//   ② 至少有两个是「实打实」命中的（相等 / 去符号相等 / dice≥0.6），不能全靠前缀。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVocab, _dict } from './lib-spacing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LZ = path.join(ROOT, '.qa', 'lazynote');
const APPLY = process.argv.includes('--apply');

const nrm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** 词级签名：按空白切词、逐词去符号再排序 —— 只有标点/引号差异的两串签名相同 */
const _sig = s => (s || '').toLowerCase().match(/[^\s]+/g)?.map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean).sort().join(' ') ?? '';
const toks = s => new Set((s || '').toLowerCase().match(/[a-z0-9]+/g) || []);
const dice = (a, b) => {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const t of A) if (B.has(t)) i++;
  return (2 * i) / (A.size + B.size);
};

// ---- 本地兜底：把选项里黏在一起的词拆开（站点对不上的题只能靠这一步）----
// 只在「整个 token 不是词，但能切成 2–4 段、每段都是词」时动手，切不动就不动。
const FUNC = new Set(['an','of','to','in','on','at','by','or','and','the','is','it','as','be','no','so','up','we','he','if','do','my','me','us','her','its','our','this','that','not','for','with','from','than','then','when','what','who','how','why','can','will','has','had','was','were','are','you','she','they','one','two','all','but','out','off','over','into','upon','any','own','just','been','also','very','more','most','some','such','only','both','each','much','many']);
const isAnyWord = t => (t.length < 3
  ? FUNC.has(t)
  : isWord(t) || cetWords.has(t) || cetWords.has(t.replace(/(ing|ed|ly|ment|ness|tion|s|able|ible)$/, '')) || FUNC.has(t));
/** token 拆成 2–4 段、每段都是词；返回最少段数的切法，切不动返回 null */
function splitGlue(tok) {
  const s = tok.toLowerCase();
  if (s.length < 9 || isAnyWord(s)) return null;
  const memo = new Map();
  const go = i => {
    if (i === s.length) return [];
    if (memo.has(i)) return memo.get(i);
    let best = null;
    for (let j = i + 2; j <= s.length && j - i <= 12; j++) {
      const part = s.slice(i, j);
      if (!isAnyWord(part)) continue;
      const rest = go(j);
      if (rest && (!best || rest.length + 1 < best.length)) best = [part, ...rest];
    }
    memo.set(i, best);
    return best;
  };
  const parts = go(0);
  return parts && parts.length > 1 && parts.length <= 4 ? parts : null;
}
/** 把选项里黏在一起的 token 拆开 */
const unglue = text => text.split(/(\s+)/).map(w => {
  if (/\s/.test(w) || !/[a-z]/i.test(w) || w.length < 9) return w;
  if (/[-']/.test(w)) return w;              // forty-nine-year 这种连字符复合词不能拆
  const tail = /[.,!?]$/.test(w) ? w.slice(-1) : '';
  const parts = splitGlue(w.replace(/[^A-Za-z]/g, ''));
  return parts ? parts.join(' ') + tail : w;
}).join('');

const SITE = {};
for (const f of fs.readdirSync(path.join(LZ, 'extract'))) {
  if (!/^cet[46]-\d{4}-\d{2}-\d+\.json$/.test(f)) continue;
  const j = JSON.parse(fs.readFileSync(path.join(LZ, 'extract', f), 'utf8'));
  const qs = {};
  for (const p of j.pages) for (const q of p.questions) qs[q.num] = q;
  SITE[j.key] = qs;
}

const file = path.join(ROOT, 'src/data/papers.ts');
const src = fs.readFileSync(file, 'utf8');
const eq = src.indexOf('=', src.indexOf('PAPERS: Paper[] ='));
const a = src.indexOf('[', eq), b = src.lastIndexOf(']');
const PAPERS = JSON.parse(src.slice(a, b + 1));

// 词典：直接用 lib-spacing 的那套（CET 词表 + 语料词频），口径与空格修复一致
buildVocab(PAPERS);
const { freq, cetWords } = _dict();
const isWord = w => w.length > 2 && ((freq.get(w) || 0) >= 2 || cetWords.has(w));
// 弯引号先归一化再切词，否则 year’s 会被切成 year + s，误判成「拆词」
const words = s => (s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').match(/[a-z0-9']+/g) || [];
/** 本地把词拆开了（Deter mining / boy friend / un wan ted）且拼回去是词典里的真词 */
function isSplitError(local, site) {
  const lt = words(local), st = words(site).map(t => t.replace(/[^a-z0-9]/g, ''));
  if (lt.length <= st.length) return false;
  for (let i = 0; i + 1 < lt.length; i++) {
    const merged = (lt[i] + lt[i + 1]).replace(/[^a-z0-9]/g, '');
    // 词典只收原形，派生形式（attainable / catering）要剥掉后缀再查
    const base = merged.replace(/(able|ible|ing|ed|ly|ment|ness|tion|s)$/, '');
    if ((isWord(merged) || cetWords.has(base)) && st.includes(merged)) return true;
  }
  return false;
}
/** 本地有不像词的碎片，站点那边没有（OCR 错字） */
const badWords = s => [...new Set(words(s).map(t => t.replace(/[^a-z0-9]/g, '')))].filter(t => t.length >= 4 && !isWord(t));
/** 只有一处词不同，且本地那个词几乎不出现（freq≤1）、站点那个词很常见 —— 典型的 OCR 错字
 *  例：biome(1) → home(129)   /   shit(0) → shift(37) */
function isTypoSwap(local, site) {
  const a = words(local).map(t => t.replace(/[^a-z0-9]/g, ''));
  const b = words(site).map(t => t.replace(/[^a-z0-9]/g, ''));
  if (a.length !== b.length) return false;
  const diff = a.map((t, i) => (t === b[i] ? null : i)).filter(i => i !== null);
  if (diff.length !== 1) return false;
  const i = diff[0];
  return (freq.get(a[i]) || 0) <= 1 && (freq.get(b[i]) || 0) >= 10;
}

/** 去掉一切非字母数字后的编辑距离相似度 —— 处理「£ 被 OCR 成 f」这种一个字符的伤 */
function cleanSim(a, b) {
  const s = nrm(a), t = nrm(b);
  if (!s && !t) return 0;
  const m = s.length, n = t.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
/** 孤立单字母（a / I 除外）—— £ 被识别成 f 之后留下的痕迹 */
const hasStrayLetter = s => /(^|\s)[b-hj-z](\s|$)/i.test(s || '');

/** 两道题的选项集有多像（本地每个选项都能在站点选项里找到近邻的比例） */
const qsim = (lo, so) => {
  const l = Object.values(lo || {}).filter(Boolean), t = Object.values(so || {}).filter(Boolean);
  if (l.length < 2 || l.length !== t.length) return 0;
  const used = new Set(); let hit = 0;
  for (const x of l) for (let i = 0; i < t.length; i++) {
    if (used.has(i) || dice(x, t[i]) < 0.6) continue;
    used.add(i); hit++; break;
  }
  return hit / l.length;
};

const stats = {}, ops = [], skipped = [], ungluedOpts = new Set();
const bump = (t, setId, num, letter, from, to) => {
  stats[t] = (stats[t] || 0) + 1;
  ops.push({ setId, num, letter, type: t, from, to });
};

// ---- 第一遍：砍掉选项尾巴上的抽取残留（不依赖站点，只做截断）----
// 形态：吞进下一节的 Directions、OCR 页脚 "===== PAGE 2 ====="、
//       "2022年9月英语四级真题1套第8页共10页"、"2023-03-CET6(第1套)-7"
const ARTIFACT = [
  /\s+Section\s+[ABC]\s+Directions[\s\S]*$/i,
  /\s+(?:Section\s*[ABC]|Part\s*[IVX]+)\s*[.:]?\s*$/i,   // 尾巴只剩 "Section B" / "SectionC" / "Part IV"
  /\s*=+\s*PAGE\s*\d*[\s\S]*$/i,
  /\s+\d{4}-\d{2}-CET[46][\s\S]*$/i,
  /\s+\d{4}\s*年\s*\d{1,2}\s*月[\s\S]{0,60}?(真题|考试)[\s\S]*$/i,
];
const cutArtifact = s => {
  let out = s;
  for (const re of ARTIFACT) out = out.replace(re, '');
  return out.trim();
};

for (const p of PAPERS) {
  for (const sec of p.sections) for (const bl of sec.blocks || []) for (const q of bl.questions || []) {
    for (const [k, v] of Object.entries(q.options || {})) {
      if (!v) continue;
      const cut = cutArtifact(v);
      if (cut && cut !== v && cut.length >= 8) { bump('TRUNCATE_ARTIFACT', p.id, q.num, k, v, cut); q.options[k] = cut; }
    }
  }
}

for (const p of PAPERS) {
  const S = SITE[p.id.replace(/_/g, '-')];
  if (!S) continue;
  // 套卷级门禁：整卷与站点选项集像不像（防拿错套卷的选项去覆盖）
  const sims = [];
  for (const sec of p.sections) for (const bl of sec.blocks || []) for (const q of bl.questions || [])
    if (Object.keys(q.options || {}).length >= 2 && Object.keys(S[q.num]?.options || {}).length >= 2) sims.push(qsim(q.options, S[q.num].options));
  const setSim = sims.length ? sims.reduce((x, y) => x + y, 0) / sims.length : 0;
  if (setSim < 0.8) { skipped.push({ setId: p.id, num: 0, why: `整卷与站点选项集对不上（${(setSim * 100).toFixed(0)}%）` }); continue; }

  for (const sec of p.sections) for (const bl of sec.blocks || []) for (const q of bl.questions || []) {
    const lo = q.options || {}, so = S[q.num]?.options || {};
    // 无选项题（长篇阅读的陈述句）：没有选项可做门禁，用词元相似度兜底修题干
    if (Object.keys(lo).length < 2 || Object.keys(so).length < 2) {
      const s0 = S[q.num] || {};
      // 无选项题（长篇陈述句）没有选项可当证据，只有「本地有超长粘连块」或内容确实相近时才动
      const blob0 = Math.max(0, ...words(q.stem).map(t => t.length)) >= 16;
      if (s0.stem && s0.stem !== q.stem
        && (nrm(s0.stem) === nrm(q.stem || '') || blob0 || dice(q.stem, s0.stem) >= 0.45)) {
        bump('STEM', p.id, q.num, '', q.stem || '', s0.stem); q.stem = s0.stem;
      }
      if (s0.stemCn && nrm(s0.stemCn) !== nrm(q.stemCn || '') && (dice(q.stemCn, s0.stemCn) >= 0.45 || !q.stemCn)) {
        bump('STEM_CN', p.id, q.num, '', q.stemCn || '', s0.stemCn); q.stemCn = s0.stemCn;
      }
      continue;
    }
    const L = Object.keys(lo).filter(k => lo[k]);
    const Sl = Object.keys(so).filter(k => so[k]);
    if (L.length < 2 || Sl.length < 2) continue;

    // ---- 配对：本地字母 → 站点字母 ----
    const map = {}, used = new Set();
    let hit = 0, strong = 0;
    for (const k of L) {
      let best = '', bs = 0, bStrong = false;
      for (const sk of Sl) {
        if (used.has(sk)) continue;
        const site = so[sk], nl = nrm(lo[k]), ns = nrm(site);
        let sc = dice(lo[k], site), st = sc >= 0.6;
        if (cleanSim(lo[k], site) >= 0.85) { sc = Math.max(sc, 0.9); st = true; }   // 近乎一模一样（只差一个字符）
        if (nl && nl === ns && lo[k] !== site) { sc = 1.1; st = true; }      // 只差空格/引号/拆词
        else if (lo[k] === site) { sc = 1.2; st = true; }
        else if (ns.length >= 8 && nl.startsWith(ns)) { sc = 1.0; }          // 本地尾巴多了东西
        if (sc > bs) { bs = sc; best = sk; bStrong = st; }
      }
      if (bs >= 0.6) { map[k] = best; used.add(best); hit++; if (bStrong) strong++; }
    }
    if (strong < 2) { skipped.push({ setId: p.id, num: q.num, why: `选项集只能配上 ${strong} 个` }); continue; }

    // ---- 题干：站点是官方卷面文本，本地是 OCR（What didboth Alan Robinsonand …）----
    // 有选项做门禁的题 → 直接采用站点题干；
    // 长篇阅读陈述句没有选项可做门禁 → 用词元相似度或「本地有超长粘连块」兜底
    const sq = S[q.num] || {};
    const blob = Math.max(0, ...words(q.stem).map(t => t.length)) >= 16;
    // 注意：这里的判据是「原文不同就采用站点」，不能写成 nrm 不等 ——
    // 本地的伤多半只是**吞了空格**（What didboth Alan Robinsonand…），nrm 之后反而相等，会漏修
    if (sq.stem && sq.stem !== q.stem) {
      bump('STEM', p.id, q.num, '', q.stem || '', sq.stem);
      q.stem = sq.stem;
    }
    // stemCn 不改：做题界面已经不渲染题干译文，改了是死数据（papers 的 stemCn 目前无消费方）

    // ---- 整组替换：采用官方卷面的字母顺序 ----
    //  ① 全部字母都能与站点一一对应（顺序错位 / 只有格式差异）
    //  ② 或站点有一组完整选项、且本地至少 2 个与之严丝合缝（确认是同一题）——
    //     这种题本地往往有 1–2 个选项是**相邻题目的内容串进来的**（双栏只取左栏的已知失败模式），
    //     例如 cet4-2023_12_1#4 的 C/D 其实是第 3 题的选项；必须整组换成站点的。
    const fullBijection = Object.keys(map).length === L.length && new Set(Object.values(map)).size === L.length;
    const sameShape = Sl.length === L.length && Sl.length >= 3 && strong >= 2;
    if (fullBijection || sameShape) {
      const why = fullBijection ? '全组' : '整组换（本地混入他题选项）';
      const oldOpts = q.options, oldCn = q.optionCn || {};
      if (JSON.stringify(oldOpts) !== JSON.stringify(so)) {
        bump('OPT_REORDER', p.id, q.num, why, oldOpts, so);
        q.options = { ...so };
        // 中译跟着新字母走：优先用站点的；站点没有就按「选项原文」把本地中译重新挂字母
        if (sq.optionCn && Object.keys(sq.optionCn).length) {
          if (JSON.stringify(oldCn) !== JSON.stringify(sq.optionCn)) { bump('OPT_CN', p.id, q.num, why, oldCn, sq.optionCn); q.optionCn = { ...sq.optionCn }; }
        } else {
          const remap = {};
          for (const [nl2, nv] of Object.entries(so)) {
            const hit2 = Object.entries(oldCn).find(([ol2, ov]) =>
              nrm(ol2) === nl2 || nrm(oldOpts[ol2]) === nrm(nv) || dice(oldOpts[ol2], nv) >= 0.7);
            if (hit2) remap[nl2] = hit2[1];
          }
          if (Object.keys(remap).length) { bump('OPT_CN', p.id, q.num, why, '重挂', remap); q.optionCn = remap; }
        }
        // 答案字母跟着官方卷面走；但要确认该字母在新选项组里真实存在，别把答案指到空气上
        if (sq.answer && so[sq.answer] && q.answer !== sq.answer) { bump('ANSWER', p.id, q.num, why, q.answer, sq.answer); q.answer = sq.answer; }
      }
      continue;
    }

    // ---- 局部：只修文本，不动字母 ----
    for (const k of L) {
      if (!map[k]) continue;                                 // 没配上的字母不动
      const site = so[map[k]], local = lo[k];
      let type = '';
      if (local === site) continue;
      if (nrm(site) && nrm(local) === nrm(site)) type = 'FIX_FORMAT';   // 内容相同、只是空格/引号/拆词不同
      else if (nrm(site) && nrm(local).startsWith(nrm(site)) && nrm(local).length > nrm(site).length) type = 'TRUNCATE_BLOB';
      else if (isSplitError(local, site)) type = 'FIX_SPLIT';
      else if (isTypoSwap(local, site) || (dice(local, site) >= 0.6 && badWords(local).length > badWords(site).length)
        || (cleanSim(local, site) >= 0.9 && hasStrayLetter(local))) type = 'FIX_TYPO';
      if (!type) continue;                                   // 判不准就不动（宁可留着，不改错）
      bump(type, p.id, q.num, k, local, site);
      q.options[k] = site;
      // 文本动过 → 中译跟着站点的对应字母走（原来的中译可能挂在被打乱的字母上）
      const cn = S[q.num]?.optionCn?.[map[k]];
      if (q.optionCn && cn && q.optionCn[k] !== cn) {
        bump('FIX_OPTION_CN', p.id, q.num, k, q.optionCn[k] || '', cn);
        q.optionCn[k] = cn;
      }
    }
    // 站点没覆盖到的字母：本地兜底拆粘连
    for (const k of L) {
      if (map[k] || !q.options[k]) continue;
      const fixed = unglue(q.options[k]);
      if (fixed !== q.options[k]) { bump('FIX_GLUE', p.id, q.num, k, q.options[k], fixed); q.options[k] = fixed; }
    }
  }
}

// ================= 模拟考试库（builtin-banks.ts）=================
// 它的 options 是**数组**（下标 0 = A），答案存字母；同样的 OCR 顺序错位与混入他题选项问题。
const banksFile = path.join(ROOT, 'src/data/builtin-banks.ts');
const banksBak = path.join(LZ, 'builtin-banks.ts.bak4');
if (APPLY && !fs.existsSync(banksBak)) fs.copyFileSync(banksFile, banksBak);
const bsrc = fs.readFileSync(banksFile, 'utf8');
const beq = bsrc.indexOf('=', bsrc.indexOf('BUILTIN_BANKS: BuiltinBank[] ='));
const ba = bsrc.indexOf('[', beq), bb = bsrc.lastIndexOf(']');
const BANKS = JSON.parse(bsrc.slice(ba, bb + 1));

for (const bk of BANKS) {
  const S = SITE[bk.meta.id.replace(/^bi-/, '').replace(/_/g, '-')];
  if (!S) continue;
  for (const kind of ['listening', 'reading']) for (const it of bk[kind] || []) for (const q of it.questions || []) {
    const s = S[q.num], so = s?.options || {};
    const Sl = Object.keys(so).filter(k => so[k]);
    const lo = Array.isArray(q.options) ? q.options : [];
    if (Sl.length < 2 || lo.length < 2) continue;
    if (Sl.length < lo.length) continue;   // 站点反而更少 → 别把本地选项删掉（站点缺项时宁可保留）
    // 门禁：站点选项里至少 2 个能在本地找到内容近亲
    let strong = 0;
    for (const v of Object.values(so)) {
      const st = lo.some(x => dice(x, v) >= 0.6 || nrm(x) === nrm(v) || cleanSim(x, v) >= 0.85);
      if (st) strong++;
    }
    if (strong < 2) { skipped.push({ setId: bk.meta.id, num: q.num, why: `选项集只能配上 ${strong} 个` }); continue; }
    const next = Sl.map(k => so[k]);
    if (JSON.stringify(next) !== JSON.stringify(lo)) {
      bump('BANK_OPT_REORDER', bk.meta.id, q.num, '全组', lo, next);
      q.options = next;
    }
    if (s.answer && so[s.answer] && q.answer !== s.answer) { bump('BANK_ANSWER', bk.meta.id, q.num, '全组', q.answer, s.answer); q.answer = s.answer; }
  }
}

console.log(`${APPLY ? '已落盘' : 'dry-run'}  ` + Object.entries(stats).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`改动 ${ops.length} 处 · 整题跳过 ${skipped.length} 题`);
const show = (t, n) => { for (const o of ops.filter(x => x.type === t).slice(0, n))
  console.log(`  [${t}] ${o.setId} #${o.num} ${o.letter}\n     前: ${JSON.stringify(o.from).slice(0, 140)}\n     后: ${JSON.stringify(o.to).slice(0, 140)}`); };
console.log('样例：'); show('TRUNCATE_BLOB', 3); show('FIX_SPLIT', 6); show('FIX_TYPO', 5);
const byWhy = {}; for (const s of skipped) byWhy[s.why] = (byWhy[s.why] || 0) + 1;
console.log('跳过构成：', JSON.stringify(byWhy));
const bySet = {}; for (const s of skipped) bySet[s.setId] = (bySet[s.setId] || 0) + 1;
console.log('跳过最多的套：', Object.entries(bySet).sort((x, y) => y[1] - x[1]).slice(0, 8).map(x => x.join('=')).join(' '));

// dry-run 写 .dryrun.json，不覆盖 --apply 生成的权威清单
fs.writeFileSync(path.join(LZ, APPLY ? 'option-fixes.json' : 'option-fixes.dryrun.json'), JSON.stringify({ stats, ops, skipped }, null, 1));
if (!APPLY) { console.log('\n（dry-run，未写入）'); process.exit(0); }
const bak = path.join(LZ, 'papers.ts.bak4');
if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
fs.writeFileSync(file, src.slice(0, a) + JSON.stringify(PAPERS, null, 2) + src.slice(b + 1));
fs.writeFileSync(banksFile, bsrc.slice(0, ba) + JSON.stringify(BANKS, null, 2) + bsrc.slice(bb + 1));
console.log(`已写入 papers.ts + builtin-banks.ts；备份 ${path.relative(ROOT, bak)} / ${path.relative(ROOT, banksBak)}；清单 .qa/lazynote/option-fixes.json`);
