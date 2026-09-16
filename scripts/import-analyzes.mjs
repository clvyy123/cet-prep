// 导入答案解析：把《答案解析》txt（双栏 OCR 扫描版）解析为 analysis.json
// 用法：node scripts/import-analyzes.mjs <txt路径> <输出analysis.json路径>
// 输出结构（与 build-banks.mjs 的 analysisJson 约定一致）：
// {
//   "analysis": { "listening": {题号:解析}, "banked": {...}, "long": {...}, "reading": {...} },
//   "translation": { "reference": "参考译文" },
//   "writing": { "sample": "参考范文" }
// }
import fs from 'node:fs';
import path from 'node:path';

const txt = process.argv[2];
const out = process.argv[3];
if (!txt || !out) {
  console.error('用法: node scripts/import-analyzes.mjs <txt路径> <输出路径>');
  process.exit(1);
}
const text = fs.readFileSync(txt, 'utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/);

// ---------- 解析块切分 ----------
// 解析标记：题干之后，解析正文以这些开头
const MARK = /(?:精析|定位|考点|语法判断|语义判断|语义理解|细节|推理|同义|结构分析|避错|主旨|归纳|辨认|判断|转述|定位句)/;
// 右栏题号（行中出现）：数字 + (定位/考点/精析/语义/语法/结构/避错…
const RIGHT_Q = /(\d{1,2})[.、。]?\s*[(（\[【]\s*(?:定位|考点|精析|语义|语法|结构|避错)/;
// 右栏题号（行中出现）：数字 + 英文题干（听力"2. What did..." 双栏混排）
// 仅听力块(1-25)启用，避免误伤阅读正文中的 "46. " 年份式标点
const RIGHT_Q2 = /(\d{1,2})\s*[.、。]\s*(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here|Could|Would|Should)\b/i;
// 行首题号（左栏）：题号后跟括号标记/中文/英文题干（听力为英文题干，无括号）
const Q_HEAD = /^(\d{1,2})[.、。]?\s*(?=[A-Z©(（\[【]|[\u4e00-\u9fff]|$)/;

function cleanText(s) {
  return s
    .replace(/\uFFFD/g, '')
    .replace(/\bTheres\b/g, "There's")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。；：、！？)）\]】])/g, '$1')
    .replace(/[，。] (?=[，。])/g, '')
    .replace(/^\s+|\s+$/g, '')
    .trim();
}

// 英文问句开头词（含 OCR 损坏的首字母：ow=How, hy=Why, hat=What 等）
const Q_WORDS = /(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here|Could|Would|Should)\b/i;

// 把一个"答案详解"块按题号归位（处理双栏：行首题号 + 行中题号 + 缺失题号推断）
function extractByNum(block, minNum, maxNum, inferredStart) {
  const blocks = new Map();
  let cur = null;
  const push = (n, seg) => {
    const t = cleanText(seg);
    if (t) {
      if (!blocks.has(n)) blocks.set(n, []);
      blocks.get(n).push(t);
    }
  };

  // 预扫描：找到所有带题号的行，推断块头和中段缺失的题号
  const lines = block.split('\n');
  const numbered = []; // { lineIdx, n }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(Q_HEAD);
    if (m) {
      const n = Number(m[1]);
      if (n >= minNum && n <= maxNum) numbered.push({ lineIdx: i, n });
    }
    const r = lines[i].trim().match(RIGHT_Q);
    if (r) {
      const n = Number(r[1]);
      if (n >= minNum && n <= maxNum) numbered.push({ lineIdx: i, n });
    }
    const r2 = lines[i].trim().match(RIGHT_Q2);
    if (r2 && minNum === 1) {
      const n = Number(r2[1]);
      if (n >= minNum && n <= maxNum) numbered.push({ lineIdx: i, n });
    }
  }
  // 插入缺失题号集合
  const missingSet = new Set();
  if (numbered.length > 0) {
    const firstN = numbered[0].n;
    // 块头缺失：第一题无题号但内容是英文问句
    if (firstN > minNum) {
      const headSeg = lines.slice(0, numbered[0].lineIdx).join(' ');
      if (Q_WORDS.test(headSeg)) missingSet.add(minNum);
    }
    // 中段缺失：Q2 → Q5 之间缺 Q3、Q4
    for (let i = 0; i < numbered.length - 1; i++) {
      const cur = numbered[i].n;
      const next = numbered[i + 1].n;
      if (next > cur + 1 && next - cur <= 5) {
        for (let n = cur + 1; n < next; n++) {
          // 检查两题号之间的内容是否含英文问句词（才补该题号）
          const seg = lines.slice(numbered[i].lineIdx + 1, numbered[i + 1].lineIdx).join(' ');
          if (Q_WORDS.test(seg)) missingSet.add(n);
        }
      }
    }
  } else if (inferredStart && inferredStart >= minNum && inferredStart <= maxNum) {
    // 无任何题号但块含问句内容：从推断起始号开始，按问句数量补全
    let stemCount = 0;
    for (const line of lines) {
      if (Q_WORDS.test(line) || /^[\u4e00-\u9fff].{5,80}[？?]\s*$/.test(line.trim())) stemCount++;
    }
    for (let k = 0; k < stemCount && inferredStart + k <= maxNum; k++) {
      missingSet.add(inferredStart + k);
    }
  }

  // 找下一个未使用的缺失题号（> cur）
  const usedMissing = new Set();
  const findNextMissing = (after) => {
    for (let n = after + 1; n <= maxNum; n++) {
      if (missingSet.has(n) && !usedMissing.has(n)) return n;
    }
    return -1;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // 行首题号（左栏）：如 "36.[定位]..."、"26.[考点]..."、"3. What did..."
    let m = line.match(Q_HEAD);
    if (m && Number(m[1]) >= minNum && Number(m[1]) <= maxNum) {
      cur = Number(m[1]);
      push(cur, line.slice(m[0].length));
      continue;
    }
    // 行中题号（右栏）：如 "...答案为E)。 41.(定位)由题干..." 或 听力双栏 "United 2. What did..."
    // 先处理 RIGHT_Q（解析标记），再处理 RIGHT_Q2（听力英文题干）——两者都可能出现在同一行
    const splitInline = (r, isQ2) => {
      const n = Number(r[1]);
      if (n < minNum || n > maxNum || n === cur) return null;
      const idx = line.indexOf(r[0]);
      const left = line.slice(0, idx);
      const right = line.slice(idx + r[0].length);
      // 左栏部分：归属当前块；若无当前块，按缺失题号推断（Q_WORDS 开头才占位）
      if (left.trim() && cur === null && minNum === 1) {
        let cand = Math.min(...missingSet);
        if (isFinite(cand) && !usedMissing.has(cand) && Q_WORDS.test(left)) {
          usedMissing.add(cand);
          cur = cand;
        }
      }
      if (left.trim() && cur !== null) push(cur, left);
      cur = n;
      if (right.trim()) push(cur, right);
      return true;
    };
    const r = line.match(RIGHT_Q);
    if (r) {
      const done = splitInline(r, false);
      if (done) continue;
    }
    const r2 = line.match(RIGHT_Q2);
    if (r2 && minNum === 1) {
      const done = splitInline(r2, true);
      if (done) continue;
    }
    // 无题号但开头是英文问句：推断为下一缺失题号（跳过中文-only 题已占用的题号）
    if (Q_WORDS.test(line) && line.length < 250) {
      let cand;
      if (cur === null) {
        // 找 missingSet 中最小未使用的题号
        cand = Math.min(...missingSet);
        if (!isFinite(cand) || usedMissing.has(cand)) cand = -1;
      } else {
        // 先看 cur+1 是否在 missingSet 且未使用
        cand = (missingSet.has(cur + 1) && !usedMissing.has(cur + 1)) ? cur + 1 : findNextMissing(cur);
      }
      if (cand >= minNum && cand <= maxNum && missingSet.has(cand) && !usedMissing.has(cand)) {
        usedMissing.add(cand);
        cur = cand;
        push(cur, line);
        continue;
      }
    }
    // 中段缺失但无英文题干（中文-only 题）：
    // 仅当行以中文开头且以"？"/"?"结尾（中文题干）时，占用该缺失题号
    // 不用选项行(A)B))判断——同一题多个选项行会误占多个题号
    {
      const isChnStem = /^[\u4e00-\u9fff].{5,80}[？?]\s*$/.test(line);
      if (isChnStem && missingSet.size > 0) {
        let cand;
        if (cur === null) {
          cand = Math.min(...missingSet);
          if (!isFinite(cand) || usedMissing.has(cand)) cand = -1;
        } else {
          cand = findNextMissing(cur);
        }
        if (cand >= minNum && cand <= maxNum && !usedMissing.has(cand)) {
          usedMissing.add(cand);
          cur = cand;
          // 不 continue，继续到下面的 push
        }
      }
    }
    if (cur === null) continue;
    push(cur, line);
  }
  // 每题解析：保留题干残片（解析标记之前的内容）+ 解析正文
  // 题干是 build-banks.mjs 提取听力题干的主要来源，不能丢弃
  const out = {};
  for (const [n, segs] of blocks) {
    const joined = segs.join(' ');
    out[n] = joined
      .replace(/^[A-Oa-o]?\s*[)）.\]]?\s*/g, '')
      .replace(/^\s*[（(【[]\s*/, '')
      .replace(/[（(【[]\s*([^）)\]】]+?)\s*[）)\]】]\s*/, '[$1] ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return out;
}

// ---------- 分区 ----------
const analysis = { listening: {}, banked: {}, long: {}, reading: {} };
let writingSample = '';
let translationRef = '';
const all = text;
const secs = [];

// 定位各模块边界（关键词）
const iWriting = all.search(/参考范文/);
const iLst = all.search(/Listening\s*Comprehension/i);
const iBanked = all.search(/形容词\s*[:：]|名词\s*[:：]|动词\s*[:：]/); // 选词词性表
const iLong = all.search(/\bSection\s*B\b/);
const iReading = all.search(/Passage\s+One/i);
const iTrans = all.search(/Part\s*[IVX\[|Jl了0-9N]+\s*Translation|Translation\s*\(30\s*minutes\)/i);

// 写作范文：参考范文 → 话题词汇（或页标）
if (iWriting !== -1) {
  let end = all.indexOf('话题词汇', iWriting);
  if (end === -1) end = iWriting + 4000;
  writingSample = all.slice(iWriting, end)
    .split('\n')
    .filter((l) => !/【第\d+页】|^\s*\d{4}\.\d+\/\s*\d+\s*\(第\s*\d+\s*套\)/.test(l))
    .join('\n')
    .trim();
}

// 答案详解块列表（按顺序）
const ansBlocks = [];
{
  const re = /答案详解/g;
  let m;
  while ((m = re.exec(all)) !== null) {
    const start = m.index + 4;
    const nextAns = all.indexOf('答案详解', start);
    const nextRef = all.indexOf('参考译文', start);
    const nextSecB = all.indexOf('Section B', start);
    const nextDiff = all.indexOf('难词译注', start);
    const nextTrans = all.indexOf('Translation', start);
    // 不用 "Passage"/"Section B" 截断 —— 听力原文后紧跟答案解析（无标题），截断会遗弃
    const cands = [nextAns, nextRef, nextDiff, nextTrans].filter((x) => x !== -1 && x > start);
    const end = cands.length ? Math.min(...cands) : all.length;
    ansBlocks.push({ start, end, text: all.slice(start, end) });
  }
}

// 归类答案详解块：多范围归位（一个块可能跨多个模块）
const RANGES = [
  { owner: 'listening', min: 1, max: 25 },
  { owner: 'banked', min: 26, max: 35 },
  { owner: 'long', min: 36, max: 45 },
  { owner: 'reading', min: 46, max: 55 },
];
// 跟踪听力已提取的最大题号，用于推断孤立块的起始题号
let lstLastSeen = 0;
for (const b of ansBlocks) {
  const counts = { listening: 0, banked: 0, long: 0, reading: 0 };
  for (const line of b.text.split('\n')) {
    const trimmed = line.trim();
    if (/^\d{1,3}$/.test(trimmed)) continue;
    if (/^【第\d+页】/.test(trimmed)) continue;
    const m1 = line.match(Q_HEAD);
    if (m1) {
      const n = Number(m1[1]);
      if (n >= 1 && n <= 25) counts.listening++;
      else if (n >= 26 && n <= 35) counts.banked++;
      else if (n >= 36 && n <= 45) counts.long++;
      else if (n >= 46 && n <= 55) counts.reading++;
    }
    const r = line.match(RIGHT_Q);
    if (r) {
      const n = Number(r[1]);
      if (n >= 1 && n <= 25) counts.listening++;
      else if (n >= 26 && n <= 35) counts.banked++;
      else if (n >= 36 && n <= 45) counts.long++;
      else if (n >= 46 && n <= 55) counts.reading++;
    }
  }
  for (const r of RANGES) {
    if (counts[r.owner] === 0) {
      // 特例：听力块无题号但含英文问句+选项标记 → 推断起始号提取
      if (r.owner === 'listening' && Q_WORDS.test(b.text) && /[A-Oa-o]\)/.test(b.text)
          && lstLastSeen < 25) {
        const got = extractByNum(b.text, 1, 25, lstLastSeen + 1);
        for (const [nStr, s] of Object.entries(got)) {
          if (s && s.length > 10 && !analysis.listening[nStr]) {
            analysis.listening[nStr] = s;
            const n = Number(nStr);
            if (n > lstLastSeen) lstLastSeen = n;
          }
        }
      }
      continue;
    }
    const got = extractByNum(b.text, r.min, r.max);
    for (const [nStr, s] of Object.entries(got)) {
      if (s && s.length > 10 && !analysis[r.owner][nStr]) {
        analysis[r.owner][nStr] = s;
        if (r.owner === 'listening') {
          const n = Number(nStr);
          if (n > lstLastSeen) lstLastSeen = n;
        }
      }
    }
  }
}

// ---------- 补充扫描：听力原文后的孤立答案解析 ----------
// 听力原文（Passage One/Two...）后紧跟该 Passage 的答案解析，但无 "答案详解" 标题，
// 被 "Passage" 截断而遗弃。扫描这些间隙段，只补充听力(1-25)缺失的题
{
  const passRe = /Passage\s+(?:One|Two|Three|Four|1|2|3|4|一|二|三|四)/gi;
  const gaps = [];
  let pm;
  while ((pm = passRe.exec(all)) !== null) {
    const passStart = pm.index;
    const after = all.slice(passStart + pm[0].length);
    const nextAns = after.search(/答案详解/);
    const nextPass = after.search(/Passage\s+(?:One|Two|Three|Four|1|2|3|4|一|二|三|四)/i);
    const nextSecB = after.search(/Section\s*B/i);
    const cands = [nextAns, nextPass, nextSecB].filter((x) => x !== -1);
    const gapEnd = cands.length ? passStart + pm[0].length + Math.min(...cands) : all.length;
    const gap = all.slice(passStart + pm[0].length, gapEnd);
    // 仅当间隙含英文问句词+选项标记 A) B)（答案解析特征，非纯听力原文）时处理
    if (gap.length > 50 && Q_WORDS.test(gap) && /[A-Oa-o]\)/.test(gap)) {
      gaps.push(gap);
    }
  }
  for (const gap of gaps) {
    const got = extractByNum(gap, 1, 25, lstLastSeen + 1);
    for (const [nStr, s] of Object.entries(got)) {
      if (s && s.length > 10 && !analysis.listening[nStr]) {
        analysis.listening[nStr] = s;
        const n = Number(nStr);
        if (n > lstLastSeen) lstLastSeen = n;
      }
    }
  }
}

// 翻译参考译文：翻译区（Part IV，OCR 常识别为 "Part N"）之后的"参考译文与难点注释"
// 注意：String.prototype.search 不支持 fromIndex，需先 slice 再定位
if (iTrans !== -1) {
  const seg = all.slice(iTrans);
  const tr = seg.search(/参考译文与难点注释|参考译文/);
  if (tr !== -1) {
    const abs = iTrans + tr;
    const end = seg.indexOf('【', tr + 3);
    translationRef = seg.slice(tr, end === -1 ? tr + 3000 : end)
      .split('\n')
      .filter((l) => !/^\s*\d{4}\.\d+\/\s*\d+\s*\(第\s*\d+\s*套\)/.test(l))
      .join('\n')
      .trim();
  }
}

const result = {
  analysis,
  translation: { reference: translationRef },
  writing: { sample: writingSample },
};
fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
console.log('已生成:', out);
console.log('听力:', Object.keys(analysis.listening).length, '选词:', Object.keys(analysis.banked).length, '长篇:', Object.keys(analysis.long).length, '阅读:', Object.keys(analysis.reading).length);
console.log('写作范文:', writingSample.length ? writingSample.length + '字' : '无');
console.log('翻译参考:', translationRef.length ? translationRef.length + '字' : '无');
