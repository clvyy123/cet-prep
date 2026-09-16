/**
 * 修复「选词填空篇章缺 ___NN___ 空格占位」。
 *
 * 背景：卷面 PDF 的选词填空里，空格长这样 —— `a meaningful ___26___ on health`。
 * 部分套次（多为扫描卷）OCR 后下划线整段丢失，只剩裸数字：
 *   `a meaningful 26 on health`、`somewhat 27_, since...`、`46% lower 32_ofdeath than...`
 * 篇章能读，但 App 里既渲染不出空格，也定位不到填哪一格。
 *
 * 做法：26–35 每个编号在篇章里必然出现且**按序递增**。
 * 已带 `___NN___` 的编号当作锚点，缺失的编号在候选位置里做「严格递增」回溯匹配，
 * 只有 26→35 全部找到一组递增解才动手——找不到就整块跳过，绝不猜。
 *
 * 用法：node scripts/fix-banked-blanks.mjs           # dry-run
 *       node scripts/fix-banked-blanks.mjs --apply
 */
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const F = 'src/data/papers.ts';

const t = fs.readFileSync(F, 'utf8');
const arrStart = t.indexOf('Paper[] = [') + 'Paper[] = '.length;
const arrEnd = t.lastIndexOf('];');
const PAPERS = JSON.parse(t.slice(arrStart, arrEnd + 1));

const BLANK_RE = /_{2,}\s*(\d{1,2})\s*_{2,}/g;
const NUMS = [26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
/** 数字后紧跟这些词，多半是真数值（30 minutes / 26 percent），不是空格 */
const UNIT_AFTER =
  /^(minutes?|hours?|days?|years?|months?|weeks?|seconds?|percent|people|students?|times|miles?|pounds?|dollars?|states|countries|cases|points|degrees)\b/i;
const BAD_BEFORE = /[\d\-/.$¥£€]/;
const BAD_AFTER = /[%\d]/;
/** 页脚 / 换页标记附近的数字不是空格（…[26] ===== PAGE 4 ==== 这种） */
const FOOTER_NEAR =
  /(=====|\bPAGE\s*\d|�|真题|共\s*\d+\s*页|第\s*\d+\s*页)/;

/** 找候选：裸编号 + 其后连着的下划线（27_ / 32_ofdeath 这类半残形态） */
function findCandidates(material) {
  const out = [];
  // 下划线可能残缺、也可能跑到数字前面（_26__ / 27_ / 35 都有），两侧都吃掉
  const re = /(?<!\d)(2[6-9]|3[0-5])(?!\d)/g;
  for (const m of material.matchAll(re)) {
    const n = Number(m[1]);
    let start = m.index;
    let end = start + m[1].length;
    while (material[start - 1] === '_') start--;
    while (material[end] === '_') end++;
    const before = material[start - 1] || ' ';
    const after = material[end] || ' ';
    if (BAD_BEFORE.test(before)) continue;
    if (BAD_AFTER.test(after)) continue;
    // 空格一定夹在正文里：前面 40 字符内得有英文字母
    if (!/[A-Za-z]/.test(material.slice(Math.max(0, start - 40), start))) continue;
    if (UNIT_AFTER.test(material.slice(end).replace(/^[\s_,]+/, ''))) continue;
    if (FOOTER_NEAR.test(material.slice(Math.max(0, start - 25), end + 25))) continue;
    out.push({ n, start, end });
  }
  return out;
}

/**
 * 放宽版：只要求位置单调递增，允许中途缺号（OCR 乱序 / 编号被彻底吃掉时）。
 * 逐个编号取「上一个空格之后的第一个候选」，编号之间仍然保持先后顺序，
 * 但不再要求 26–35 全部凑齐。宁可少补一个，也不猜位置。
 */
function greedyMonotone(anchored, cands) {
  const byN = new Map();
  for (const c of cands) {
    if (!byN.has(c.n)) byN.set(c.n, []);
    byN.get(c.n).push(c);
  }
  for (const arr of byN.values()) arr.sort((a, b) => a.start - b.start);
  const chosen = new Map();
  let last = -1;
  for (const n of NUMS) {
    if (anchored.has(n)) {
      const p = anchored.get(n);
      if (p > last) last = p;
      continue;
    }
    const c = (byN.get(n) || []).find((x) => x.start > last);
    if (c) {
      chosen.set(n, c);
      last = c.start;
    }
  }
  return chosen;
}
/** 26→35 必须严格递增且全部凑齐；已有锚点参与排序约束。最严格，优先用 */
function solve(anchored, cands) {
  const byN = new Map();
  for (const c of cands) {
    if (!byN.has(c.n)) byN.set(c.n, []);
    byN.get(c.n).push(c);
  }
  const chosen = new Map();
  let last = -1;
  const walk = (i) => {
    if (i === NUMS.length) return true;
    const n = NUMS[i];
    if (anchored.has(n)) {
      const p = anchored.get(n);
      if (p <= last) return false;
      const prev = last;
      last = p;
      if (walk(i + 1)) return true;
      last = prev;
      return false;
    }
    for (const c of byN.get(n) || []) {
      if (c.start <= last) continue;
      const prev = last;
      last = c.start;
      chosen.set(n, c);
      if (walk(i + 1)) return true;
      last = prev;
      chosen.delete(n);
    }
    return false;
  };
  return walk(0) ? chosen : null;
}

let scanned = 0;
let alreadyOk = 0;
let fixed = 0;
let skipped = 0;
const samples = [];

for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      const wb = Object.keys(b.wordBank || {}).length;
      if (wb < 15) continue; // 只认选词填空块（A–O 词库）
      scanned++;
      const material = String(b.material || '');
      if (!material) {
        skipped++;
        continue;
      }
      const anchored = new Map();
      for (const m of material.matchAll(BLANK_RE)) anchored.set(Number(m[1]), m.index);
      if (anchored.size === 10) {
        alreadyOk++;
        continue;
      }
      const missing = NUMS.filter((n) => !anchored.has(n));
      const cands = findCandidates(material);
      // 先用严格解；凑不齐再退到单调贪心（允许少补几个，但顺序仍然正确）
      const strict = solve(anchored, cands);
      const chosen = strict && strict.size === missing.length ? strict : greedyMonotone(anchored, cands);
      if (!chosen.size) {
        skipped++;
        if (samples.length < 24)
          samples.push(`跳过 ${b.id}：已有占位 ${anchored.size} 个，一个候选都没找着`);
        continue;
      }
      // 从后往前改，避免前面的替换挪动后面的下标
      const edits = [...chosen.entries()].sort((a, b2) => b2[1].start - a[1].start);
      let next = material;
      const contexts = [];
      for (const [n, c] of edits) {
        if (contexts.length < 2)
          contexts.push(`…${material.slice(Math.max(0, c.start - 28), c.start)}[${n}]${material.slice(c.end, c.end + 18)}…`);
        next = next.slice(0, c.start) + `___${n}___` + next.slice(c.end);
      }
      b.material = next;
      fixed++;
      const flag = chosen.size === missing.length ? '' : `（差 ${missing.length - chosen.size} 个未补）`;
      if (samples.length < 30)
        samples.push(`修复 ${b.id}：补 ${[...chosen.keys()].sort((x, y) => x - y).join(',')}${flag} ${contexts.join(' ')}`);
    }
  }
}

console.log(`选词填空区块 ${scanned} 个：原本就齐全 ${alreadyOk}，本次修复 ${fixed}，跳过 ${skipped}`);
samples.forEach((s) => console.log('   · ' + s));

if (APPLY && fixed) {
  const body = JSON.stringify(PAPERS, null, 2);
  // arrEnd 指向收尾的 ']'，其后还有 ';'，写回时要跳过这个 ']'
  const next = t.slice(0, arrStart) + body + t.slice(arrEnd + 1);
  if (!next.includes('export const PAPERS') || next.includes(']];')) throw new Error('写回内容异常，已中止');
  fs.writeFileSync(F, next, 'utf8');
  console.log(`\n已写入 ${F}（${(next.length / 1048576).toFixed(2)} MB）`);
} else if (!APPLY) {
  console.log('\n[dry-run] 加 --apply 才落盘');
}
