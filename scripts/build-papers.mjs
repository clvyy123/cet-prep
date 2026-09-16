/**
 * 把「真题卷 PDF 文字层」+「答案解析 PDF 的 OCR 文本」合成结构化试卷数据
 *
 *   node scripts/build-papers.mjs \
 *     --paper  .qa/ec/paper.txt \
 *     --analysis .qa/ec/sample-lines.txt \
 *     --meta   '{"id":"cet4-2025-12-1","level":4,"year":2025,"month":12,"setNo":"第一套"}' \
 *     --out    src/data/papers.ts
 *
 * 两个来源分工：
 *   paper.txt    → 卷面（题干、英文选项、篇章、词库、翻译原文）
 *   analysis.txt → 解析（听力原文、选项译文、逐题详解、范文/译文/词汇/句型）
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : null;
};
const meta = JSON.parse(arg('meta'));
const paperTxt = fs.readFileSync(arg('paper'), 'utf8').split('\n');
const anaTxt = fs.readFileSync(arg('analysis'), 'utf8').split('\n');
const outPath = arg('out');
/** examcrafts 对照修正（scripts/compare-ec.mjs 生成）：答案/解析/题干/选项/原文/翻译/范文 */
const FIXES = (() => {
  try {
    return JSON.parse(fs.readFileSync('scripts/paper-fixes.json', 'utf8'))[meta.id] ?? {};
  } catch {
    return {};
  }
})();

const squash = (s) => s.replace(/\s+/g, ' ').trim();
/** 页脚/页码噪声：「2 四级2025.12第一套」「六级2021年6月31」「[第3页]」「六级2021年6月8」 */
const cleanNoise = (s) =>
  s
    .replace(/\[第\s*\d+\s*页\]/g, ' ')
    .replace(/\uFFFD/g, '')
    .replace(/\d*\s*[四六]级\s*\d{4}\s*[.\-·年]\s*\d{1,2}\s*[.\-·月]?\s*\d*\s*第?[一二三四]?套?/g, ' ')
    .replace(/(^|\s)Translation\s*\(\s*30\s*minutes?\s*\)\s*Part\s*\w*/gi, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** PP-OCRv5 识别英文连贯文本时会吞掉词间空格，这里补回最常见的几种边界 */
/** 大小写边界也要过词典：「McDonald」不能被拆成 Mc Donald */
function caseSegment(w) {
  const parts = w.replace(/([a-z])([A-Z])/g, '$1\u0000$2').split('\u0000');
  if (parts.length < 2) return null;
  return parts.every((p) => DICT.has(p.toLowerCase()) || /^(a|i)$/i.test(p)) ? parts.map((p) => p.toLowerCase()) : null;
}

const fixEnSpacing = (s) =>
  s
    .replace(/([\]）)])([A-Za-z])/g, '$1 $2')
    .replace(/([a-z])([,;:])([A-Za-z])/g, '$1$2 $3')
    .replace(/([a-z])\.([A-Z][a-z])/g, '$1. $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    // 词内粘连（shouldadopt / coverofa / cathas / Aterrified）交给词典切分
    .replace(/\b[A-Za-z]{3,22}\b/g, (w) => {
      const parts = segment(w.toLowerCase()) || caseSegment(w);
      if (!parts) return w;
      if (/^[A-Z]/.test(w)) parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1);
      return parts.join(' ');
    })
    .replace(/\s{2,}/g, ' ')
    .trim();

/* ---------- 英文分词：OCR 会把两端对齐的英文词间空格吞掉 ---------- */
const FUNC_WORDS = `a an the and or but if as at by for from in into of on onto to up with within without over under above
about after before during since until while when where why how what which who whom whose that this these those there here
it its he she they we you i me him her them us my your his their our be is are was were been being am do does did done
have has had having will would shall should can could may might must not no nor so than then too very just also only even
still yet again once ever never always often sometimes more most much many few little less least own same other another
such all any some both each every either neither one two three first second last new old good best well`
  .split(/\s+/)
  .filter(Boolean);

const DICT = new Set(FUNC_WORDS);
for (const f of fs.readdirSync('src/data/words')) {
  if (!f.endsWith('.ts')) continue;
  for (const m of fs.readFileSync(path.join('src/data/words', f), 'utf8').matchAll(/word:'([^']+)'/g)) {
    DICT.add(m[1].toLowerCase());
  }
}

/** 把粘连的长词切成若干词典词；切不动返回 null（保守：宁可不动） */
function segment(token) {
  const n = token.length;
  const memo = new Map();
  const go = (i) => {
    if (i === n) return [];
    if (memo.has(i)) return memo.get(i);
    let best = null;
    for (let j = n; j > i; j--) {
      const part = token.slice(i, j);
      if (part.length < 2 && !/^(a|i)$/.test(part)) continue;
      if (!DICT.has(part)) continue;
      const rest = go(j);
      if (rest && (!best || rest.length + 1 < best.length)) best = [part, ...rest];
    }
    memo.set(i, best);
    return best;
  };
  const r = go(0);
  return r && r.length > 1 ? r : null;
}

/** 解析 PDF 页眉残留（「斤第一套」其实是「｜第一套」的误识） */
const stripHeadFrag = (s) => s.replace(/^[^\u4e00-\u9fff]{0,3}[|｜丨斤]\s*第[一二三四]套\s*/, '');

/** 中文串里，前半是英文原文、后半是中文题干译文 —— 从第一个中日韩字符处切开 */
function splitBilingual(s) {
  const k = s.search(/[\u4e00-\u9fff\u3000-\u303f（(]/);
  // 纯英文头（解析里听力题干常只有英文）：整个都是英文原文
  if (k === -1) return { en: s, cn: '' };
  if (k <= 0) return { en: '', cn: s };
  const cnStart = s.slice(0, k).search(/\s*[\u4e00-\u9fff]/);
  return { en: squash(s.slice(0, cnStart > -1 ? cnStart : k)), cn: squash(s.slice(cnStart > -1 ? cnStart : k)) };
}

const isMarker = (l, name) => new RegExp(`^·?${name}·?$`).test(l.replace(/\s/g, ''));

// ---------------- 1. KEYS ----------------
/** 卷末「KEYS」区把答案按 10 个一行、题号行在上、字母行在下排布 */
function parseKeys(lines) {
  const start = lines.findIndex((l) => /(^|\s)KEYS(\s|$)/.test(squash(l)));
  if (start === -1) return {};
  const blob = squash(lines.slice(start).join(' '))
    .replace(/KEYSPart[^0-9]*/g, ' ')
    .replace(/(\d)([A-O])\b/g, '$1 $2')
    .replace(/\b([A-O])(\d)/g, '$1 $2');
  const answers = {};
  const pending = [];
  for (const t of blob.split(/[\s,]+/)) {
    if (/^\d{1,2}$/.test(t)) pending.push(Number(t));
    else if (/^[A-O]$/.test(t) && pending.length) answers[pending.shift()] = t;
  }
  return answers;
}
const ANSWERS = parseKeys(paperTxt);
/** 卷末 KEY 区起始行，正文解析到这里为止 */
const KEYS_AT = paperTxt.findIndex((l) => /(^|\s)KEYS(\s|$)/.test(squash(l)));
const BODY = KEYS_AT === -1 ? paperTxt : paperTxt.slice(0, KEYS_AT);

// ---------------- 2. 卷面 ----------------
/** 从一段连续文本里抽出 A)-D) 选项（版面是两栏，字母顺序即最终顺序）；选项标记有「A)」「A．」「A、」三种形态 */
const OPT_MARK = '([A-O])[)）.、]';

function parseOptions(block) {
  const out = {};
  // OCR 会把选项标记和前文粘连（「as instructed.D) To ensure…」），先在标点后补空格
  const norm = block.replace(/([a-z,.:;!?'"”’])\s*(?=[B-O][)）.、])/g, '$1 ');
  const re = new RegExp(`(?:^|[\\s])${OPT_MARK}\\s*`, 'g');
  const marks = [];
  let m;
  while ((m = re.exec(norm)) !== null) marks.push({ letter: m[1], start: m.index + m[0].length });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : norm.length;
    const text = squash(norm.slice(mk.start, end).replace(/[A-O][)）.、]\s*$/g, ''));
    if (text && !out[mk.letter]) out[mk.letter] = text;
  });
  return out;
}

function parseStemOptions(block) {
  const opts = parseOptions(block);
  const firstMark = block.search(new RegExp(`(?:^|[\\s])[A-O][)）.、]`));
  const stem = firstMark > 0 ? squash(block.slice(0, firstMark)) : '';
  return { stem, options: opts };
}

/** 归一化题号："1." / "1、" / "1)" 都要认，另外 PDF 里偶尔漏掉「48」后的句点（`48 What may…`） */
const NUM_RE = /^(\d{1,2})\s*(?:[.、．)）]\s*|\s+(?=[A-Z\u201c\u201d"'(]))/;

/**
 * 「46.C 47.B 48.D 49.A」这种答案速查行也以题号开头，但它不是题干——
 * 不排掉它会覆盖掉同一题真正的题干与解析（曾导致 46/50 解析为空）。
 */
const ANS_LIST_RE = /^(\d{1,2})\s*[.、．)）]?\s*[A-O](?:\s+\d{1,2}\s*[.、．)）]?\s*[A-O])+\s*$/;
/** 取行首题号；不是题号行（含答案速查行）返回 null */
function numOf(l) {
  if (ANS_LIST_RE.test(l)) return null;
  const m = NUM_RE.exec(l);
  return m ? Number(m[1]) : null;
}

/**
 * 各 Part 的定位不靠罗马数字 —— PDF 文字层/OCR 里它会被识别成 Il / ][ / N / Ⅱ / I 等各种形态
 * （「PartII Reading…」其实是 Part III 误识，「PartN Translation」是 Part IV）。
 * 关键词 + 「关键词必须出现在行首附近」判定；Translation 行还要求短（标题行）或含 minutes。
 */
const PART_KEYS = [
  ['I', (l) => /^.{0,12}writing\s*(\(|$)/i.test(l) && l.length <= 40],
  ['II', (l) => /^.{0,12}listening\s*comprehension/i.test(l)],
  ['III', (l) => /^.{0,12}reading\s*comprehension/i.test(l)],
  ['IV', (l) => /^.{0,12}translation/i.test(l) && (/min/i.test(l) || l.length <= 25)],
];
const PART_ORDER = { I: 0, II: 1, III: 2, IV: 3 };

function sliceParts(lines) {
  const found = [];
  lines.forEach((l, i) => {
    const s = squash(l);
    if (!s) return;
    for (const [part, match] of PART_KEYS) {
      if (match(s)) {
        found.push({ i, part });
        break;
      }
    }
  });
  const seen = new Set();
  const uniq = [];
  for (const f of found) {
    if (!seen.has(f.part)) {
      seen.add(f.part);
      uniq.push(f);
    }
  }
  uniq.sort((a, b) => PART_ORDER[a.part] - PART_ORDER[b.part]);
  const out = {};
  uniq.forEach((cur, k) => {
    const end = k + 1 < uniq.length ? uniq[k + 1].i : lines.length;
    out[cur.part] = lines.slice(cur.i, end);
  });
  return out;
}

const PARTS = sliceParts(BODY);

// Part I 写作
const writingPrompt = squash(PARTS.I.filter((l) => !/^Part\b/.test(l)).join(' '))
  .replace(/^Directions:\s*/i, '')
  // 扫描卷 OCR 会把卷首标题打成乱码（「•i\] · .. £.!k�ffiApp…」），正文固定从 Directions: 开始，直接丢弃前缀
  .replace(/^.*?(?=Directions:)/, '');
/** 乱码判定：中文占比过低且含替换符 —— OCR 把整段中文打废了，宁可置空也不展示 */
const isGarbledCn = (s) => {
  if (!s) return false;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return /\uFFFD/.test(s) && cjk < s.length * 0.25;
};

// Part II 听力
function parseListening(lines) {
  const groups = [];
  let cur = null;
  const pushCur = () => cur && cur.nums.length && groups.push(cur);
  for (const raw of lines) {
    const l = squash(raw);
    if (!l) continue;
    let m = /^Questions?\s+(\d{1,2})\s*(?:and|to)\s*(\d{1,2})\s+are based on/i.exec(l);
    if (m) {
      pushCur();
      let scope = 'Section A';
      const before = lines.slice(0, lines.indexOf(raw)).reverse().find((x) => /^Section/.test(squash(x)));
      if (before) scope = squash(before).match(/^Section\s*[ABC]/)?.[0] ?? scope;
      cur = { intro: l, nums: [], scope, questions: [] };
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let n = a; n <= b; n++) cur.nums.push(n);
      cur.raw = [];
      continue;
    }
    if (!cur) continue;
    cur.raw.push(l);
  }
  pushCur();

  for (const g of groups) {
    const blocks = {};
    let hold = null;
    for (const l of g.raw) {
      const n = numOf(l);
      if (n !== null && g.nums.includes(n)) {
        hold = { num: n, text: l.slice(NUM_RE.exec(l)[0].length) };
        g.questions.push(hold);
        continue;
      }
      if (hold) hold.text += '\n' + l;
    }
    g.questions.forEach((q) => {
      const { stem, options } = parseStemOptions(squash(q.text));
      q.stem = stem;
      q.options = options;
    });
    blocks;
  }
  return groups;
}
const listeningGroups = parseListening(PARTS.II ?? []);

// Part III 阅读
function parseReading(lines) {
  const res = { banked: null, long: null, passages: [] };
  const text = lines.map(squash);
  const secIdx = text
    .map((l, i) => (/^Section\s*[ABC]\b/.test(l) ? { i, s: l.match(/[ABC]/)[0] } : null))
    .filter(Boolean);
  const secOf = (i) => [...secIdx].reverse().find((x) => x.i <= i)?.s ?? 'A';

  // Section A 选词填空：正文（含 ___26___ 占位）在上，词库（连续 A)-O) 行）在下
  const secA = text.findIndex((l) => /^Section\s*A/.test(l));
  const secAEnd = text.findIndex((l, i) => /^Section\s*B/.test(l) && i > secA);
  if (secA > -1 && secAEnd > secA) {
    let bankStart = -1;
    for (let i = secAEnd - 1; i > secA; i--) {
      if (/^[A-O][)）]/.test(text[i])) bankStart = i;
      else if (bankStart > -1) break;
    }
    if (bankStart > -1) {
      const words = {};
      for (let i = bankStart; i < secAEnd; i++) {
        const re = /([A-O])[)）.、]\s*([^A-O]*)/g;
        let m;
        while ((m = re.exec(text[i])) !== null) {
          const w = squash(m[2]);
          if (w) words[m[1]] = w;
        }
      }
      // 正文从「第一个 ___26___ 占位所在的行」开始，之前都是 Directions 说明
      const all = text.slice(secA + 1, bankStart);
      const startAt = all.findIndex((l) => /___\s*2[6-9]\s*___|___\s*3[0-5]\s*___/.test(l));
      const passageLines = (startAt > -1 ? all.slice(startAt) : all).filter(
        (l) => l && !/^Section|^Directions|^Part|^Passage|^Questions/.test(l)
      );
      res.banked = { passage: fixEnSpacing(passageLines.join(' ')), words };
    }
  }
  // Section B 长篇阅读：10 条陈述 + A)-O) 段落
  const bStart = text.findIndex((l) => /^Section\s*B/.test(l));
  const cStart = text.findIndex((l, i) => /^Section\s*C/.test(l) && i > bStart);
  if (bStart > -1) {
    const body = text.slice(bStart, cStart > -1 ? cStart : text.length);
    const statements = [];
    for (const l of body) {
      const n = numOf(l);
      if (n !== null && n >= 36 && n <= 45) statements.push({ num: n, text: l.slice(NUM_RE.exec(l)[0].length) });
    }
    // 段落：整页里以 A)-O) 开头且不是选项行的长行
    const paras = [];
    for (let i = 0; i < BODY.length; i++) {
      const l = squash(paperTxt[i]);
      const m = /^([A-O])[)）]\s*(.{40,})/.exec(l);
      if (m && i > 125 && !/^[A-O][)）]\s*[A-Z]?\s*(approximately|case|chance)/.test(l)) paras.push({ letter: m[1], text: m[2] });
    }
    res.long = { statements, paragraphs: paras };
  }
  // Section C 两篇仔细阅读
  if (cStart > -1) {
    const body = text.slice(cStart);
    const pIdx = body
      .map((l, i) => (/^Passage\s+(One|Two|Three)/i.test(l) ? i : -1))
      .filter((i) => i >= 0);
    pIdx.forEach((pi, k) => {
      const end = k + 1 < pIdx.length ? pIdx[k + 1] : body.length;
      const seg = body.slice(pi + 1, end);
      let passage = [];
      const questions = [];
      let hold = null;
      for (const l of seg) {
        const n = numOf(l);
        if (n !== null && n >= 46 && n <= 55) {
          hold = { num: n, text: l.slice(NUM_RE.exec(l)[0].length) };
          questions.push(hold);
          continue;
        }
        if (hold) hold.text += '\n' + l;
        else if (l && !/^(Questions|Directions)/.test(l) && !/^Section/.test(l)) passage.push(l);
      }
      questions.forEach((q) => {
        const { stem, options } = parseStemOptions(squash(q.text));
        q.stem = stem;
        q.options = options;
      });
      res.passages.push({ title: body[pi], passage: fixEnSpacing(squash(passage.join(' '))), questions });
    });
  }
  return res;
}
const reading = parseReading(PARTS.III ?? []);

// Part IV 翻译：卷面只有一段中文原文，Directions 全英文，从第一个汉字处切
const translationPrompt = (() => {
  const joined = squash((PARTS.IV ?? []).filter((l) => !/^Part\b|^Directions/.test(l)).join(' '));
  const k = joined.search(/[\u4e00-\u9fff]/);
  const t = cleanNoise(k > 0 ? joined.slice(k) : joined);
  return isGarbledCn(t) ? '' : t;
})();

// ---------------- 3. 解析文本切片 ----------------
const A = anaTxt.map((l) => l.trim());
const findIdx = (pred, from = 0) => {
  for (let i = from; i < A.length; i++) if (pred(A[i], i)) return i;
  return -1;
};

/** 取 [start,end) 之间的行 */
const seg = (s, e) => A.slice(s, e).filter((l) => l && !/^===== PAGE/.test(l) && !/^四级\d|^六级\d/.test(l));

const ana = {};

// 写作
{
  const i0 = findIdx((l) => /^Part\s*I\s*Writing/i.test(l.replace(/\s/g, '')));
  const i1 = findIdx((l) => /^.{0,12}listening\s*comprehension/i.test(l), i0 + 1);
  const body = seg(i0, i1 > -1 ? i1 : i0 + 120);
  const mark = (name) => body.findIndex((l) => isMarker(l, name));
  const cut = (from, to) => squash(body.slice(from + 1, to > -1 ? to : body.length).join(' '));
  const i审题 = mark('审题');
  const i范 = mark('参考范文&点评');
  const i译 = mark('范文译文');
  const i词 = mark('亮点词汇');
  const i句 = body.findIndex((l) => /写作句型/.test(l));
  ana.writing = (() => {
    const i审题 = mark('审题');
    const i范 = mark('参考范文&点评');
    const i译 = mark('范文译文');
    const i词 = mark('亮点词汇');
    const i句 = body.findIndex((l) => /写作句型/.test(l));
    // 「参考范文&点评」区是双栏：左=范文，右=点评。版式还原后范文在前、点评紧随
    const sample = i范 > -1 && i译 > i范 ? body.slice(i范 + 1, i译) : [];
    // 点评和译文混在同一段里。译文的开头是范文标题的中译（纯中文、很短、下一行是长正文），
    // 点评每行都夹着英文词（propose / Firstly / helping…），据此切开
    const tail = i译 > -1 ? body.slice(i译 + 1, i词 > -1 ? i词 : body.length) : [];
    let splitAt = tail.findIndex(
      (l, i) =>
        /[：:]/.test(l) && !/[A-Za-z]/.test(l) && l.length <= 25 && (tail[i + 1]?.length ?? 0) >= 25
    );
    if (splitAt < 0) splitAt = tail.findIndex((l) => l.length > 25);
    const note = splitAt > -1 ? tail.slice(0, splitAt) : tail;
    const cn = splitAt > -1 ? tail.slice(splitAt) : [];
    // 亮点词汇是「英文+中文」一体的短块，用「汉字后接空格再接字母」切开
    const vocabSrc = i词 > -1 ? body.slice(i词 + 1, i句 > -1 ? i句 : body.length) : [];
    const vocab = vocabSrc
      .flatMap((l) => l.split(/(?<=[\u4e00-\u9fff，、；）])\s+(?=[A-Za-z])/))
      .map((s) => squash(cleanNoise(s)))
      .filter((s) => s && !/^图/.test(s));
    return {
      review: i审题 > -1 ? stripHeadFrag(cleanNoise(cut(i审题, i范))) : '',
      sample: fixEnSpacing(cleanNoise(squash(sample.join(' ')))),
      sampleNote: cleanNoise(squash(note.join(' '))),
      sampleCn: cleanNoise(squash(cn.join(' '))),
      vocab,
      patterns: i句 > -1 ? body.slice(i句 + 1).map((l) => squash(cleanNoise(l))).filter(Boolean) : [],
    };
  })();
}

// 听力 / 阅读：按 ·答案详解· 切出逐题解析
function parseAnaQuestions(lines) {
  const out = {};
  let hold = null;
  for (const l of lines) {
    const n = numOf(l);
    if (n !== null && n >= 1 && n <= 60) {
      hold = { num: n, head: l.slice(NUM_RE.exec(l)[0].length), body: '' };
      out[hold.num] = hold;
      continue;
    }
    if (hold) hold.body += '\n' + l;
  }
  for (const q of Object.values(out)) {
    const rawLines = q.body.split('\n');
    // 选项译文只出现在「答案详解」块的顶部连续几行里，遇到第一条不含选项字母的行就结束
    const optLines = [];
    for (const l of rawLines) {
      if (/[A-O][)）]/.test(l)) optLines.push(l);
      else if (optLines.length) break;
    }
    const optionCn = {};
    const optText = optLines.join('\n');
    const re = /([A-O])[)）]\s*/g;
    const marks = [];
    let m;
    while ((m = re.exec(optText)) !== null) marks.push({ letter: m[1], start: m.index + m[0].length });
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].start - 2 : optText.length;
      const t = squash(cleanNoise(optText.slice(mk.start, end)));
      if (t && !optionCn[mk.letter]) optionCn[mk.letter] = t;
    });
    q.optionCn = optionCn;

    const head = cleanNoise(squash(q.head));
    // 选词填空的解析头行直接带答案（「26.F)impact（n.影响…）」），先提取再剥离
    const leadAns = /^([A-O])\s*[)）.、]\s*/.exec(head);
    if (leadAns) q.ansGuess = leadAns[1];
    const headBody = leadAns ? head.slice(leadAns[0].length) : head;
    const { en, cn } = splitBilingual(headBody);
    q.stemEn = en;
    q.stemCn = cn;

    // 英文题干单独成行、中文译文在 body 第一行（听力解析常见版式）：把它归位为 stemCn
    let cnHead = '';
    if (
      !q.stemCn &&
      rawLines.length &&
      /^[\u4e00-\u9fff]/.test(rawLines[0]) &&
      !/[A-Za-z]/.test(rawLines[0]) &&
      !/^解析|^答/.test(rawLines[0]) &&
      rawLines[0].length <= 40
    ) {
      cnHead = rawLines[0];
      q.stemCn = squash(cleanNoise(cnHead));
    }

    // 用「按内容剔除」而不是「按行数切片」：body 开头可能有一个空行，切片会错位
    const optSet = new Set(optLines);
    const expl = rawLines
      .filter((l) => !optSet.has(l) && l !== cnHead)
      .map((l) => squash(cleanNoise(l)))
      .filter((l) => l && !/^[A-O][)）]/.test(l))
      .join(' ')
      .replace(/^[→▶►>|丨]+\s*/, '')
      .replace(/^[解]\s*[?？丨|]?\s*析[:：]?/, '')
      .replace(/^解析[:：]?/, '')
      .replace(/解析\s*[?？丨|]?\s*/g, '')
      .trim();
    q.explanation = expl;
    // 卷面 KEYS 缺失时，从解析文案回填答案（「选项B是正确答案」「故选C」「正确答案为A」）
    const am =
      /选项\s*([A-O])\s*是?\s*正确答案/.exec(expl) ||
      /故(?:本题)?\s*选\s*([A-O])\b/.exec(expl) ||
      /所以(?:本题)?\s*选\s*([A-O])\b/.exec(expl) ||
      /(?:正确)?答案\s*(?:为|是|:|：|】)?\s*([A-O])\b/.exec(expl) ||
      /故\s*([A-O])\s*(?:项|正确)/.exec(expl);
    const guess = am ? (am.slice(1).find(Boolean) || '') : '';
    if (guess && !q.ansGuess) q.ansGuess = guess;
    delete q.body;
    delete q.head;
  }
  return out;
}

// 听力：按 News Report / Conversation / Passage 标题切块，每块取 ·听力原文· 与 ·答案详解·
{
  // OCR 会吞掉标题里的空格（NewsReport Three）、截断尾词（Thre）、粘连噪声（Passage Two >），
  // 这里放宽为「短行 + 前缀匹配」
  const labelRe =
    /^(news\s*reports?|conversation|passage)\s*(one|two|thre|three|four)?\s*>?\s*$/i;
  // 解析 PDF 的 OCR 会把罗马数字打成 Ⅱ / I / N 等形态，Part 定位靠部分名关键词而非编号
  const i0 = findIdx((l) => /^.{0,12}listening\s*comprehension/i.test(l));
  const i1 = findIdx((l) => /^.{0,12}reading\s*comprehension/i.test(l), i0 + 1);
  const body = seg(i0, i1 > -1 ? i1 : A.length);
  const canon = (l) => l.replace(/\s+/g, ' ').replace(/^(News|Conversation|Passage)\s*/i, '$1 ').replace(/^\w+\s*\w*/, (m) => m).trim();
  const labelIdx = body.map((l, i) => (l.length <= 25 && labelRe.test(l) ? i : -1)).filter((i) => i >= 0);
  ana.listening = labelIdx.map((li, k) => {
    const end = k + 1 < labelIdx.length ? labelIdx[k + 1] : body.length;
    const chunk = body.slice(li + 1, end);
    const tIdx = chunk.findIndex((l) => isMarker(l, '听力原文'));
    const dIdx = chunk.findIndex((l) => isMarker(l, '答案详解'));
    const transcript = tIdx > -1 ? chunk.slice(tIdx + 1, dIdx > -1 ? dIdx : chunk.length) : [];
    return {
      label: canon(body[li]),
      transcript: squash(transcript.join(' ')),
      questions: dIdx > -1 ? parseAnaQuestions(chunk.slice(dIdx + 1)) : {},
    };
  });
  // 卷面分组与解析标题可能因 OCR 截断而错位，逐题按题号合并，不依赖位置对齐
  ana.listeningByNum = {};
  for (const ch of ana.listening) {
    for (const [n, q] of Object.entries(ch.questions)) ana.listeningByNum[n] = q;
  }
  // 无标签兜底：有的解析 PDF 把 News Report/Conversation 标题全打丢了，只剩 ·答案详解· 块。
  // 按每个 ·答案详解· 标记切块逐题解析，只填上面的合并结果里缺失的题号
  const dIdxs = body.map((l, i) => (isMarker(l, '答案详解') ? i : -1)).filter((i) => i >= 0);
  dIdxs.forEach((di, k) => {
    const end = k + 1 < dIdxs.length ? dIdxs[k + 1] : body.length;
    const qs = parseAnaQuestions(body.slice(di + 1, end));
    for (const [n, q] of Object.entries(qs)) {
      const old = ana.listeningByNum[n];
      if (!old || (!old.explanation && q.explanation)) ana.listeningByNum[n] = q;
    }
  });
}

// 阅读：Section A / B / C 的 ·答案详解·
{
  const i0 = findIdx((l) => /^.{0,12}reading\s*comprehension/i.test(l));
  const body = seg(i0, A.length);
  const secIdx = body
    .map((l, i) => (/^Section\s?[ABC]?\s*$/.test(l) ? { i, s: /[ABC]/.test(l) ? l.match(/[ABC]/)[0] : '?' } : null))
    .filter(Boolean);
  // 补全被截断的 Section 字母
  let last = 'A';
  secIdx.forEach((s) => {
    if (s.s === '?') {
      s.s = last === 'A' ? 'B' : 'C';
    }
    last = s.s;
  });
  const chunks = { A: [], B: [], C: [] };
  secIdx.forEach((s, k) => {
    const end = k + 1 < secIdx.length ? secIdx[k + 1].i : body.length;
    chunks[s.s].push(...body.slice(s.i + 1, end));
  });
  const grab = (arr, from, to) => {
    const s = arr.findIndex((l) => isMarker(l, from));
    if (s === -1) return [];
    let e = arr.length;
    for (const t of to) {
      const j = arr.findIndex((l, i) => i > s && isMarker(l, t));
      if (j > -1 && j < e) e = j;
    }
    return arr.slice(s + 1, e);
  };
  ana.reading = {};
  for (const [k, arr] of Object.entries(chunks)) {
    const d = grab(arr, '答案详解', []);
    ana.reading[k] = {
      overview: squash(grab(arr, '概览', ['全文翻译', '答案详解']).join(' ')),
      translation: squash(grab(arr, '全文翻译', ['答案详解']).join(' ')),
      questions: parseAnaQuestions(d),
    };
  }
  // Section 字母 OCR 常丢失（「Section」裸行），按题号合并比按 Section 分桶更稳
  ana.readingByNum = {};
  for (const k of ['A', 'B', 'C']) {
    for (const [n, q] of Object.entries(ana.reading[k].questions)) ana.readingByNum[n] = q;
  }
  // 兜底：Section 切分失败时，直接按 ·答案详解· 标记在整个 Part III 范围内逐块解析，只补缺失题号
  const dIdxs = body.map((l, i) => (isMarker(l, '答案详解') ? i : -1)).filter((i) => i >= 0);
  dIdxs.forEach((di, k) => {
    const end = k + 1 < dIdxs.length ? dIdxs[k + 1] : body.length;
    const qs = parseAnaQuestions(body.slice(di + 1, end));
    for (const [n, q] of Object.entries(qs)) {
      const old = ana.readingByNum[n];
      if (!old || (!old.explanation && q.explanation)) ana.readingByNum[n] = q;
    }
  });
}

// Part IV 翻译：解析 PDF 里有「难词译注 / 参考译文 / 译点精析」
{
  const i0 = findIdx(
    (l) => /^.{0,12}translation/i.test(l) && !/[\u4e00-\u9fff]/.test(l) && (/min/i.test(l) || l.length <= 30)
  );
  const body = seg(i0, A.length);
  const lineAt = (re) => body.findIndex((l) => re.test(l.replace(/\s/g, '')));
  const i词 = lineAt(/^·?难词译注/);
  const i译 = lineAt(/^·?参考译文/);
  const i点 = lineAt(/^·?译点精析/);
  const pick = (from, to) => (from > -1 ? body.slice(from + 1, to > from && to > -1 ? to : body.length) : []);
  const terms = pick(i词, i译)
    .flatMap((l) => l.split(/\s{2,}|\t/))
    .map((t) => squash(cleanNoise(t)))
    .filter((t) => t.length > 2);
  // 「参考译文」区可能和难点注释合排（「参考译文与难点注释」）：译文是英文，
  // 遇到编号注释条目或成段中文就截止，避免注释混进参考译文
  const refLines = [];
  for (const l of pick(i译, i点)) {
    const t = squash(l);
    if (!t) continue;
    if (/^[0-9]+[.、．]/.test(t)) break;
    const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    if (refLines.length && (cjk > t.length * 0.5 || cjk >= 3)) break;
    refLines.push(t);
  }
  ana.translation = {
    terms,
    reference: fixEnSpacing(squash(refLines.join(' '))),
    notes: squash(pick(i点, -1).join(' ')),
  };
}

// ---------------- 4. 合成 ----------------
function mkQuestions(nums, opts, anaMap, useAnaStem = true) {
  return nums
    .map((n) => {
      const o = opts[n] ?? {};
      const a = anaMap[n] ?? {};
      let options = {};
      for (const k of Object.keys(o.options ?? {}).sort()) options[k] = fixEnSpacing(cleanNoise(o.options[k]));
      if (!Object.keys(options).length && FIXES.options?.[n]) options = { ...FIXES.options[n] };
      // 站点答案已人工校验过映射可靠性，优先级最高；其次是卷面 KEYS，最后才是解析文案回填
      const item = {
        num: n,
        // 听力卷面只有选项，题干要取自解析；阅读卷面有题干，优先用卷面
        stem: fixEnSpacing(cleanNoise(o.stem || (useAnaStem ? a.stemEn ?? '' : '') || FIXES.stems?.[n] || '')),
        stemCn: useAnaStem ? (a.stemCn ?? '') : '',
        options,
        optionCn: a.optionCn ?? {},
        answer: FIXES.answers?.[n] ?? ANSWERS[n] ?? a.ansGuess ?? '',
        analysis: a.explanation || FIXES.analyses?.[n] || '',
      };
      // 空壳题（扫描卷没识别出内容）：渲染出来只是垃圾，直接丢。
      // 选词填空（useAnaStem=false）本身没有题干，只要还有答案/解析就保留
      const letterGrid = !useAnaStem;
      if (letterGrid) {
        if (!item.answer && !item.analysis) return null;
      } else if (!item.stem && !Object.keys(item.options).length && !item.analysis) {
        return null;
      }
      return item;
    })
    .filter(Boolean);
}

const blocks = [];

// Part I 写作
const writingBlock = {
  id: `${meta.id}-writing`,
  group: '短文写作',
  groupCn: 'Writing',
  label: 'Writing',
  prompt: writingPrompt || FIXES.writing?.prompt || '',
  review: ana.writing?.review ?? '',
  sample: ana.writing?.sample || FIXES.writing?.sample || '',
  sampleNote: ana.writing?.sampleNote ?? '',
  sampleCn: ana.writing?.sampleCn ?? '',
  vocab: ana.writing?.vocab ?? [],
  patterns: ana.writing?.patterns ?? [],
  questions: [],
};
if (writingBlock.prompt || writingBlock.sample || writingBlock.review) {
  blocks.push({
    partNo: 'I',
    partName: '写作',
    partNameEn: 'Writing',
    score: 106.5,
    minutes: 30,
    blocks: [writingBlock],
  });
}

// Part II 听力
{
  const labelOf = ['News Report One', 'News Report Two', 'News Report Three', 'Conversation One', 'Conversation Two', 'Passage One', 'Passage Two', 'Passage Three'];
  const cnOf = { 'News Report': '短新闻', Conversation: '长对话', Passage: '短文' };
  const sectionOf = { 'News Report': 'A', Conversation: 'B', Passage: 'C' };
  const items = listeningGroups
    .map((g, i) => {
      // 听力原文按「题号重合度」选最佳解析块，避免 OCR 标题截断导致错位
      const ranked = (ana.listening ?? [])
        .map((ch) => ({ ch, ov: g.nums.filter((n) => ch.questions[n]).length }))
        .sort((a, b) => b.ov - a.ov);
      const best = ranked[0]?.ov ? ranked[0].ch : null;
      const a = best ?? { transcript: '', questions: ana.listeningByNum ?? {} };
      const kind = g.intro.match(/news report/i) ? 'News Report' : /conversation/i.test(g.intro) ? 'Conversation' : 'Passage';
      const optsByNum = {};
      g.questions.forEach((q) => (optsByNum[q.num] = { stem: q.stem, options: q.options }));
      return {
        id: `${meta.id}-L${g.nums[0]}`,
        group: `Section ${sectionOf[kind]}`,
        groupCn: cnOf[kind],
        label: labelOf[i] ?? `Group ${i + 1}`,
        intro: g.intro,
        material: fixEnSpacing(a.transcript).replace(/^Listening Comprehension\s*/i, '') || FIXES.materials?.[`${meta.id}-L${g.nums[0]}`] || '',
        questions: mkQuestions(g.nums, optsByNum, ana.listeningByNum ?? {}),
      };
    })
    .filter((b) => b.questions.length || b.material.length > 40);
  // 听力完整音频（一份）：public/audio/papers/{id}.mp3，由 A/B/C 分段拼接
  // （分段文件由 download-ec-audio.mjs 下载；缺失时现场拼接）
  let audioUrl;
  {
    const merged = `public/audio/papers/${meta.id}.mp3`;
    if (!fs.existsSync(merged)) {
      const parts = ['A', 'B', 'C'].map((L) => `public/audio/papers/${meta.id}-${L}.mp3`);
      if (parts.every((f) => fs.existsSync(f))) {
        fs.writeFileSync(merged, Buffer.concat(parts.map((f) => fs.readFileSync(f))));
        console.log(`  [audio] 已拼接 ${meta.id}.mp3`);
      }
    }
    if (fs.existsSync(merged)) audioUrl = `/audio/papers/${meta.id}.mp3`;
  }
  blocks.push({
    partNo: 'II',
    partName: '听力理解',
    partNameEn: 'Listening Comprehension',
    score: 248.5,
    minutes: 25,
    blocks: items,
    ...(audioUrl ? { audioUrl } : {}),
  });
}

// Part III 阅读
{
  const items = [];
  if (reading.banked) {
    items.push({
      id: `${meta.id}-banked`,
      group: 'Section A',
      groupCn: '选词填空',
      label: 'Banked Cloze',
      material: reading.banked.passage,
      // 站点词库（字母序）比 OCR 词库可靠，词库不一致时整体替换
      wordBank: FIXES.banked
        ? Object.fromEntries(FIXES.banked.bank.map((w, i) => [String.fromCharCode(65 + i), w]))
        : reading.banked.words,
      analysisOverview: ana.reading?.A?.overview ?? '',
      translationCn: ana.reading?.A?.translation ?? '',
      questions: mkQuestions([26, 27, 28, 29, 30, 31, 32, 33, 34, 35], {}, ana.readingByNum ?? {}, false),
    });
  }
  if (reading.long) {
    const optsByNum = {};
    reading.long.statements.forEach((s) => (optsByNum[s.num] = { stem: s.text, options: {} }));
    items.push({
      id: `${meta.id}-long`,
      group: 'Section B',
      groupCn: '长篇阅读',
      label: 'Long Reading',
      material: reading.long.paragraphs.map((p) => `${p.letter}) ${fixEnSpacing(p.text)}`).join('\n'),
      analysisOverview: ana.reading?.B?.overview ?? '',
      translationCn: ana.reading?.B?.translation ?? '',
      questions: mkQuestions([36, 37, 38, 39, 40, 41, 42, 43, 44, 45], optsByNum, ana.readingByNum ?? {}),
    });
  }
  reading.passages.forEach((p, i) => {
    const optsByNum = {};
    p.questions.forEach((q) => (optsByNum[q.num] = { stem: q.stem, options: q.options }));
    const key = 'C';
    items.push({
      id: `${meta.id}-rd${i + 1}`,
      group: 'Section C',
      groupCn: '仔细阅读',
      label: p.title,
      material: p.passage,
      analysisOverview: '',
      translationCn: '',
      questions: mkQuestions(p.questions.map((q) => q.num), optsByNum, ana.readingByNum ?? {}),
    });
  });
  blocks.push({ partNo: 'III', partName: '阅读理解', partNameEn: 'Reading Comprehension', score: 248.5, minutes: 40, blocks: items.filter((b) => b.questions.length || (b.material || '').length > 40) });
}

// Part IV 翻译
const translationBlock = {
  id: `${meta.id}-translation`,
  group: '短文翻译',
  groupCn: 'Translation',
  label: 'Translation',
  prompt: translationPrompt || FIXES.translation?.prompt || '',
  terms: ana.translation?.terms ?? [],
  reference: ana.translation?.reference || FIXES.translation?.reference || '',
  notes: ana.translation?.notes ?? '',
  questions: [],
};
if (translationBlock.prompt || translationBlock.reference || translationBlock.notes) {
  blocks.push({
    partNo: 'IV',
    partName: '翻译',
    partNameEn: 'Translation',
    score: 106.5,
    minutes: 30,
    blocks: [translationBlock],
  });
}

const paper = { ...meta, title: `${meta.year}年${meta.month}月${meta.level === 4 ? '四级' : '六级'}真题（${meta.setNo}）`, minutes: 125, sections: blocks.filter((sec) => sec.blocks.length) };

// ---------------- 5. 导出：每套一个 JSON，由 import-all-papers.mjs 统一拼装 ----------------
const outDir = path.dirname(path.resolve(outPath));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${paper.id}.json`), JSON.stringify(paper, null, 2), 'utf8');

const q = (s) => s.blocks.reduce((n, b) => n + b.questions.length, 0);
console.log(`✅ ${paper.id} → ${path.join(outDir, paper.id + '.json')}`);
console.log(`   答案 ${Object.keys(ANSWERS).length} 个；各 Part 题数：`, blocks.map((b) => `${b.partNo}:${q(b)}`).join(' '));
