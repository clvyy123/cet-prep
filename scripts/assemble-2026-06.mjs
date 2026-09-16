// 组装 2026年6月 六套真题的最终 test-ocr.txt
// 数据来源：
//   - book118 预览文本（4套，含真实听力选项/选词原文/长篇段落）
//   - hqwx 答案册文本（全部6套：写作题目、翻译原文、长篇阅读题目36-45、答案）
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('scripts/.download');
const cet4 = fs.readFileSync(path.join(DIR, 'cet4_2026_06_combined.txt'), 'utf8');
const cet6 = fs.readFileSync(path.join(DIR, 'cet6_2026_06_combined.txt'), 'utf8');

// ---------- 工具函数 ----------
// 清理中文 OCR 空格（"在 中 国" → "在中国"）
const cleanCn = (s) => s
  .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

// 按标记切分段落
function sliceByMarkers(text, markerRe) {
  const marks = [];
  let m;
  markerRe.lastIndex = 0;
  while ((m = markerRe.exec(text)) !== null) marks.push({ idx: m.index, key: m[0] });
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    out.push({ key: marks[i].key, text: text.slice(start, end) });
  }
  return out;
}

// 从某套阅读区提取长篇阅读题目（36-45）题干文本
function extractStatements(secText) {
  const stmts = [];
  const re = /(?:^|[^\d])(3[6-9]|4[0-5])\s*[\.、]\s*/g;
  let m;
  const marks = [];
  while ((m = re.exec(secText)) !== null) marks.push({ n: Number(m[1]), idx: m.index + m[0].length });
  for (let k = 0; k < marks.length; k++) {
    const end = k + 1 < marks.length ? marks[k + 1].idx : secText.length;
    let chunk = secText.slice(marks[k].idx, end);
    // 截断定位/答案部分
    const cut = chunk.search(/【\s*定\s*位|定\s*位\s*[：:]|定\s*位\s*句|答\s*案\s*[：:]|答\s*案\s+[A-O]/);
    if (cut !== -1) chunk = chunk.slice(0, cut);
    let text = chunk.replace(/\s+/g, ' ').trim()
      .replace(/^\s*(?:A\)|B\)|C\)|D\))\s*/, '')
      .replace(/\s+[A-O]\s*$/, '');
    // 去除末尾残留页码/标记
    text = text.replace(/\s*[-·]\s*\d+\s*$/, '').trim();
    if (text.length > 15 && /[A-Za-z]/.test(text)) stmts.push({ n: marks[k].n, text });
  }
  // 按题号去重（保留第一个）
  const seen = new Set();
  return stmts.filter((s) => (seen.has(s.n) ? false : (seen.add(s.n), true))).sort((a, b) => a.n - b.n);
}

// 提取翻译中文原文（到英文译文/下一主题前）
function extractTranslation(text, titleRe, stopRe) {
  const t = text.match(titleRe);
  if (!t) return '';
  let seg = t[0].replace(titleRe, '').trim();
  // 截断：英文译文开头 / 下一翻译主题 / 下一大节
  const stop = seg.search(stopRe);
  if (stop !== -1) seg = seg.slice(0, stop);
  return cleanCn(seg);
}

// ---------- 翻译原文 ----------
// CET4 三套翻译（hqwx 顺序：一日为师/餐桌礼仪/礼尚往来）
const transCET4 = {
  1: extractTranslation(cet4, /一日为师[\s\S]*?中国有句老话[\s\S]*?(?=参考译文)/, /参考译文/),
  2: extractTranslation(cet4, /餐桌礼仪（dining etiquette）[\s\S]*?(?=参考译文)/, /参考译文/),
  3: extractTranslation(cet4, /礼尚往来[\s\S]*?(?=参考译文)/, /参考译文/),
};
// CET6 三套翻译（远程医疗/电子商务/无人机）
const transCET6 = {
  1: extractTranslation(cet6, /远程医疗[\s\S]*?(?=Advances?\s+in\s+technology|电子商务)/, /Advances?\s+in\s+technology|电子商务/),
  2: extractTranslation(cet6, /电子商务的蓬勃发展[\s\S]*?(?=The\s+rapid\s+growth|无人机)/, /The\s+rapid\s+growth|无人机/),
  3: extractTranslation(cet6, /无人机[\s\S]*?(?=In\s+recent\s+years|作文部分)/, /In\s+recent\s+years|作文部分/),
};
console.log('=== 翻译提取 ===');
for (const [k, v] of Object.entries({ ...transCET4, ...transCET6 })) console.log(`  ${k}: ${v.length} 字`);

// ---------- 长篇阅读题目（36-45）----------
// CET4 阅读区按 "阅读第X套参考答案" 切分
const cet4Reading = sliceByMarkers(cet4, /阅读第([一二三四123])套参考答案/g);
const cet6Reading = sliceByMarkers(cet6, /阅读第([一二三四123])套/g);
const stmtsCET4 = { 1: [], 2: [], 3: [] };
for (const sec of cet4Reading) {
  const m = /阅读第([一二三四123])套/.exec(sec.key);
  const n = { 一: 1, 二: 2, 三: 3, 1: 1, 2: 2, 3: 3 }[m[1]];
  stmtsCET4[n] = extractStatements(sec.text);
}
const stmtsCET6 = { 1: [], 2: [], 3: [] };
for (const sec of cet6Reading) {
  const m = /阅读第([一二三四123])套/.exec(sec.key);
  const n = { 一: 1, 二: 2, 三: 3, 1: 1, 2: 2, 3: 3 }[m[1]];
  stmtsCET6[n] = extractStatements(sec.text);
}
console.log('\n=== 长篇题目提取 ===');
for (const k of [1, 2, 3]) {
  console.log(`  CET4 第${k}套: ${stmtsCET4[k].length} 题 | CET6 第${k}套: ${stmtsCET6[k].length} 题`);
}

// ---------- 写作题目（仅 hqwx-only 的两套需要重写） ----------
const writingCET4_3 = 'Directions: For this part, you are allowed 30 minutes to write a short essay on the importance of participating in at least one research project for college students. You should write at least 120 words but no more than 180 words.';
const writingCET6_1 = 'Directions: For this part, you are allowed 30 minutes to write an essay on the importance of understanding traditional Chinese culture for promoting cultural exchange. You should write at least 150 words but no more than 200 words.';

// 组装长篇题目文本块
const stmtBlock = (list) => (list.length ? '\n\n' + list.map((s) => `${s.n}. ${s.text}`).join('\n\n') : '');

// Section C 占位（无原文，仅用于结束 Section B 边界；注释文字不得包含 "Section" 字样，
// 否则会被 build-banks 误识别为第二个 Section 标记而生成空阅读项）
const SECC_NOTE = '\n\nSection C\n\nQuestions 46 to 50 are based on the following passage.\n（原文暂缺，本题型可用其他套卷练习）\n';

// Part IV 翻译块
const part4 = (title, trans) => `\n\nPart IV Translation (30 minutes)\nDirections: For this part, you are allowed 30 minutes to translate a passage from Chinese into English.\n${trans}\n`;

// ---------- 组装各套 ----------
function assemble(base, opts) {
  let t = base;
  if (opts.truncateAt36) {
    const i36 = t.search(/(?:^|[^\d])36\s*\./);
    if (i36 !== -1) t = t.slice(0, i36);
  }
  t += stmtBlock(opts.statements || []);
  t += SECC_NOTE;
  t += part4(opts.title, opts.translation);
  return t;
}

const sets = [
  {
    key: 'cet4/2026_06_1', name: 'CET4 第1套',
    base: path.join(DIR, 'cet4', '2026_06_1', 'test-ocr.txt'),
    truncateAt36: true, statements: stmtsCET4[1], translation: transCET4[1],
  },
  {
    key: 'cet4/2026_06_2', name: 'CET4 第2套',
    base: path.join(DIR, 'cet4', '2026_06_2', 'test-ocr.txt'),
    truncateAt36: false, statements: stmtsCET4[2], translation: transCET4[2],
  },
  {
    key: 'cet4/2026_06_3', name: 'CET4 第3套',
    base: null, // 重建
    write: `2026年6月大学英语四级考试真题(第3套)

Part I Writing (30 minutes)
${writingCET4_3}

提示：本套试卷的听力和阅读原文暂缺，本卷仅收录写作与翻译部分，可用于写作、翻译专项练习。
${part4('CET4 第3套', transCET4[3])}`,
    translation: transCET4[3],
  },
  {
    key: 'cet6/2026_06_1', name: 'CET6 第1套',
    base: null,
    write: `2026年6月大学英语六级考试真题(第1套)

Part I Writing (30 minutes)
${writingCET6_1}

提示：本套试卷的听力和阅读原文暂缺，本卷仅收录写作与翻译部分，可用于写作、翻译专项练习。
${part4('CET6 第1套', transCET6[1])}`,
    translation: transCET6[1],
  },
  {
    key: 'cet6/2026_06_2', name: 'CET6 第2套',
    base: path.join(DIR, 'cet6', '2026_06_2', 'test-ocr.txt'),
    truncateAt36: false, statements: stmtsCET6[2], translation: transCET6[2],
  },
  {
    key: 'cet6/2026_06_3', name: 'CET6 第3套',
    base: path.join(DIR, 'cet6', '2026_06_3', 'test-ocr.txt'),
    truncateAt36: false, statements: stmtsCET6[3], translation: transCET6[3],
  },
];

console.log('\n=== 组装 test-ocr.txt ===');
for (const s of sets) {
  let t;
  if (s.write) {
    t = s.write;
  } else {
    const base = fs.readFileSync(s.base, 'utf8');
    t = assemble(base, s);
  }
  fs.writeFileSync(path.join(DIR, s.key, 'test-ocr.txt'), t, 'utf8');
  console.log(`  ${s.name}: ${t.length} 字符`);
}

console.log('\n=== 完成，请运行: node scripts/build-banks.mjs --auto ===');
