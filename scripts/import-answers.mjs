// 答案自动提取 v3：文件顺序匹配 + 词义匹配 + 多信号交叉验证
// 用法：node scripts/import-answers.mjs <txt路径> <输出answers.json路径>
import fs from 'node:fs';

const txt = process.argv[2];
const out = process.argv[3];
if (!txt || !out) {
  console.error('用法: node scripts/import-answers.mjs <txt路径> <输出路径>');
  process.exit(1);
}
const all = fs.readFileSync(txt, 'utf8').replace(/^\uFEFF/, '');

const L2O = { 0: 'O', 6: 'G', 4: 'A', 8: 'B', 9: 'G', 卫: 'F', 下: 'J', '[': 'I', ']': 'I', '^': 'A', k: 'K', K: 'K', 凸: 'B' };
function normLetter(c) {
  if (!c) return '';
  const u = String(c).toUpperCase();
  if (u >= 'A' && u <= 'O') return u;
  return L2O[c] || '';
}
const LCH = /[A-Oa-o0-9\[\]卫下^6-8k凸]/;

// ---------- 答案详解块 ----------
const ansBlocks = [];
{
  const re = /答案详解/g;
  let m;
  while ((m = re.exec(all)) !== null) {
    const start = m.index + 4;
    const nextAns = all.indexOf('答案详解', start);
    const nextRef = all.indexOf('参考译文', start);
    const nextDiff = all.indexOf('难词译注', start);
    const nextTrans = all.indexOf('Translation', start);
    // 不用 "Passage"/"Section B" 截断 —— 听力原文后紧跟答案解析（无标题），截断会遗弃
    const cands = [nextAns, nextRef, nextDiff, nextTrans].filter((x) => x !== -1 && x > start);
    const end = cands.length ? Math.min(...cands) : all.length;
    ansBlocks.push(all.slice(start, end));
  }
}

// 行号映射
function makeLineMap(block) {
  const lines = block.split('\n');
  const starts = [];
  let acc = 0;
  for (let i = 0; i < lines.length; i++) { starts.push(acc); acc += lines[i].length + 1; }
  return { lines, lineOf: (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  }};
}

// 标记（行首题号 = L，行中题号 = R）
function collectMarkers(blockText) {
  const markers = [];
  const reL = /^(\d{1,2})[.、。]?\s*(?=[A-Z©(（\[【]|[\u4e00-\u9fff]|$)/gm;
  let m;
  while ((m = reL.exec(blockText)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 55) markers.push({ n, pos: m.index, col: 'L' });
  }
  const reR = /(\d{1,2})[.、。]?\s*[(（\[【]\s*(?:定位|考点|精析|语义|语法|结构|避错)/g;
  while ((m = reR.exec(blockText)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 55) markers.push({ n, pos: m.index, col: 'R' });
  }
  markers.sort((a, b) => a.pos - b.pos);
  // 去重（同位置）
  const seen = new Set();
  const filtered = markers.filter((x) => { const k = x.n + ':' + x.pos; if (seen.has(k)) return false; seen.add(k); return true; });

  // 推断块头漏掉的起始题号：
  // 解析书中"答案详解:"后第一题常漏题号前缀（如直接 "Why did..." 而非 "1. Why did..."），
  // 如果第一个 marker 的题号大于该块所属模块起始题号（listening=1/banked=26/long=36/reading=46），
  // 且块头有未标号问句（What/Why/How...），就在 pos=0 插入起始题号
  if (filtered.length > 0) {
    const minN = filtered[0].n;
    let expectedStart;
    if (minN >= 46) expectedStart = 46;
    else if (minN >= 36) expectedStart = 36;
    else if (minN >= 26) expectedStart = 26;
    else expectedStart = 1;
    if (minN > expectedStart) {
      const headSeg = blockText.slice(0, filtered[0].pos);
      if (/\b(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are)\b/.test(headSeg)) {
        filtered.unshift({ n: expectedStart, pos: 0, col: 'L' });
      }
    }
  }
  return filtered;
}

// 信号提取
function sigAns(text) {
  const out = [];
  const re = /(?:故正确答案|正确答案|故答案|答案|答笨|正确答?案?)\s*[为是]?\s*[（(【\[]?\s*([A-Oa-o0-9\[\]卫下^6-8k凸])\s*[\)）\]】]?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const l = normLetter(m[1]);
    if (l) out.push({ type: 'ans', pos: m.index, letter: l });
  }
  return out;
}
function sigPara(text) {
  const out = [];
  const re = /文章\s*[为是]?\s*[（(]?\s*([A-Oa-o0-9\[\]卫下^6-8k凸])\s*[\)）\]】]?\s*段/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const l = normLetter(m[1]);
    if (l) out.push({ type: 'para', pos: m.index, letter: l });
  }
  return out;
}
function sigPrefix(text) {
  const out = [];
  const re = /(?:^|[^A-Za-z0-9])([A-Oa-o0-9\[\]卫下^6-8k凸])\s*[\)）]\s*[（(【\[]?\s*(?:精析|考点|语法判断|语义判断|避错)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const l = normLetter(m[1]);
    if (l) out.push({ type: 'prefix', pos: m.index + 1, letter: l });
  }
  return out;
}
function sigWord(text) {
  const out = [];
  const re = /答案为\s*[^，。；\n]{0,10}?[\(（【\[]?\s*[A-Oa-o0-9\[\]卫下^6-8k凸]\s*[\)）\]】]\s*([a-zA-Z][a-zA-Z'\-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ type: 'word', pos: m.index, word: m[1].toLowerCase() });
  const re2 = /答案为\s*([a-zA-Z][a-zA-Z'\-]+)(?=[，。；、\n]|$)/g;
  while ((m = re2.exec(text)) !== null) out.push({ type: 'word', pos: m.index, word: m[1].toLowerCase() });
  return out;
}

// 词性分析 → letter → {word, gloss}
function wordBank(blockText) {
  const bank = {};
  const re = /([A-Oa-o0-9])\s*[\)）]\s*([a-zA-Z][a-zA-Z'\-]*)[\s，,;；]*([\u4e00-\u9fff][\u4e00-\u9fff，。、；;()（）A-Za-z'\- ]*?)(?=[;；]|\s*[A-Oa-o0-9]\s*[\)）]|$)/g;
  let m;
  while ((m = re.exec(blockText)) !== null) {
    const l = normLetter(m[1]);
    if (l && !bank[l]) bank[l] = { word: m[2].toLowerCase(), gloss: m[3].trim() };
  }
  return bank;
}

const result = {};
for (const block of ansBlocks) {
  const lm = makeLineMap(block);
  const markers = collectMarkers(block);
  if (!markers.length) continue;
  const minN = Math.min(...markers.map((x) => x.n));
  const owner = minN >= 46 ? 'reading' : minN >= 36 ? 'long' : minN >= 26 ? 'banked' : 'listening';
  const min = owner === 'listening' ? 1 : owner === 'banked' ? 26 : owner === 'long' ? 36 : 46;
  const max = owner === 'listening' ? 25 : owner === 'banked' ? 35 : owner === 'long' ? 45 : 55;
  const qs = markers.filter((x) => x.n >= min && x.n <= max);

  if (owner === 'reading' || owner === 'long') {
    // 文件顺序匹配：第 i 个 para/ans 信号 ↔ 第 i 个题号
    const paras = sigPara(block);
    const ansSigs = sigAns(block);
    const sigs = owner === 'long' ? (paras.length ? paras : ansSigs) : ansSigs;
    for (let i = 0; i < sigs.length && i < qs.length; i++) {
      const q = qs[i];
      if (!result[q.n]) result[q.n] = sigs[i].letter;
    }
  } else if (owner === 'banked') {
    const bank = wordBank(block);
    const words = sigWord(block);
    const prefixes = sigPrefix(block);
    const ansSigs = sigAns(block);
    // 每题：优先 prefix→bank 单词；其次 答案为 word 按题号区间路由
    const colQ = { L: [], R: [] };
    for (const mk of qs) colQ[mk.col].push(mk);
    const lmLines = lm.lines;
    const assign = {};
    for (const mk of qs) {
      const col = mk.col;
      const list = colQ[col];
      const idx = list.findIndex((x) => x === mk);
      const nextLine = idx + 1 < list.length ? lm.lineOf(list[idx + 1].pos) : Infinity;
      const startLine = lm.lineOf(mk.pos);
      // 区间内信号
      const inRange = (sigs) => sigs.filter((s) => { const l = lm.lineOf(s.pos); return l >= startLine && l < nextLine; });
      const myPrefix = inRange(prefixes);
      const myWords = inRange(words);
      if (myPrefix.length) {
        const b = bank[myPrefix[0].letter];
        if (b) assign[mk.n] = b.word;
        else assign[mk.n] = myPrefix[0].letter;
      } else if (myWords.length) {
        assign[mk.n] = myWords[0].word;
      } else {
        // 语义判断词义匹配：本空应填人含有"X"意义
        const seg = block.split('\n').slice(startLine, nextLine === Infinity ? startLine + 40 : nextLine).join(' ');
        const gm = seg.match(/含有["“]([^"”]{1,12})["”](?:意义|意思)|表达["“]([^"”]{1,12})["”](?:意义|意思)|(?:含义|语义)["“]([^"”]{1,12})["”]/);
        const gloss = gm ? (gm[1] || gm[2] || gm[3]) : '';
        if (gloss) {
          const hit = Object.entries(bank).find(([l, b]) => b.gloss.includes(gloss) || gloss.includes(b.gloss.replace(/[，。、；;]/g, '').slice(0, 4)));
          if (hit) assign[mk.n] = hit[1].word;
        }
      }
    }
    // 未分配：用 ans 信号中的字母 → bank
    for (const mk of qs) {
      if (assign[mk.n]) continue;
      const ansSig = ansSigs.find((s) => { const l = lm.lineOf(s.pos); const sl = lm.lineOf(mk.pos); const list = colQ[mk.col]; const idx = list.findIndex((x) => x === mk); const nl = idx + 1 < list.length ? lm.lineOf(list[idx + 1].pos) : Infinity; return l >= sl && l < nl; });
      if (ansSig) {
        const b = bank[ansSig.letter];
        assign[mk.n] = b ? b.word : ansSig.letter;
      }
    }
    for (const [n, v] of Object.entries(assign)) if (v && !result[n]) result[n] = v;
  } else {
    // listening：sequential，按题号区间找 ans/prefix
    const ansSigs = sigAns(block);
    const prefixes = sigPrefix(block);
    // 标记行号排序
    const qs2 = [...qs].sort((a, b) => a.pos - b.pos);
    for (let i = 0; i < qs2.length; i++) {
      const q = qs2[i];
      const start = q.pos;
      const end = i + 1 < qs2.length ? qs2[i + 1].pos : block.length;
      const seg = block.slice(start, Math.min(end, start + 1200));
      const a = sigAns(seg)[0];
      const p = sigPrefix(seg)[0];
      const letter = a ? a.letter : p ? p.letter : '';
      if (letter && !result[q.n]) result[q.n] = letter;
    }
  }
}

// 合并已有 answers.json（保留人工校准/网上抓取的答案，仅补充缺失项）
let merged = 0;
try {
  const existing = JSON.parse(fs.readFileSync(out, 'utf8'));
  for (const [n, v] of Object.entries(existing)) {
    if (!result[n]) { result[n] = v; merged++; }
  }
} catch {}

fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
const counts = {};
for (const [k, v] of Object.entries(result)) {
  const r = Number(k) >= 46 ? 'reading' : Number(k) >= 36 ? 'long' : Number(k) >= 26 ? 'banked' : 'listening';
  counts[r] = (counts[r] || 0) + 1;
}
console.log('听力:', counts.listening || 0, '选词:', counts.banked || 0, '长篇:', counts.long || 0, '阅读:', counts.reading || 0, '合并已有:', merged);
