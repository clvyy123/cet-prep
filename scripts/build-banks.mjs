// 构建脚本：从 cettong.cn 下载的真题 PDF 生成内置题库 TS 数据文件
// 用法：先运行 scripts/fetch-cet.mjs 下载 PDF + OCR，再 node scripts/build-banks.mjs [--auto]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const DIR = path.resolve('scripts/.download');
const OUT = path.resolve('src/data/builtin-banks.ts');
// 选词填空归档恢复：新 OCR（PaddleOCR-VL）对扫描版 Section A 的选项/答案提取不稳定，
// 词库会退化为字母/乱码；备份库中已核验的选词数据（单词答案、A-O 序词库）以此为准。
// banked-archive.json 由备份库 builtin-banks.ts 提取生成（61 套），勿手改。
let BANKED_ARCHIVE = {};
try {
  BANKED_ARCHIVE = JSON.parse(fs.readFileSync(path.resolve('scripts/banked-archive.json'), 'utf8'));
} catch (e) {
  console.warn('警告：banked-archive.json 读取失败，选词填空区将使用本次构建结果', e.message);
}
// 选词填空复用映射：部分套题官方说明"与前两套内容相同，不再重复出现"（如 2021年12月六级第3套），
// 构建时从已处理的源套题复制整份选词数据（答案/词库/passage）。
const BANKED_COPY = {
  'bi-cet6-2021_12_3': 'bi-cet6-2021_12_1',
};
// pdfjs 解码资源（CMap / 标准字体 / wasm 编解码器）
const PDFJS_OPTS = {
  wasmUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/wasm')).href + '/',
  cMapUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/cmaps')).href + '/',
  cMapPacked: true,
  standardFontDataUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts')).href + '/',
};

// ---------- PDF 文本提取 ----------
async function extractPdf(file) {
  const p = path.isAbsolute(file) ? file : path.join(DIR, file);
  const buf = new Uint8Array(fs.readFileSync(p));
  const doc = await pdfjs.getDocument({ data: buf, ...PDFJS_OPTS }).promise;
  let all = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    all += (tc.items || []).map((it) => it.str || '').join(' ') + '\n';
  }
  try { await doc.destroy(); } catch {}
  // 无文字层（扫描版）时回退到同目录 OCR 文本（太小的 OCR 文件视为失败产物，仍用文字层）
  if (all.replace(/\s/g, '').length < 500) {
    const ocr = path.join(path.dirname(p), 'test-ocr.txt');
    if (fs.existsSync(ocr) && fs.statSync(ocr).size > 500) return fs.readFileSync(ocr, 'utf8');
  }
  return all.replace(/[ \t]+/g, ' ').trim();
}

// 扫描版 OCR 噪声清理：移除 "===== PAGE N =====" 页标记行与
// "2021-12-CET4(第1套)-3" 页脚行（两类在 OCR 中均独立成行，删行不影响正文）
function cleanOcrText(t) {
  return t
    .replace(/^\s*=====\s*PAGE\s*\d+\s*=====\s*$/gm, '\n') // 页标记行
    .replace(/^\s*\d{4}-\d{2}-CET[46][^\n]*$/gm, '\n')     // 页脚行
    .replace(/\n{3,}/g, '\n\n');                           // 压缩多余空行
}

// 统一噪声清理（OCR 与隐藏文字层均适用）：
// 1) 删除 � 替换符（原文已丢失，删除可避免乱码并恢复相邻单词可读性）
// 2) 删除 OCR 损坏的页脚残片 "2021年6月 第N页/套"（如 "Im� 2021 1¥ 6 � 1"、"20211:p 6 JJ 6"），
//    这类残片里的数字会被误识别为假题号、截断选项
function stripFooterNoise(t) {
  return t
    // � 替换符：英文单词之间的 � 是选词填空的空位（PDF 文字层把下划线渲染成 �），转成空位标记；
    // 其余 �（中文乱码等）删除，避免污染相邻单词可读性
    .replace(/(?<=[A-Za-z])\s*\uFFFD\s*(?=[A-Za-z0-9])/g, '____')
    .replace(/\uFFFD/g, '')
    // 完整页眉 "2023 年 12 月 四 级 真题 (第 一 套)"（OCR 常带 "+"、页码前缀）；
    // "第X套" 后缀可选——预览文本页眉可能只有 "2026年6月大学英语四级考试真题"（无套号）
    .replace(/(?:\d{1,2}\s*\+?\s*)?20\d{2}\s*年\s*\d{1,2}\s*月\s*(?:大学英语?)?[四六]\s*级\s*考试?\s*真题\s*(?:[（(]?\s*第\s*[一二三四0-9]+\s*套\s*[）)]?)?/g, ' ')
    // 独立页脚标记 "(第 1 套 )"
    .replace(/[（(]\s*第\s*\d{1,2}\s*套\s*[）)]/g, ' ')
    // OCR 损坏的页脚残片：仅匹配行首短残片（年份开头，<25 字符，含月份数字）
    // 不再用跨行贪婪匹配，避免吞掉 KEYS 答案区的题号和字母
    .replace(/^[ \t]*20\d{2}[^\nA-Za-z]{0,18}?(?:6|12|9|3)[^\nA-Za-z]{0,10}?\d{1,3}[ \t]*$/gm, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

// 选项级页脚/乱码清理：选项尾部粘着页脚残片时，从年份处截断到最近的完整句子
// 听力 Directions 引导句的 OCR 粘连特征子串（空格被吞掉的无空格形式）。
// 选项 D 尾部粘着下一组题 Directions 时，在首个特征处截断。
// 这些子串只出现在 Directions/引导句，正常选项正文不会出现，可安全截断。
const DIR_OCR_MARKS = [
  'conversationyouwillhear',
  'passageyouwillhear',
  'recordingyouwillhear',
  'willhearfourquestions',
  'willhearfourquestion',
  'willhearfour',
  'willhearthree',
  'willhearfourtwo',
  'willbeplayedonlyonce',
  'willbespokenonlyonce',
  'willbesokeonlyonce',
  'recordingswillbeplayedonlyonce',
  'youhearaquestion',
  'afteryouheara',
  'hearaquestion',
  'youmustchoose',
  'thecorrespondingletteronanswer',
  'correspondingletteronanswersheet',
  'answerSheet1withasingleline',
  'theconversationandthequestionwillbe',
  'theconversationandthequestionswillbe',
  'thepassageandthequestionwillbe',
  'thepassageandthequestionswillbe',
  'fourquestionsand',
  'questionsandthequestionwillbe',
];
// 英文正文 OCR 乱码清理（仔细阅读/选项/题干通用）：
// 1) 删除括号内无英文单词的注释（OCR 把 PDF 生词旁的中文释义识别成乱码，如 "( -iA {JI.;)"、"(-it.fib 1 1 •-fu-;f;-}"）；
//    含正常英文单词的括号（如 "(science, technology...)"）保留
// 2) 删除英文正文不存在的符号（€ ¥ • · 反斜杠 下划线等）与 OCR 乱码 token 串
function cleanEnglishGarbage(s) {
  const t = String(s || '')
    .replace(/\uFFFD/g, ' ')
    // 括号：含 OCR 垃圾符号（€•·{} 反斜杠 下划线等）或无英文单词的括号整体删除
    .replace(/[（(][^）)]*?[）)}]/g, (mm) => {
      const inner = mm.slice(1, -1);
      if (/[€¥•·§^`~{}|\\_×]/.test(inner)) return '';
      if (/[A-Za-z]{2,}/.test(inner)) return mm;
      return '';
    })
    .replace(/[（(]\s*[）)]/g, '')
    // 词首下划线删除（_People's → People's）
    .replace(/(?:^|\s)_+([A-Za-z])/g, ' $1')
    // 含下划线的乱码 token 整体删除（_a_y_f、!'!_、b_el）
    .replace(/\S*_+\S*/g, ' ')
    // 英文正文不存在的符号（€ 从不合法；£ 是英镑符号保留）
    .replace(/[€¥•·§^`~{}|\\]/g, ' ')
    .replace(/[\uFFFD。，、；：]/g, ' ');
  return stripGarbageRuns(t)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
// 垃圾 token 判定：含 OCR 垃圾符号、数字+符号+字母畸形混合、纯符号/裸括号残片
function isGarbageToken(t) {
  if (!t || /[A-Za-z]{2,}/.test(t)) return false;       // 正常单词（≥2 连续字母）直接保留
  if (/[€¥•·§^`~{}|\\_]/.test(t)) return true;
  if (/^\d+[.;:!?'"][a-z]/i.test(t)) return true;       // 0.i、1;r?
  if (/^\d+'$/.test(t)) return true;                    // 4'
  if (/^[^A-Za-z0-9]+$/.test(t)) return true;           // 纯符号：')、!'!、;-、>')
  return false;
}
// 删除 OCR 乱码 token 串：以垃圾 token 为锚，吸收相邻非单词 token 整串删除。
// 例："spotlight 0.i 1;€r? 4' 1 \>') squarely" → "spotlight squarely"；
// 真实数字（"20 percent"、"at 8 p.m."、"£12bn"）无垃圾锚点，不受影响。
function stripGarbageRuns(s) {
  const toks = String(s || '').split(' ');
  const absorbable = (t) => t && !/[A-Za-z]{2,}/.test(t) && !/[\n\r]/.test(t);
  const rm = new Array(toks.length).fill(false);
  for (let i = 0; i < toks.length; i++) {
    if (!toks[i] || !isGarbageToken(toks[i])) continue;
    let L = i;
    while (L > 0 && absorbable(toks[L - 1])) L--;
    let R = i;
    while (R < toks.length - 1 && absorbable(toks[R + 1])) R++;
    for (let k = L; k <= R; k++) rm[k] = true;
    i = R;
  }
  return toks.filter((t, i) => !rm[i]).join(' ');
}
function cleanOption(o) {
  let t = cleanEnglishGarbage(o).replace(/\bTt\b/g, 'It').replace(/[ \t]{2,}/g, ' ').trim();
  // OCR 粘连的 Directions/引导句截断（先于年份页脚清理）
  for (const mk of DIR_OCR_MARKS) {
    const idx = t.indexOf(mk);
    if (idx > 0) { t = t.slice(0, idx); break; }
  }
  // 粘连引导句 "Questions3and4arebasedonthe..." / "Questions16to18arebasedonthe"（预览文本无空格变体）
  const qg = t.search(/Questions?\s*\d{1,2}\s*(?:and|to)\s*\d{1,2}\s*are\s*based\s*on/i);
  if (qg > 0) t = t.slice(0, qg);
  const fi = t.search(/(?:^|[^A-Za-z])20\d{2}/);
  if (fi !== -1) {
    const head = t.slice(0, fi);
    const dot = Math.max(head.lastIndexOf('.'), head.lastIndexOf('?'), head.lastIndexOf('!'));
    t = dot >= 0 ? head.slice(0, dot + 1) : head.replace(/\s+[^\s.]{1,4}$/, '');
  }
  // 完整句点后粘着页脚/乱码残片（<8 字符，如 ". Im"、". [9f;&"）时截到句点
  const d = Math.max(t.lastIndexOf('.'), t.lastIndexOf('?'), t.lastIndexOf('!'));
  if (d > 0 && t.length - d - 1 < 8) t = t.slice(0, d + 1);
  return t.trim();
}

// ---------- 答案解析（KEYS 区解析） ----------
function parseAnswerMap(text) {
  const map = new Map();
  // 0) HTML 表格：<table><tr><td>1</td><td>2</td>...</tr><tr><td>C</td><td>A</td>...</tr>
  //    mineru OCR 保留答案表格结构，题号行后跟答案行
  const tableRe = /<table>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(text)) !== null) {
    const inner = tm[1];
    const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
    const rows = [];
    let rm;
    while ((rm = rowRe.exec(inner)) !== null) {
      const cells = rm[1].split(/<\/?td[^>]*>/i).filter(s => s.trim());
      rows.push(cells.map(c => c.trim()));
    }
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].every(c => /^\d{1,2}$/.test(c)) && rows[i+1].every(c => /^[A-Oa-o]$/.test(c))) {
        for (let k = 0; k < rows[i].length && k < rows[i+1].length; k++) {
          const n = parseInt(rows[i][k], 10);
          if (n >= 1 && n <= 55 && !map.has(n)) map.set(n, rows[i+1][k].toUpperCase());
        }
      }
    }
  }
  // 1) 文本答案区（KEYS / 参考答案 / Answer Keys / "答案："）
  //    严格匹配真正的答案区，避免误把试卷标题里的「真题及答案解析」当成答案区
  let secStart = text.search(/KEYS\b|参考\s*答案|Answer\s*Keys?/i);
  if (secStart === -1) secStart = text.search(/答案\s*[:：]/);
  if (secStart === -1) return map;
  const sec = text.slice(secStart);
  const rangeRe = /(\d{1,2})\s*[-~—–]\s*(\d{1,2})\s*[:：]?\s*([A-Oa-o](?:[\s,，、/]*[A-Oa-o]){0,9})/g;
  let m;
  while ((m = rangeRe.exec(sec)) !== null) {
    const s = parseInt(m[1], 10);
    const e = parseInt(m[2], 10);
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
    // 匹配：题号数 ≥3 且 字母数 ≥ 题号数（允许尾部噪声字母，只取前 N 个）
    if (nums.length >= 3 && letters.length >= nums.length) {
      for (let k = 0; k < nums.length; k++) {
        const n = parseInt(nums[k], 10);
        if (!map.has(n)) map.set(n, letters[k].toUpperCase());
      }
    }
  }
  if (secStart !== -1) {
    const singleRe = /(\d{1,2})\s*[\.\)、]\s*([A-Oa-o])\b/g;
    while ((m = singleRe.exec(sec)) !== null) {
      const n = parseInt(m[1], 10);
      if (!map.has(n)) map.set(n, m[2].toUpperCase());
    }
  }
  return map;
}

// ---------- 答案补充：answer.pdf 文本层（题号分段法） ----------
function layerSegmentAnswers(layer) {
  const out = {};
  const segs = [];
  const re = /\b(\d{1,2})\s*\.\s+([A-Za-z])/g;
  let m;
  while ((m = re.exec(layer)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 55) segs.push({ n, start: m.index + m[0].length });
  }
  for (let k = 0; k < segs.length; k++) {
    const end = k + 1 < segs.length ? segs[k + 1].start : layer.length;
    const seg = layer.slice(segs[k].start, Math.min(end, segs[k].start + 400));
    const mm = seg.match(/([A-Oa-o])\s*[\)）]/);
    if (mm) out[segs[k].n] = mm[1].toUpperCase();
  }
  return out;
}

// ---------- 答案补充：analysis.json 逐题文本末尾答案标记 ----------
// 扫描件 OCR 常见字母→数字混淆：A→4, B→8, D→0, O→0, I→1, G→6, S→5
const OCR_DIGIT_MAP = { '4': 'A', '8': 'B', '0': 'D', '1': 'I', '6': 'G', '5': 'S', '9': 'G', '2': 'Z', '3': 'E', '7': 'T' };
function normAnswerLetter(c) {
  const u = String(c).toUpperCase();
  if (u >= 'A' && u <= 'O') return u;
  return OCR_DIGIT_MAP[u] || '';
}
function lastAnswerFromAnalysis(txt) {
  if (!txt) return '';
  // 按优先级收集所有答案标记，取最后一次（每题解析末尾即本题答案）
  // 兼容 OCR 空格："选 项C正确" / "故 选 项A正确" / "答 案为X"
  // OCR 变体：答→笞、案→笁
  const ANS = '(?:答|笞)';
  const patterns = [
    new RegExp(`${ANS}\\s*案\\s*[为是]\\s*[（(]?([A-Oa-o0-9])\\s*[\\)）]`, 'g'),
    new RegExp(`[故因选]\\s*${ANS}\\s*案\\s*[为是]\\s*[（(]?([A-Oa-o0-9])`, 'g'),
    new RegExp(`${ANS}\\s*案\\s*[为是]\\s*([A-Oa-o0-9])\\s*[。.，,]`, 'g'),
    /[故因]\s*([A-Oa-o0-9])\s*项\s*[为与是]/g,
    new RegExp(`${ANS}\\s*案\\s*[为是]\\s*([A-Oa-o0-9])\\s*(?:项|$)`, 'g'),
    new RegExp(`本题\\s*${ANS}\\s*案\\s*[为是]\\s*[（(]?([A-Oa-o0-9])`, 'g'),
    // "正确答案是X" / "正确答案为X"（OCR 把"答"识别成"笞"）
    new RegExp(`(?:正确|准确)\\s*${ANS}\\s*案\\s*[为是]?\\s*[（(]?\\s*([A-Oa-o0-9])\\s*项?`, 'g'),
    // "选项X与文章内容一致，因此为正确答案"
    /选\s*项\s*([A-Oa-o0-9])\s*与\s*文章内容/g,
    // 解析书常见格式："选项A正确" / "选项A为正确答案" / "选项A答案"
    // OCR 空格兼容："选 项A正确" / "选  项 A正确"
    /选\s*项\s*([A-Oa-o0-9])\s*(?:为)?(?:正确|答案)/g,
    // "故选A" / "故选A项" / "故选A为正确答案"
    /故选\s*([A-Oa-o0-9])\s*项?\s*(?:为)?(?:正确)?(?:答案)?/g,
    // "故本题选D" / "本题选D"
    /(?:故)?本题选\s*([A-Oa-o0-9])/g,
    // "A项为正确" / "A项正确" / "A为正确答案"
    /([A-Oa-o0-9])\s*项\s*为?\s*正确/g,
    /([A-Oa-o0-9])\s*为\s*正确\s*答案/g,
    // "由此可知，选项A..." / "故选项A..." 中的字母（OCR 空格兼容）
    /(?:由此可知|故|因此)\s*选\s*项?\s*([A-Oa-o0-9])\s*(?:为|是|正确)/g,
  ];
  let last = '';
  for (const re of patterns) {
    let m;
    while ((m = re.exec(txt)) !== null) last = normAnswerLetter(m[1]);
  }
  if (last) return last;
  const h = txt.match(/(?:^|[\n。])\s*[（(]?([A-Oa-o0-9])\s*[\)）]\s*[【\[]?\s*[精请析]/);
  if (h) return normAnswerLetter(h[1]);
  // 回退："故为答案"/"故为正确答案" 无字母时，取解析中最后一个 "选项X" 的字母
  // OCR 空格兼容："选 项X"
  if (/故为(?:正确)?答案/.test(txt)) {
    const letters = [];
    let m;
    const re1 = /选\s*项\s*([A-Oa-o0-9])/g;
    while ((m = re1.exec(txt)) !== null) letters.push(normAnswerLetter(m[1]));
    if (letters.length) return letters[letters.length - 1];
  }
  // 排除法：解析末尾明确排除恰好 3 个选项（A-D 范围）时，取剩余选项
  // 按句切分，仅统计含"排除/未提及/没有相关信息/不符/不一致/无关"的句子中出现的选项字母
  // 覆盖 "故排除X项"、"X项与此不符"、"X、Y和Z文章中均未提及"、"故排除选项C" 等格式
  const excluded = new Set();
  const exclSentences = txt.split(/[。；\n]/);
  for (const s of exclSentences) {
    if (!/(?:排除|均?未[提談][及到]|末提及|没有相关|没有信息|不符|不一致|不[一-]致|无关|不是|并不)/.test(s)) continue;
    const letters = s.match(/[A-Da-d0-9]/g);
    if (!letters) continue;
    for (const c of letters) {
      const l = normAnswerLetter(c);
      if (l && 'ABCD'.includes(l)) excluded.add(l);
    }
  }
  if (excluded.size === 3) {
    const rest = ['A', 'B', 'C', 'D'].filter((x) => !excluded.has(x));
    if (rest.length === 1) return rest[0];
  }
  return '';
}

// 本次网络抓取已验证的套题白名单：其 answers.json 的值经过
// 「答案文本 ↔ 本地选项」映射验证（bilibili/沪江/sohu 官方答案册），
// 可靠度高于 analysis.json 双栏 OCR 错位提取，允许覆盖。
const VERIFIED_ANSWER_SETS = new Set([
  'cet4/2021_06_3',
  'cet4/2022_06_1',
  'cet4/2022_12_1',
  'cet4/2022_12_2',
  'cet4/2023_06_1',
  'cet4/2023_12_1',
  'cet4/2023_12_2',
  'cet6/2021_06_1',
  'cet6/2022_09_1',
]);
function isVerifiedSet(setDir) {
  const rel = setDir.replace(/\\/g, '/').replace(/^.*?\/\.download\//, '');
  return VERIFIED_ANSWER_SETS.has(rel);
}

// 三级答案收集：KEYS(试卷答案区) → answers.json → analysis.json → answer.pdf 文本层
// 注：answers.json 在处理顺序上排在 analysis.json 之前，但默认只在 analysis 缺失时补充
// （防止历史串号网络答案覆盖官方答案）；对 VERIFIED_ANSWER_SETS 白名单套题，
// 其 answers.json 为本次人工/网络验证值，允许覆盖 analysis 的错位提取。
function collectAnswerMap(setDir, testText, analysisJson, isOcrText) {
  // KEYS 区解析：parseAnswerMap 用 \bKEYS\b 锚定，不会误匹配中文标题「真题及答案解析」
  const map = parseAnswerMap(testText);
  const fill = (n, a) => { if (n >= 1 && n <= 55 && !map.has(n)) map.set(n, a); };
  const override = (n, a) => { if (n >= 1 && n <= 55) map.set(n, a); }; // 白名单强制覆盖

  // 0) answers.json（人工校准/网络抓取）。白名单套题：仅对 _verified 标记的题号
  //    （本次「答案文本↔本地选项」映射验证过的）允许覆盖 analysis，防止历史串号值污染；
  //    非白名单套题：仅补充缺失（fill），不覆盖 KEYS/analysis。
  //    处理顺序：analysis 之后执行（见下方），使非验证题号以 analysis 为准。
  const ansJson = path.join(setDir, 'answers.json');
  const verified = isVerifiedSet(setDir);
  const applyAnswersJson = () => {
    if (!fs.existsSync(ansJson)) return;
    try {
      const am = JSON.parse(fs.readFileSync(ansJson, 'utf8'));
      const verifiedNums = new Set(verified && Array.isArray(am._verified) ? am._verified.map(Number) : []);
      const put = (n, raw) => {
        if (verifiedNums.has(n)) override(n, raw); // 白名单已验证题号：强制覆盖
        else fill(n, raw);                          // 其余：仅补充缺失
      };
      for (const [nStr, v] of Object.entries(am)) {
        const n = Number(nStr);
        const raw = String(v).trim();
        if (!raw || !Number.isFinite(n) || n < 1 || n > 55) continue;
        if (n >= 26 && n <= 35) {
          if (!map.has(n)) map.set(n, raw); // 选词填空：判分比较单词，存单词
        } else if (n >= 36 && n <= 45 && 'ABCDEFGHIJKLMNO'.includes(raw.toUpperCase())) {
          put(n, raw.toUpperCase());
        } else if ('ABCD'.includes(raw.toUpperCase())) {
          put(n, raw.toUpperCase());
        }
      }
    } catch (e) {
      console.warn('警告：answers.json 解析失败', e.message);
    }
  };

  // 1) analysis.json 逐题末尾标记（官方星火答案册）。仅补充缺失题号。
  if (analysisJson) {
    const a = analysisJson.analysis || {};
    for (let n = 1; n <= 55; n++) {
      if (map.has(n)) continue;
      const t = a.listening?.[n] || a.banked?.[n] || a.long?.[n] || a.reading?.[n] || '';
      const ans = lastAnswerFromAnalysis(t);
      if (!ans) continue;
      const okRange = n >= 26 && n <= 45 ? 'ABCDEFGHIJKLMNO'.includes(ans) : 'ABCD'.includes(ans);
      if (okRange) fill(n, ans);
    }
  }

  // 2) answers.json（在 analysis 之后应用：验证题号覆盖错位提取，其余仅补缺）
  applyAnswersJson();

  // 2) answer.pdf 文本层
  const layer = path.join(setDir, 'answer-layer.txt');
  if (fs.existsSync(layer)) {
    const seg = layerSegmentAnswers(fs.readFileSync(layer, 'utf8'));
    for (const [nStr, l] of Object.entries(seg)) {
      const n = Number(nStr);
      const ok = n >= 26 && n <= 45 ? 'ABCDEFGHIJKLMNO'.includes(l) : 'ABCD'.includes(l);
      if (ok) fill(n, l);
    }
  }
  return map;
}

// ---------- 听力题干：从解析 PDF（answer 文本层 / 扫描版 OCR）提取真实题干 ----------
function cleanStem(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/©/g, 'C')
    .replace(/\s+([?!。])/g, '$1')
    .replace(/^Q\s*[:：]?\s*/, '') // 部分解析书题号后带 "Q:" 前缀
    .replace(/\s*\|[^\n]*$/, '') // 双栏 OCR 分隔符 "|" 后为右栏内容，截断
    .replace(/\s+[A-Z]{2,}(?:\s+[A-Z]{2,})*/g, ' ') // 删除 OCR 把中文识别成的全大写垃圾串
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef].*$/s, '') // 去掉双栏 OCR 夹带的右栏中文及标点
    .replace(/\s+[A-Oa-o]\s*[\)）]?\s*$/, '')
    .trim();
}
// 手工题干表：源解析缺失、但题干可从官方真题资源确认的听力题（网络核验，勿覆盖同题号已有题干）
const MANUAL_STEMS = {
  // 2023年3月CET4第1套：答案解析源无听力部分（analysis.listening 空）
  // 题干来源：2023年3月英语四级听力真题及原文（docin p-4377040212 / 新东方），选项与本地题库逐项核对一致
  'cet4/2023_03_1': {
    1: 'What is the news report mainly about?',
    2: 'What benefit will a free trade deal bring to African economy?',
    3: 'What new method has been developed to help fight climate change?',
    4: 'What is a potential difficulty in applying the new technique?',
    5: "What does the news report say about French people's bread consumption?",
    6: 'What do we learn about French women from the report?',
    7: "What is said about lifestyle changes of the French people?",
    8: 'When would the man like to leave for London?',
    9: "What is the man's other request?",
    10: 'Where should the man wait for the train?',
    11: 'What should the man do to collect the bicycles?',
    12: 'What do we learn about hat factories in Britain?',
    13: 'What is special about Cube Movie Theater?',
    14: 'What does the man say about most people in London?',
    15: 'What does the woman say about foreign movies shown in London?',
    16: 'What do we learn about Astrid Natalie, a secondary school math teacher?',
    17: 'Why does Helen Lockhart, a registered nurse, support a complete ban on smartphone use in the classroom?',
    18: 'What should students do in the classroom according to Richard Stone, an English teacher?',
    19: 'How did Kate earn the reward from her mother?',
    20: 'What did Kate do after her mother left the room?',
    21: "What did Kate's family do after the packages arrived?",
    22: 'According to recent research conducted in Australia, what has a lasting impact on one\u2019s life?',
    23: 'What was the purpose of the Australian research?',
    24: "Who were the participants in the researchers' first study?",
    25: 'According to the researchers, what is one characteristic of successful people?',
  },
  // 2022年9月CET6第1套 Q25：analysis.listening[25] 为 OCR 残片（"o people of different personalities react to"）
  // 题干来源：2022年9月英语六级真题+答案（文档网全3套），选项与本地题库逐项核对一致
  'cet6/2022_09_1': {
    25: 'How do people of different personalities react to distractions according to other studies?',
  },
  // 2026年6月CET4第1套：源无 analysis.json，题干提取自 hqwx 听力原文转写稿（Q1-Q25），
  // 选项与 book118 预览逐题核对一致
  'cet4/2026_06_1': {
    1: 'Why was Keith Stonehouse left with a $1,000 bill?',
    2: 'What does the news report say Keith Stonehouse is planning to do?',
    3: 'What did animal behaviour experts do according to the news report?',
    4: 'Why have some animal species likely become used to the presence of humans?',
    5: 'What is Denver doing with its popular electric bike incentive program?',
    6: 'How did the electric bike incentive program benefit residents?',
    7: 'What does the city of Denver expect to do early next year?',
    8: 'What exhibits does the man like best in the museum he visited?',
    9: 'What does the woman say about the old city centre?',
    10: 'What does the man say about the square with the Spanish steps?',
    11: 'What does the woman say she is going to do first?',
    12: 'What advice does the man want to get from the woman?',
    13: 'What does the woman say is the most important thing for the man to do at first?',
    14: 'What does the man say he is feeling a bit uneasy about?',
    15: 'What does the woman suggest the man do to gain insight about the running of the business?',
    16: 'What does research indicate about many consumers when they evaluate a purchase?',
    17: 'What do good marketers keep in mind all the time?',
    18: 'What should marketers do besides stressing the features of a product?',
    19: 'What does the passage say about Americans?',
    20: "What counted as the biggest sources for Americans' breathing in or consuming microplastics?",
    21: 'What does the passage say is still unknown?',
    22: 'What did over half of the respondents say in the survey?',
    23: 'What did most older pet owners in the survey say their pets provided?',
    24: 'What does the passage say people did report in the survey?',
    25: 'What does research show interacting with pets can do?',
  },
};

function listeningStems(setDir, analysisJson) {
  const stems = {};
  const add = (q, s) => {
    if (q >= 1 && q <= 25 && !stems[q]) {
      let c = cleanStem(s).replace(/\s*[^A-Za-z?!]+$/, ''); // 删尾部非字母残片（"North |" 的 |）
      // 非 ASCII 可打印字符占比 >8%（弯引号等除外）视为 OCR 乱码题干，拒绝
      const bad = (c.match(/[^\x20-\x7E]/g) || []).length / Math.max(1, c.length);
      // 题干主体可读即可接受（双栏 OCR 常截断问号，截断题干比占位有用）；
      // 含选项标记 / 括号乱码的题干是 OCR 混入，拒绝
      // 多位数字：允许年份(2018/2024)和年龄(25/34)等 ≤2 处，>2 处视为 OCR 噪声
      const digitGroups = (c.match(/\d{2,}/g) || []).length;
      if (c.length > 12 && bad < 0.08 && !/^\d{1,2}[A-Za-z]/.test(c)
        && !/\b[A-O]\)/.test(c) && !/\([^)]{0,8}\)/.test(c) && digitGroups <= 2) { stems[q] = c; return true; }
    }
    return false;
  };
  // 中文题干回退：解析书部分题仅有中文题干（"关于...发现了什么?"）
  // cleanStem 会删除中文，故需独立处理（不调用 add 的清洗逻辑）
  const addChn = (q, s) => {
    if (q >= 1 && q <= 25 && !stems[q]) {
      const c = s.replace(/\s+/g, ' ').trim();
      // 中文题干：以中文开头，以 ?/？ 结尾，长度 8-100
      if (/^[\u4e00-\u9fff].{5,90}[？?]\s*$/.test(c)) stems[q] = c;
    }
  };
  // 1) answer.pdf 文本层（题干后答案标记 OCR 会损坏成 C)/c>/o>，统一兼容）
  const layer = path.join(setDir, 'answer-layer.txt');
  if (fs.existsSync(layer)) {
    const l = stripFooterNoise(fs.readFileSync(layer, 'utf8'));
    const re = /\b(\d{1,2})\s*\.\s*([^]{5,200}?)\s+[A-Oa-o]\s*[\)）(（>]/g;
    let m;
    while ((m = re.exec(l)) !== null) add(Number(m[1]), m[2]);
  }
  // 2) 扫描版解析 OCR：题干为问句，在 ?! 处结束；题干问号丢失（OCR 损坏）时
  //    以下一题号截断，避免吞掉后续题干
  const ocr = path.join(setDir, 'ocr-full.txt');
  if (fs.existsSync(ocr)) {
    const t = stripFooterNoise(cleanOcrText(fs.readFileSync(ocr, 'utf8')));
    if (t.length > 15000) {
      const re = /\b(\d{1,2})\s*[\.、]\s*[.、]?\s*Q?[:：]?\s*((?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are)[^?!]{5,300}?(?:[?!]|(?=\s*\d{1,2}\s*[\.、])))/g;
      let m;
      while ((m = re.exec(t)) !== null) add(Number(m[1]), m[2]);
    }
  }
  // 3) analysis.json listening 字段：解析书每题含英文题干（开头问句，后跟中文翻译）
  //    覆盖面最广（几乎所有套题都有 analysis.json），是题干的主要来源
  //    题干可能埋在中文解析之间（"精析...答案为C)。 What happens...? 中文翻译"），
  //    故需在全文查找问句，cleanStem 会去掉问号后中文
  if (analysisJson?.analysis?.listening) {
    for (let n = 1; n <= 25; n++) {
      if (stems[n]) continue;
      const txt = analysisJson.analysis.listening[n] || '';
      if (!txt) continue;
      // 跳过听力原文（OCR 损坏、无问句格式、含大量英文断句）
      // 特征：英文占比 >70%、无中文、无问号
      const isTranscript = !/[\u4e00-\u9fff]/.test(txt) && !/[？?]/.test(txt) && txt.length > 50;
      if (isTranscript) continue;
      // 全文查找英文问句（问句词开头，到 ?! 结束，长度 15-200，不含中文 ?）
      // 兼容 OCR 损坏首字母：ow=How, hy=Why, hat=What, hen=When
      let m = txt.match(/(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here)\b[^?!]{13,198}?[?!]/i);
      if (m) { add(n, m[0]); continue; }
      // OCR 常丢失题干问号（"What did ... say" 后直接跟中文/选项），
      // 允许无问号题干：问句词开头，截断到中文、选项标记或下一题号
      const m2 = txt.match(/(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here)\b[^?!\u4e00-\u9fff]{8,140}(?=[\u4e00-\u9fff]|\s{0,2}[A-Oa-o]\s*[\)）]|\s*\d{1,2}\s*[.、]|\s*$)/i);
      if (m2) {
        const c = cleanStem(m2[0]);
        // 至少一个完整单词 + 大写开头 + 无明显断裂（末词以英文单词结尾）
        if (c.length > 15 && /^[A-Z][a-z]/.test(c) && /\b[A-Za-z]{2,}$/.test(c)) { add(n, c); continue; }
      }
      // 兜底1：取首个中文字符前的英文片段
      const engPart = txt.split(/[\u4e00-\u9fff]/)[0];
      if (engPart.length > 15 && /[?!]/.test(engPart)) { add(n, engPart); continue; }
      // 兜底2：中文题干提取（解析书部分题仅有中文翻译题干）
      // 中文题干在中文翻译行（"关于...发现了什么?"），紧跟在解析正文或选项之前
      const chnStem = txt.match(/([\u4e00-\u9fff][^\nA-Oa-o]{5,90}[？?])/);
      if (chnStem) addChn(n, chnStem[1]);
    }
  }
  // 4) 全局错位归位：双栏 OCR 中题干常整体错位（Q2 题干混入 Q1 槽、Q25 题干混入 Q1 槽等），
  //    逐题槽提取不到时，在全套 listening 文本中收集所有问句，按缺失题号顺序补齐。
  //    优先收集有问号的完整题干；问号丢失（OCR 损坏）时用无问号回退模式兜底。
  if (analysisJson?.analysis?.listening) {
    const empty = [];
    for (let n = 1; n <= 25; n++) if (!stems[n]) empty.push(n);
    if (empty.length) {
      const allText = Object.values(analysisJson.analysis.listening).join(' \n ');
      const collect = (re) => {
        const out = [];
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(allText)) !== null) {
          const q = m[0].replace(/\s+/g, ' ').replace(/^[^A-Za-z]*/, '').replace(/\s*\|[^\n]*$/, '').trim();
          // 过滤引导句残片（"Are based on the conversation..."）与听力原文提示句
          if (q.length > 12 && !/^Questions?\s+\d{1,2}/i.test(q)
            && !/are based on/i.test(q) && !/you (?:will|have) (?:hear|just heard)/i.test(q)) out.push(q);
        }
        return out;
      };
      // 有问号题干 → 无问号回退题干（问句词开头，截断到中文/选项标记/下一题号）
      const qRe = /(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here)\b[^?!\n]{8,220}?[?!]/gi;
      const m2Re = /(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here)\b[^?!\u4e00-\u9fff]{8,140}(?=[\u4e00-\u9fff]|\s{0,2}[A-Oa-o]\s*[\)）]|\s*\d{1,2}\s*[.、]|\s*$)/gi;
      const uniq = [...new Set([...collect(qRe), ...collect(m2Re)])];
      const used = new Set();
      for (const n of empty) {
        // 逐个问句尝试：add 校验失败（乱码/过短等）不标记 used，让后面的题号能复用
        for (const q of uniq) {
          if (used.has(q)) continue;
          if (add(n, q)) { used.add(q); break; }
        }
      }
    }
  }
  // 5) 手工题干表：源解析缺失的网络核验题干，覆盖优先级最高
  const rel = setDir.replace(/\\/g, '/').replace(/^.*?\/\.download\//, '');
  const manual = MANUAL_STEMS[rel];
  if (manual) {
    for (const [nStr, s] of Object.entries(manual)) {
      const n = Number(nStr);
      if (n >= 1 && n <= 25 && s.trim()) stems[n] = cleanStem(s);
    }
  }
  return stems;
}

// ---------- 文本清理 ----------
function stripDirections(text) {
  return text
    .replace(/(?:In this section|There are \d+ passages? in this section)[\s\S]*?more than once\s*\./gi, '')
    .replace(/(?:In this section|There are \d+ passages? in this section)[\s\S]*?through the centre\s*\./gi, '')
    .replace(/(?:In this section|There are \d+ passages? in this section)[\s\S]*?Answer Sheet\s*\d*[^.]*\./gi, '')
    .trim();
}
function stripAnswerSection(text) {
  let idx = text.search(/参考\s*答案|答案\s*[:：]|Answer\s*Keys?|Keys?\s*[:：]/i);
  if (idx === -1) idx = text.search(/KEYS\b/);
  return idx === -1 ? text : text.slice(0, idx).trim();
}
function localStripPrefix(block) {
  // 只剥离块首的 "Part X 标题" / "Section X" 小标题（锚定 ^ 防止误伤正文中的 part/section；
  // [\s\S] 允许跨行（扫描版标题与 Directions 分行），限长 120 避免跨到正文里的冒号；
  // 兼容 "Directions;" 分号与全角冒号/分号）
  let s = block.replace(/^\s*\bPart\s+[IVX|Jl了]{1,4}[\s\S]{0,120}?[:;：；]/i, '');
  s = s.replace(/^\s*\bSection\s+[A-F]\b[\s\S]{0,120}?[:;：；]/i, '');
  return s.replace(/^\s+/, '').trim();
}
function normalizeBankedPassage(p) {
  // 文章头部混入的其他题选项（解析书双栏串行），正文从 Directions 之后开始
  let s = p.replace(/[\s\S]*?Directions?\s*[:：]/i, '');
  // 下划线空（___26___ / "_ 28" / "_ __ 26___ 畸形变体）+ 扫描版裸数字空（26-35）
  // 注意：独立的 26-35 数字不在此转换（可能误伤正文真实数字，如 "18 and 32"、年份 2030），
  // 交由 fixBankedPassage 按空位缺口补缺时处理。
  return s
    .replace(/Questions?\s+\d{1,2}\s+(?:and|to)\s+\d{1,2}[^.\n]*\.?\s*/gi, '') // 引导句
    // LaTeX 公式空位标记（OCR/文字层把空位渲染成 $ \underline{____} $ 或 $ \underline{26} $ 数字版）
    .replace(/\$?\s*\\underline\s*\{\s*(?:_{1,}|[0-9]{1,2})\s*\}\s*\$?/g, '____')
    .replace(/_+[\s_]*(\d{1,2})[\s_]*_+/g, '____') // ___26___ / "_ __ 26___"
    .replace(/_{1,}\s*(\d{1,2})(?=\s)/g, '____') // "_ 28" 单面下划线空
    .replace(/_{1,}\S{1,5}_{1,}/g, '____') // OCR 数字损坏的 "_J'J__"
    .replace(/(?<![A-Za-z0-9])(2[6-9]|3[0-5])(?![A-Za-z0-9])_{2,}/g, '____') // 空位前题号残留 "30____"
    .replace(/_{2,}/g, '____') // 统一空位下划线
    .replace(/____[0-9OoIlL]{1,3}(?![A-Za-z])/g, '____') // 空位后粘 OCR 噪声（"____1L "、"____lL "）
    .replace(/____\s*[，,]\s*(2[6-9]|3[0-5])(?![A-Za-z0-9])/g, '____') // "____，32"
    .replace(/____\s+(2[6-9]|3[0-5])(?![A-Za-z0-9])/g, '____') // "____ 32" 空位后题号
    .replace(/_{1,}/g, '____'); // 残留下划线
}
function stripBankedOptions(p) {
  // 单行连续词库：A) word B) word C) word ...
  const re = /(?:^|[\s\n])A[\)\.]\s+[A-Za-z][A-Za-z'\-]*(?:\s+[B-O][\)\.]\s+[A-Za-z][A-Za-z'\-]*)+/;
  const m = re.exec(p);
  if (m) return p.slice(0, m.index).trim();
  // 两列/跨行词库（2021 年及部分扫描版为竖排两列，OCR 后 A) word 与 G) word 同行交错）：
  // 在 passage 中查找词库起始点——出现 A) 且其后 500 字符内另有 ≥4 个 [B-O] 选项标记
  const mm = /(?:^|[\s\n])([A-O][\)\.]\s+[A-Za-z][A-Za-z'\-]*)/g;
  let cand = null;
  let cur;
  while ((cur = mm.exec(p)) !== null) {
    if (!cur[1].startsWith('A')) continue;
    const tail = p.slice(mm.lastIndex);
    const opts = tail.match(/\b[B-O][\)\.]\s+[A-Za-z][A-Za-z'\-]*/g) || [];
    if (opts.length >= 4) { cand = mm.lastIndex - cur[0].length; break; }
  }
  if (cand !== null && cand > 0) {
    // 词库起始前应至少有一段正文，防止误切（起始位置太靠前则视为正文开头）
    if (cand > 100) return p.slice(0, cand).trim();
  }
  return p;
}
// 选词 passage 最终清理（归档合并时应用）：页脚残片、Section 标题、词库残留、空位计数校准
function fixBankedPassage(p, expected) {
  let s = p || '';
  // 1) 页脚/噪声残片（扫描版页脚、年份残片、中文页码）
  s = s
    .replace(/Im\s*\d{4}[^\n]*/g, '')
    .replace(/\d{4}[-—]?\s*\d*\s*[¥][^\n]*/g, '')
    .replace(/[9\s]\d{4}[¥][^\n]*/g, '')
    .replace(/[第\s]*\d+\s*页[^\n]*/g, '')
    .replace(/共\s*\d+\s*页[^\n]*/g, '')
    .replace(/J][^\n]*$/g, '');
  // 2) 开头 Section 标题 / Directions 引导句
  s = s.replace(/^\s*Section\s+[A-F]\b[^\n]{0,40}/i, '');
  s = s.replace(/^\s*Directions?\s*[:：]?[^\n]{0,80}/i, '');
  // 2.5) OCR 中文注释乱码（括号内无英文单词或含垃圾符号，如 "(4.t)"、"(:it it? 1t- )"、"( -iA {JI.;)"）
  //     ——保留 ____ 空位标记，故不删下划线
  s = s.replace(/[（(][^）)]*?[）)}]/g, (mm) => {
    const inner = mm.slice(1, -1);
    if (/[€¥•·§^`~{}|\\×]/.test(inner)) return '';
    return /[A-Za-z]{2,}/.test(inner) ? mm : '';
  });
  s = s.replace(/[（(]\s*[）)]/g, '');
  // 2.6) 英文正文不存在的符号（€ ¥ • · 反斜杠等；保留 ____ 与 LaTeX 标记）
  s = s.replace(/[€¥•·§^`~{}|\\×]/g, ' ');
  // 3) 词库残留（切掉末尾/行内连续选项）
  const kbRe = /(?:^|[\s\n])([A-O][\)\.]\s+[A-Za-z][A-Za-z'\-]*[\s\S]{0,60}?){4,}$/;
  s = s.replace(kbRe, '');
  const kbRe2 = /(?:^|[\s\n])(?:[A-O][\)\.]\s+[A-Za-z][A-Za-z'\-]*\s*){4,}/;
  const kbm = kbRe2.exec(s);
  if (kbm && s.slice(0, kbm.index).trim().length > 100) s = s.slice(0, kbm.index);
  // 4) 空位统一
  s = s.replace(/_{1,}/g, '____');
  // 5) 空位计数校准：多则合并相邻空位（OCR 把单空拆成 "____ ____"）
  let blanks = (s.match(/____/g) || []).length;
  while (blanks > expected) {
    const t = s.replace(/____\s+____/, '____');
    if (t === s) break;
    s = t;
    blanks = (s.match(/____/g) || []).length;
  }
  // 6) 空位不足：将独立的题号残留（26-35，非字母数字上下文，如 "almost 26."、孤立 "32"）
  //    转成空位，直到数量匹配。仅按缺口补缺，避免误伤正文真实数字。
  let guard = 0;
  while (blanks < expected && guard++ < 30) {
    const t = s.replace(/(?<![A-Za-z0-9])(2[6-9]|3[0-5])(?![A-Za-z0-9])/, '____');
    if (t === s) break;
    s = t;
    blanks = (s.match(/____/g) || []).length;
  }
  // 7) 仍不足（文字层把空位+题号整体识别成单个数字，如 "purchase 1 just made"）：
  //    将孤立的单位数字（1-9）转为空位。仅在确有缺口时执行，降低误伤。
  guard = 0;
  while (blanks < expected && guard++ < 20) {
    const t = s.replace(/(?<![A-Za-z0-9])[1-9](?![A-Za-z0-9])/, '____');
    if (t === s) break;
    s = t;
    blanks = (s.match(/____/g) || []).length;
  }
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return { text: s, blanks };
}
function extractBankedWords(block) {
  const words = [];
  // 兼容 OCR 两种词库格式：
  // 1) 空格分隔："A) adult B) associated ..."
  // 2) 粘连格式："A) adultI) emotionalB) associated"（OCR 吞掉选项间空格）
  // 词库标记为大写字母 A-O 后跟 ) 或 .；lookahead 确认是列表项（下一标记 / 段尾 / Section B 边界）
  const re = /[A-O][\)\.]\s*([a-zA-Z][a-zA-Z'\-]*)(?=\s*[A-O][\)\.]|\s*[#=]{2,}|\s*$|$)/g;
  let m;
  while ((m = re.exec(normalizeOcr(block))) !== null) {
    const w = m[1].toLowerCase();
    if (w.length > 1 && !words.includes(w)) words.push(w);
  }
  return words.slice(0, 15);
}
function bankedAnswers(answerMap) {
  const out = [];
  for (let i = 26; i <= 35; i++) {
    const a = answerMap.get(i);
    if (a) out.push(a);
  }
  return out;
}

// 编辑距离（用于 OCR 变体对齐：underneath vs uderneath）
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}
// 选词词库/答案 OCR 拼写修复：
// 1) 词库词若与某答案词近似（OCR 变体），用干净答案词替换；
// 2) 答案词若不在词库，说明词库 OCR 漏抽，将其补入词库（词库 ≤15，保证每题可判分）
function repairBankedWordsAndAnswers(words, answers) {
  const w = [...words];
  for (let i = 0; i < w.length; i++) {
    const clean = answers.find((a) => a && a !== w[i] && a.length >= 3 && lev(a, w[i]) <= 1);
    if (clean) w[i] = clean;
  }
  for (const a of answers) {
    if (a && !w.includes(a) && w.length < 15) w.push(a);
  }
  return { words: w, answers: [...answers] };
}

// 翻译题清理（OCR 中文扫描件质量差时的回退策略）：
// 1) 剥离 "Part IV Translation (30 minutes)" 标题（兼容 OCR 变体 "Part [V"）
// 2) 剥离 Directions 引导句
// 3) 过滤 OCR 中文乱码行（连续大写单词，如 "MHA ASR KHALAF"）
// 4) 折叠汉字间的 OCR 空格（"天 可 真" → "天可真"）并整理中文标点
function cleanTranslationPrompt(block) {
  let s = block
    .replace(/^\s*Part\s+[IVX|Jl了\[0-9]{1,4}[\s\S]{0,80}?Translation[^\n]*\n?/i, '')
    .replace(/Directions?\s*[:：][\s\S]*?Answer\s*Sheet\s*\d*\s*[.\n]/i, '')
    // 英文引导句（"For this part, you are allowed 30 minutes to translate a passage from Chinese into English. ..."）
    // 截到第一个中文字符前，避免英文引导句残留
    .replace(/^For this part[\s\S]*?(?=[\u4e00-\u9fff])/i, '')
    .trim();
  // LaTeX 标记清理：$ \underline{\text{太极拳}} $ → 太极拳；\underline{xx} / \text{xx} → xx
  s = s
    .replace(/\$?\s*\\underline\s*\{\s*\\text\s*\{([^}]*)\}\s*\}\s*\$?/g, '$1')
    .replace(/\$?\s*\\underline\s*\{([^}]*)\}\s*\$?/g, '$1')
    .replace(/\$?\s*\\text\s*\{([^}]*)\}\s*\$?/g, '$1')
    .replace(/[${}]/g, '')
    .replace(/\\[a-zA-Z]+\b/g, ' ');
  s = s
    .split('\n')
    .filter((l) => !/^[A-Z]{2,}(?:\s+[A-Z]{2,}){3,}/.test(l.trim()))
    .join('\n');
  return s
    .replace(/\s*([，。！？；：、""''（）])\s*/g, '$1')
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- 题目提取 ----------
function normalizeOcr(s) {
  return s.replace(/©/g, 'C').replace(/§/g, '$');
}

// 仔细阅读正文清洗：
// 1) 删除独立行页脚残片（"(51%)"、孤立年份行）
// 2) 删除行尾 OCR 杂字符（":", "|", "}", 孤立 "i"）
// 3) 单换行折叠为空格（保留段落空行 \n\n）
// 4) 修复常见 OCR 拼写（Theres→There's、you re→you're、Tt→It）
function cleanReadingPassage(t) {
  const s = t
    .replace(/^\s*\(?\s*\d{1,3}\s*%?\s*\)?\s*$/gm, '')   // 独立行 "(51%)" 等
    .replace(/^\s*20\d{2}[^\n]*$/gm, '')                 // 独立行年份页脚残片
    .split('\n')
    .map((l) => l.replace(/\s+[:\|}]\s*$/, '').replace(/\s+i\s*$/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/Theres\b/g, "There's")
    .replace(/\byou re\b/g, "you're")
    .replace(/\bTt\b/g, 'It')
    .replace(/(?<!\n)\n(?!\n)/g, ' ')                    // 单换行 → 空格，保留段落空行
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, '')  // 删除 PDF 生词旁的中文释义注释（英文阅读 passage 不应含中文）
    .replace(/\s+##\s+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
  // OCR 中文注释乱码（括号内无英文单词）与残留符号清理
  return cleanEnglishGarbage(s).trim();
}

// OCR 数字↔字母错词修复：仅处理有把握的模式（避免误伤正常数字/单词）
// 1) 通用规则：字母之间的 0 是 o（OCR 常把 o 识别成 0：am0ng→among、S0cial→Social、g0al→goal）
//    数字串（21st、2021、90）不受影响（数字不在字母之间）
// 2) 手工表：扫描核实的错词（词首 5/8→s：5ay→say、8ay→say；0fa→of a）
function fixOcrWords(s) {
  return String(s || '')
    // 问句词首字母丢失（OCR 常见）：How→ow、Why→hy、What→hat、When→hen、Which→hich、
    // Whose→hose、Where→here（仅小写开头，避免误伤正常大写单词）
    .replace(/^(ow|hy|hat|hen|hich|hose|here)\b/i, (m) => ({ ow: 'How', hy: 'Why', hat: 'What', hen: 'When', hich: 'Which', hose: 'Whose', here: 'Where' })[m.toLowerCase()] || m)
    .replace(/(?<=[A-Za-z])0(?=[A-Za-z])/g, 'o')
    .replace(/5ay\b/g, 'say')
    .replace(/8ay\b/g, 'say')
    .replace(/0fa\b/g, 'of a')
    .replace(/How\.to\b/g, 'How to')
    .trim();
}

// 题干尾部 OCR 杂字符清理（如 "go online? i" → "go online?"）
function cleanQuestionText(s) {
  return cleanEnglishGarbage(s)
    .replace(/\s+[:\|}\]]\s*$/g, '')
    .replace(/\s+i\s*$/g, '')
    .trim();
}
function extractOptions(chunk) {
  const map = {};
  // 截断选项内容：遇到文章/部分边界标记即止
  // 1) 下一篇文章标题（Passage One/Two/Three）与下一组题引导句（Questions X to Y are based on）
  // 2) 听力 Directions / Section 标题（OCR 变体 Directon/Direclon/Directin/Directn/Drecns...）
  // 3) Directions 正文特征（OCR 粘连："conversationyouwillhearfourquestions.Bottheconversationandthe..."，
  //    引导句题号丢失时以 "you will hear" / "will be spoken only once" 等特征词截断）
  // 4) 后续大块（Part I/II/III/IV Writing/Reading/Translation）——OCR 把标题粘连成
  //    "Part I ReadingComprehension"，选项 D 常吞掉整个下一部分
  // 避免选项正文吞掉下一题/下一部分，保证选项 D 内容不混入
  const truncated = chunk.replace(/\s+(?:Passage\s+(?:One|Two|Three)\b|Questions?\s*\d{1,2}\s*(?:and|to)\s*\d{1,2}\s*are based on|Directions?\b|Sections?\s*[A-F]\b|Part\s+[IVX|Jl了I]{1,4}\b|you\s+will\s+hear\b|will\s+be\s+spoken\s+only\s+once|after\s+you\s+hear\s+a\s+question\b)/gi, '\n__BOUNDARY__\n');
  const re = /([A-D])[\)\.]\s*([\s\S]*?)(?=\s*[A-D][\)\.]|\n__BOUNDARY__\n|$)/g;
  let m;
  while ((m = re.exec(truncated)) !== null) {
    const txt = cleanOption(m[2].trim().replace(/\s+/g, ' '));
    if (txt && !map[m[1]]) map[m[1]] = fixOcrWords(txt);
  }
  return ['A', 'B', 'C', 'D'].filter((k) => map[k]).map((k) => map[k]);
}
function extractQuestions(block, maxQ = 40) {
  const out = [];
  const contexts = [];
  const ctxRe = /(Questions?\s+\d{1,2}(?:\s+(?:and|to)\s+\d{1,2})?\s+are based on\s+[^.\n]{4,120})/gi;
  let cm;
  while ((cm = ctxRe.exec(block)) !== null) {
    const inner = cm[1];
    const m2 = inner.match(/(\d{1,2})(?:\s+(?:and|to)\s+(\d{1,2}))?/);
    const a = parseInt(m2[1], 10);
    const b = m2[2] ? parseInt(m2[2], 10) : a;
    contexts.push({ start: a, end: b, text: inner.trim() });
  }
  const idxs = [];
  // 题号：前不能是字母/数字/$（防 "$10." 之类），后跟大写字母/©/(/中文 才认为真题号
  const re = /(?<![A-Za-z0-9$])(\d{1,2})\s*[\.、]?\s*(?=[A-Z©(（]|[\u4e00-\u9fff])/g;
  let m;
  while ((m = re.exec(block)) !== null) idxs.push({ num: parseInt(m[1], 10), idx: m.index });
  for (let k = 0; k < idxs.length && out.length < maxQ; k++) {
    const { num, idx: start } = idxs[k];
    const end = k + 1 < idxs.length ? idxs[k + 1].idx : block.length;
    const chunk = block.slice(start, end);
    if (/^\d{1,2}\.\d/.test(chunk.trim())) continue;
    const cleanChunk = normalizeOcr(chunk)
      .replace(/Directions?\s*:[^.\n]*\./gi, '')
      .replace(/Questions?\s+\d{1,2}(?:\s+(?:and|to)\s+\d{1,2})?\s+are based on\s+[^.\n]*\./gi, '')
      .replace(/\bSection\s*[A-F]\b[^.\n]*\.?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const options = extractOptions(cleanChunk);
    if (options.length < 2 || options.length > 4) continue;
    // 选项仍含年份数字 → 页脚残片造成的假题号（选项被截断），丢弃该题
    if (options.some((o) => /20\d{2}/.test(o))) continue;
    // 过滤双栏 OCR 夹带出的残缺选项（如 ",", " and" 之类）
    if (options.some((o) => o.length < 2)) continue;
    let question = cleanChunk.split(/\s*[A-D][\)\.]/)[0].replace(/^\d{1,2}\s*[\.、]?\s*/, '').trim().slice(0, 200);
    if (!question) {
      const ctx = contexts.find((c) => num >= c.start && num <= c.end);
      question = ctx ? ctx.text : `第 ${num} 题`;
    }
    out.push({ num, question, options });
  }
  return out;
}

// ---------- 主流程：按 Part / Section 切分 ----------
// Part 编号由标题关键词判定（OCR 把 I/II/III/IV 识别成 |/JI/了 等，不能依赖罗马数字）
// 关键字跨行查找：OCR 中 "Part II" 后通常另起一行才是 "Listening Comprehension"，
// 单行 60 字符匹配会漏掉所有 Part II（导致 listening 全空）
// 限长 80 字符（跨行）：只看 Part 标题区，避免正文里 "Reading"/"Writing" 等词干扰
function detectParts(text) {
  const out = [];
  const seen = new Set();
  // 关键字窗口从 "Part" 起 80 字符内找 Writing/Listening/Reading/Translation；
  // (?!\bPart\b) 防止贪婪窗口吞掉紧随的下一组标题（如 "Part II Listening..." 吞 "Part III Reading..."）。
  // 不依赖编号字符（文字层 PDF 的编号可能是 I/Il/][/N 等 OCR 变体）
  // OCR/预览文本常把 "Listening Comprehension" 合并成 "ListeningComprehension"（无空格），
  // \b 边界在 C 前不成立，故用 (?=[^a-z]|$) 代替 \b：Reading/Listening 后必须是非小写字母。
  // 注意不能带 i 标志：i 会让 [^a-z] 也排除大写字母（"ListeningComprehension" 的 C 会被拒），
  // 故关键字显式列出大小写变体。
  const re = /\b[Pp][Aa][Rr][Tt]\b(?:(?!\bPart\b)[\s\S]){0,80}?(?:Writing|writing|Listening|listening|Reading|reading|Translation|translation)(?=[^a-z]|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let num = 0;
    // 窗口正则已保证关键字后是非小写字母（兼容 "ListeningComprehension" 合并单词），
    // 这里只需判断窗口包含哪个关键字即可（\b 边界对合并单词失效，故用 includes）
    const mk = m[0].toLowerCase();
    if (mk.includes('writing')) num = 1;
    else if (mk.includes('listening')) num = 2;
    else if (mk.includes('reading')) num = 3;
    else if (mk.includes('translation')) num = 4;
    if (num && !seen.has(num)) { seen.add(num); out.push({ num, idx: m.index }); }
  }
  // OCR 丢失 Part III 标题（如只剩 "(40 minutes)"）时，Section A/B/C 无归属：
  // 在 Part IV 前插入 Reading 归属，保证选词/仔细阅读/段落匹配仍能构建。
  // 阅读区在听力区之后，故取 Part IV 前最后一个 Section A（听力也有 Section A，不能取第一个）
  if (!seen.has(3) && seen.has(4)) {
    const iv = out.find((x) => x.num === 4);
    const before = text.slice(0, iv.idx);
    const secAs = [...before.matchAll(/\bSection\s+A\b/gi)].map((x) => x.index);
    if (secAs.length) {
      const secA = secAs[secAs.length - 1];
      seen.add(3);
      out.push({ num: 3, idx: Math.max(0, secA - 20) });
    }
  }
  return out.sort((a, b) => a.idx - b.idx);
}

async function buildBank(file, level, idPrefix, titleBase, analysisJson, setDir) {
  const raw0 = await extractPdf(file);
  const isOcrText = raw0.includes('===== PAGE'); // 扫描版 OCR 回退文本（检测后再清洗）
  // 页脚残片会伪造题号、截断选项，必须在题号识别之前统一清理（OCR 与文字层均适用）
  const raw = stripFooterNoise(isOcrText ? cleanOcrText(raw0) : raw0);
  const answerMap = collectAnswerMap(setDir, raw, analysisJson, isOcrText); // 必须在剥离答案区之前解析
  const text = stripAnswerSection(raw);
  const baseTitle = titleBase;
  const bank = { reading: [], banked: [], long: [], listening: [], translation: [], writing: [] };
  const uid = (p, n) => `${idPrefix}-${p}-${n}`;

  const partMarks = detectParts(text);
  if (partMarks.length < 2) console.warn('  警告：Part 识别不全', partMarks.map((x) => x.num).join(','));
  const stems = listeningStems(setDir, analysisJson);
  // 引导句（"Questions 1 and 2 are based on..."）不是题干，提取不到真实题干时回退为空而非引导句
  const isGuide = (s) => /^Questions?\s+\d{1,2}(?:\s+(?:and|to)\s+\d{1,2})?\s+are based on/i.test(s || '');
  // 按题号去重，保留选项更完整的那个
  const dedupeByNum = (qs) => {
    const byNum = new Map();
    for (const q of qs) {
      const prev = byNum.get(q.num);
      if (!prev) byNum.set(q.num, q);
      else if (q.options.length > prev.options.length) byNum.set(q.num, q);
    }
    return [...byNum.values()].sort((a, b) => a.num - b.num);
  };

  for (let i = 0; i < partMarks.length; i++) {
    const start = partMarks[i].idx;
    const end = i + 1 < partMarks.length ? partMarks[i + 1].idx : text.length;
    const block = text.slice(start, end);
    const num = partMarks[i].num;
    const title = `${baseTitle} · Part ${['', 'I', 'II', 'III', 'IV'][num]}`;

    if (num === 1) {
      const prompt = localStripPrefix(block).replace(/For this part[\s\S]*?(?=[\u4e00-\u9fff])/, '').trim();
      if (prompt) bank.writing.push({ id: uid('wr', 1), level, title, prompt, requirements: [], sample: analysisJson?.writing?.sample || '' });
    } else if (num === 2) {
      // 听力题号固定 1-25（过滤 Part II OCR 成 "Part 11" 之类的假题号）
      const questions = dedupeByNum(extractQuestions(block, 40).filter((q) => q.num >= 1 && q.num <= 25)).map((q) => ({ ...q, question: fixOcrWords(stems[q.num] || (isGuide(q.question) ? '' : q.question)), id: uid('lq', q.num), answer: answerMap.get(q.num) || '', analysis: analysisJson?.analysis?.listening?.[q.num] || '' }));
      bank.listening.push({ id: uid('lst', 2), level, title, type: '真题听力', transcript: stripDirections(localStripPrefix(block)), questions });
    } else if (num === 3) {
      const secMarks = [];
      const smRe = /\bSection\s*([A-F])\b/gi;
      let sm;
      while ((sm = smRe.exec(block)) !== null) secMarks.push({ letter: sm[1].toUpperCase(), idx: sm.index });
      for (let k = 0; k < secMarks.length; k++) {
        const sStart = secMarks[k].idx;
        const sEnd = k + 1 < secMarks.length ? secMarks[k + 1].idx : block.length;
        const sub = block.slice(sStart, sEnd);
        const subTitle = `${title} · Section ${secMarks[k].letter}`;
        const cleaned = localStripPrefix(sub);
        const letter = secMarks[k].letter;
        if (letter === 'A') {
          const rawPassage = stripDirections(cleaned);
          let bankedAnalysis = '';
          const bankedAnalysisList = [];
          if (analysisJson) {
            bankedAnalysisList.push(...[26, 27, 28, 29, 30, 31, 32, 33, 34, 35].map((n) => analysisJson.analysis.banked?.[n] || ''));
            bankedAnalysis = bankedAnalysisList.filter(Boolean).join('\n');
          }
          // 选词词库：优先 wordbank.json（从答案解析词性分析提取，OCR 可靠）；
          // 再用试卷 Section A OCR 词库补充（wordbank.json 常因提取不全不足 15 词），
          // 保证选词 15 选 10 完整
          let bankedWords = null;
          const wbFile = path.join(setDir, 'wordbank.json');
          if (fs.existsSync(wbFile)) {
            try {
              const w = JSON.parse(fs.readFileSync(wbFile, 'utf8'));
              if (Array.isArray(w) && w.length >= 10 && w.every((x) => typeof x === 'string' && x.length > 1)) bankedWords = w;
            } catch {}
          }
          const ocrWords = extractBankedWords(sub);
          const baseAnswers = bankedAnswers(answerMap);
          if (bankedWords) {
            // wordbank.json 不足 15 词时并入 OCR 提取词（去重、排除单字母）。
            // 优先补充非答案词（干扰词），答案词由 repairBankedWordsAndAnswers 兜底——
            // 避免先塞满答案词导致真正的干扰词（如 robust）被跳过。
            // 答案集合取构建 answerMap 与归档 answers 并集（扫描版 answerMap 常提取不全）
            if (bankedWords.length < 15) {
              const ans = new Set([...baseAnswers.filter(Boolean), ...(BANKED_ARCHIVE[idPrefix]?.answers || []).filter(Boolean)]);
              const extra = [...ocrWords].sort((a, b) => (ans.has(a) ? 1 : 0) - (ans.has(b) ? 1 : 0));
              for (const w of extra) {
                if (bankedWords.length >= 15) break;
                if (typeof w === 'string' && w.length > 1 && !/^[A-Oa-o]$/.test(w) && !bankedWords.includes(w)) bankedWords.push(w);
              }
            }
          } else {
            bankedWords = ocrWords;
          }
          const repaired = repairBankedWordsAndAnswers(bankedWords, baseAnswers);
          bank.banked.push({
            id: uid('bk', 1),
            level,
            title: subTitle,
            passage: normalizeBankedPassage(stripBankedOptions(rawPassage)),
            words: repaired.words,
            answers: repaired.answers,
            analysis: bankedAnalysis,
            analysisList: bankedAnalysisList,
          });
        } else if (letter === 'B') {
          const body = stripDirections(cleaned);
          // 段落区与题目区分离：题目从 36. 开始
          const stmtStart = body.search(/36\s*\./);
          const stmtBody = stmtStart === -1 ? '' : body.slice(stmtStart);
          const paraBody = stmtStart === -1 ? body : body.slice(0, stmtStart);
          const statements = [];
          const stmtRe = /(?:^|[\s\n])(\d{1,2})\s*[\.、]\s*([^]{15,}?)(?=\s*\d{1,2}[\.、]\s*(?:[A-Z]|[\u4e00-\u9fff])|\s*(?:Section|Passage)\b|$)/g;
          let sm2;
          while ((sm2 = stmtRe.exec(stmtBody)) !== null) {
            const n = Number(sm2[1]);
            if (n >= 36 && n <= 45) {
              statements.push({ id: uid('ls', n), num: n, text: fixOcrWords(sm2[2].replace(/\s+/g, ' ').trim().replace(/^Tt\b/, 'It')), answer: answerMap.get(n) || '', analysis: analysisJson?.analysis?.long?.[n] || '' });
            }
          }
          // 段落切分：先修正 OCR 段落标记变体（H)→HD、O)→0)、I)→行首单独 I），
          // 再丢弃说明/标题（A) 之前的内容），保证段落序号 A-O 与试卷一致
          let paraText = normalizeOcr(paraBody)
            .replace(/Each paragraph is marked with a letter\.?\s*Answer the questions by marking the corresponding letter on Answer Sheet\s*\d*\.?\s*/i, '')
            .replace(/\bHD\b/g, 'H)')                            // OCR: "H)" → "HD"
            .replace(/\b0\)/g, 'O)')                             // OCR: "O)" → "0)"
            .replace(/(^|\n)\s*I\s+(?=[A-Z])/g, '\nI) ')          // OCR: "I)" → 行首 "I "
            .trim();
          const firstMarker = paraText.search(/[A-O]\)/);
          if (firstMarker > 0) paraText = paraText.slice(firstMarker).trim();
          // 段落：保留 "A) " 字母标记（与试卷一致），折叠跨行空白，清理 OCR 尾部噪点（如 "... away from. i" 的 "i"）
          const paragraphs = paraText
            .split(/(?=[A-O]\))/)
            .map((s) => s.trim().replace(/\s+/g, ' ').replace(/\s+i(?=\s*$)/, ''))
            .filter((s) => s.length > 30);
          bank.long.push({ id: uid('lg', 1), level, title: subTitle, paragraphs, statements });
        } else {
          // Section C 仔细阅读：以 "Questions X to Y are based on..." 引导句定位文章边界
          // （OCR 常丢失 "Passage Two" 前缀，只剩 "Two"，故不能依赖 Passage 标记切分）
          const body = stripDirections(cleaned);
          const guides = [];
          const gRe = /Questions?\s+\d{1,2}(?:\s+(?:and|to)\s+\d{1,2})?\s+are based on[^.\n]*\.?/gi;
          let gm;
          while ((gm = gRe.exec(body)) !== null) guides.push({ idx: gm.index, end: gm.index + gm[0].length, text: gm[0] });
          if (guides.length >= 1) {
            for (let k = 0; k < guides.length; k++) {
              const g = guides[k];
              // 文章标题：上一引导句（或开头）到本引导句之间，取最后一个 "Passage X" / 独立 "One/Two/Three"
              const headSeg = body.slice(k === 0 ? 0 : guides[k - 1].end, g.idx);
              const tRe = /(?:Passage\s+)?(One|Two|Three)\b/gi;
              let tm, tmark = null;
              while ((tm = tRe.exec(headSeg)) !== null) tmark = tm[1];
              const title = `Passage ${tmark || ['One', 'Two', 'Three'][k] || 'One'}`;
              // 本篇题号范围：引导句首题号 到 下一篇引导句首题号
              const first = Number((g.text.match(/\d{1,2}/) || [0])[0]);
              const nextFirst = guides[k + 1] ? Number((guides[k + 1].text.match(/\d{1,2}/) || [0])[0]) : 56;
              // 文章块：本引导句结束 → 下一篇引导句开始（仅含本篇正文与题目，
              // 避免上一篇最后一道题的选项混入下一篇的标题/正文）
              const blockEnd = guides[k + 1] ? guides[k + 1].idx : body.length;
              const articleBlock = body.slice(g.end, blockEnd);
              const qs = dedupeByNum(extractQuestions(articleBlock, 20).filter((q) => q.num >= first && q.num < nextFirst)).map((q) => ({ ...q, question: fixOcrWords(cleanQuestionText(q.question)), id: uid('rq', q.num), answer: answerMap.get(q.num) || '', analysis: analysisJson?.analysis?.reading?.[q.num] || '' }));
              // 正文：引导句结束 → 本篇第一题前
              let end = blockEnd;
              if (qs.length) {
                const qi = articleBlock.search(new RegExp(`(?<![A-Za-z0-9$])${qs[0].num}\\s*[\\.、]?\\s*[A-Z]`));
                if (qi !== -1) end = g.end + qi;
              }
              const passage = cleanReadingPassage(body.slice(g.end, end));
              if (passage && qs.length) bank.reading.push({ id: uid('rd', k + 1), level, title: `${subTitle} · ${title}`, passage, questions: qs });
            }
          } else {
            // 无引导句（罕见）：整块提取并清洗；无题目时不生成空阅读项（避免占位 Section 产生空 passage）
            const questions = dedupeByNum(extractQuestions(body, 20).filter((q) => q.num >= 46 && q.num <= 55)).map((q) => ({ ...q, question: fixOcrWords(cleanQuestionText(q.question)), id: uid('rq', q.num), answer: answerMap.get(q.num) || '', analysis: analysisJson?.analysis?.reading?.[q.num] || '' }));
            if (questions.length) bank.reading.push({ id: uid('rd', 1), level, title: subTitle, passage: cleanReadingPassage(body), questions });
          }
        }
      }
    } else if (num === 4) {
      // 翻译题：优先使用人工校准原文（translation.txt），否则 OCR 提取并清理
      let prompt = TRANSLATION_FIX[idPrefix] || '';
      const trFile = path.join(setDir, 'translation.txt');
      if (!prompt && fs.existsSync(trFile)) {
        const raw = fs.readFileSync(trFile, 'utf8').trim();
        if (raw) prompt = raw;
      }
      if (!prompt) prompt = cleanTranslationPrompt(localStripPrefix(block));
      if (prompt) bank.translation.push({ id: uid('tr', 1), level, title, prompt, reference: analysisJson?.translation?.reference || '', keywords: [] });
    }
  }
  return bank;
}

// 翻译题手工核验文本：部分"文字层" PDF 的中文字体 ToUnicode 映射损坏，pdfjs 提取出乱码
// （如 2021 年 6 月三套的铁观音/普洱/龙井），以下为官方真题翻译原文（核验自备份库，勿覆盖已有正常翻译）。
const TRANSLATION_FIX = {
  'bi-cet4-2021_06_1': '铁观音(Tieguanyin)是中国最受欢迎的茶之一，原产于福建省安溪县西坪镇，如今安溪全县普遍种植，但该县不同地区生产的铁观音又各具风味。铁观音一年四季均可采摘，尤以春秋两季采摘的茶叶品质最佳。铁观音的加工非常复杂，需要专门的技术和丰富的经验。铁观音含有多种维生素，喝起来口感独特。常饮铁观音有助于预防心脏病、降低血压、增强记忆力。',
  'bi-cet4-2021_06_2': '普洱(Pu\u2019er)茶深受中国人喜爱。最好的普洱茶产自云南的西双版纳(Xishuangbanna)，那里的气候和环境为普洱茶树的生长提供了最佳条件。普洱茶颜色较深，味道与其他许多茶截然不同。普洱茶泡(brew)的时间越长越有味道。许多爱喝茶的人尤其喜欢其独特的香味和口感。普洱茶含有多种有益健康的元素，常饮普洱茶有助于保护心脏和血管，还有减肥、消除疲劳和促进消化的功效。',
  'bi-cet4-2021_06_3': '龙井(Longjing)是一种绿茶，主要产自中国东部沿海的浙江省。龙井茶独特的香味和口感为其赢得了"中国名茶"的称号，在中国深受大众的欢迎，在海外饮用的人也越来越多。龙井茶通常手工制作，其价格可能极其昂贵，也可能比较便宜，这取决于茶的生长地、采摘时间和制作工艺。龙井茶富含维生素C和其他多种有益健康的元素。经常喝龙井茶有助于减轻疲劳、延缓衰老。',
};

// ---------- 套题输入清单 ----------
function autoBankInputs() {
  const out = [];
  for (const level of ['4', '6']) {
    const base = path.join(DIR, `cet${level}`);
    if (!fs.existsSync(base)) continue;
    for (const key of fs.readdirSync(base)) {
      const dir = path.join(base, key);
      if (!fs.statSync(dir).isDirectory()) continue;
      const testPdf = path.join(dir, 'test.pdf');
      if (!fs.existsSync(testPdf)) continue;
      const y = key.slice(0, 4);
      const mm = String(Number(key.slice(5, 7))).padStart(2, '0');
      const s = key.slice(8).replace('-', '-');
      const analysisJson = fs.existsSync(path.join(dir, 'analysis.json')) ? path.join(dir, 'analysis.json') : undefined;
      out.push({
        pdf: testPdf,
        level: Number(level),
        id: `bi-cet${level}-${key.replace('-', '')}`,
        title: `CET${level} ${y}年${Number(mm)}月 第${s}套 真题`,
        label: `CET${level} · ${y}年${Number(mm)}月 · 第${s}套`,
        ...(analysisJson ? { analysisJson } : {}),
      });
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

const AUTO = process.argv.includes('--auto');
const BANK_INPUTS = AUTO ? autoBankInputs() : [
  {
    pdf: 'test.pdf',
    level: 4,
    id: 'bi-cet4-20251201',
    title: 'CET4 2025年12月 第1套 真题',
    label: 'CET4 · 2025年12月 · 第1套',
  },
];

const builtin = [];
// 已完成的套题选词数据缓存（供 BANKED_COPY 复用；套题按 id 排序，源套题先于目标处理）
const bankedCache = {};
for (const cfg of BANK_INPUTS) {
  let analysisJson = null;
  if (cfg.analysisJson) {
    const ap = path.isAbsolute(cfg.analysisJson) ? cfg.analysisJson : path.resolve('scripts', cfg.analysisJson);
    if (fs.existsSync(ap)) analysisJson = JSON.parse(fs.readFileSync(ap, 'utf8'));
    else console.warn('警告：未找到解析文件', ap);
  }
  const setDir = path.dirname(path.isAbsolute(cfg.pdf) ? cfg.pdf : path.join(DIR, cfg.pdf));
  const bank = await buildBank(cfg.pdf, cfg.level, cfg.id, cfg.title, analysisJson, setDir);
  // 选词填空归档恢复：以已核验的归档数据为准（覆盖本次 OCR 的字母/乱码结果，补充漏检套题）。
  // passage 保留本次构建结果（文字层/OCR 提取，空位标记较归档更完整）；仅 words/answers/analysis 用归档。
  const archBanked = BANKED_ARCHIVE[cfg.id];
  if (archBanked && (archBanked.answers || []).length > 0) {
    const gen = bank.banked[0];
    const genBlanks = ((gen?.passage || '').match(/_{2,}/g) || []).length;
    const archBlanks = ((archBanked.passage || '').match(/_{2,}/g) || []).length;
    const archAns = (archBanked.answers || []).length;
    // 构建结果空位更接近 10 个时保留其 passage，否则退回归档 passage
    const passage = gen && Math.abs(genBlanks - archAns) <= Math.abs(archBlanks - archAns) && genBlanks >= 2
      ? gen.passage
      : archBanked.passage;
    // 最终清理：页脚/Section/词库残留 + 空位计数校准（目标 = answers 数）
    const fixed = fixBankedPassage(passage, archAns);
    // 词库补齐：归档 words 不足 15 时，并入构建提取词（去重、排除字母/乱码），确保 15 选 10 完整
    const genWords = (gen?.words || []).filter((w) => typeof w === 'string' && w.length > 1 && !/^[A-Oa-o]$/.test(w));
    const mergedWords = [];
    for (const w of [...(archBanked.words || []), ...genWords, ...(archBanked.answers || [])]) {
      if (!mergedWords.includes(w) && typeof w === 'string' && w.length > 1 && !/^[A-Oa-o]$/.test(w)) mergedWords.push(w);
      if (mergedWords.length >= 15) break;
    }
    bank.banked = [{ ...archBanked, passage: fixed.text, words: mergedWords }];
    if (fixed.blanks !== archAns) {
      console.warn(`  选词 passage 空位数 ${fixed.blanks} ≠ 答案数 ${archAns}（${cfg.id}）`);
    }
  } else if (BANKED_COPY[cfg.id]) {
    // 归档缺失但官方说明复用其他套题选词：复制源套题整份选词数据
    const src = bankedCache[BANKED_COPY[cfg.id]];
    if (src && src[0] && src[0].answers.length) {
      const srcId = BANKED_COPY[cfg.id];
      const srcAns = src[0].answers.length;
      const srcPassage = src[0].passage;
      const fixed = fixBankedPassage(srcPassage, srcAns);
      bank.banked = [{
        ...src[0],
        id: `${cfg.id}-bk-1`,
        title: `${cfg.title} · Section A`,
        passage: fixed.text,
        analysis: '',
        analysisList: [],
      }];
      console.log(`  选词复用 ${srcId}（官方说明内容相同）`);
    } else {
      console.warn(`  警告：选词复用源 ${BANKED_COPY[cfg.id]} 无数据（${cfg.id}）`);
    }
  }
  bankedCache[cfg.id] = bank.banked;
  const meta = {
    id: cfg.id,
    level: cfg.level,
    title: cfg.title,
    label: cfg.label,
    counts: {
      writing: bank.writing.length,
      listening: bank.listening.reduce((n, s) => n + s.questions.length, 0),
      banked: bank.banked[0]?.answers.length ?? 0,
      long: bank.long[0]?.statements.length ?? 0,
      reading: bank.reading.reduce((n, p) => n + p.questions.length, 0),
      translation: bank.translation.length,
    },
  };
  builtin.push({ meta, ...bank });
  // 打印质量摘要
  const lisQ = bank.listening.reduce((n, s) => n + s.questions.length, 0);
  const lisA = bank.listening.reduce((n, s) => n + s.questions.filter((q) => q.answer).length, 0);
  const readQ = bank.reading.reduce((n, p) => n + p.questions.length, 0);
  const readA = bank.reading.reduce((n, p) => n + p.questions.filter((q) => q.answer).length, 0);
  console.log(`\n=== ${cfg.label} ===`);
  console.log(`writing: ${bank.writing.length} | listening: ${lisQ}题/${lisA}答 | banked: ${bank.banked[0]?.answers.length ?? 0}答/${bank.banked[0]?.words.length ?? 0}词`);
  console.log(`long: ${bank.long[0]?.paragraphs.length ?? 0}段/${bank.long[0]?.statements.length ?? 0}题 | reading: ${readQ}题/${readA}答 | translation: ${bank.translation.length}`);
}

const ts = `// 内置真题题库（由 scripts/fetch-cet.mjs + scripts/build-banks.mjs 生成，勿手改）
import type { ReadingPassage, BankedCloze, LongReading, ListeningSet, TranslationItem, WritingItem } from '../types';

export interface BuiltinBankMeta {
  id: string;
  level: 4 | 6;
  title: string;
  label: string;
  counts: { writing: number; listening: number; banked: number; long: number; reading: number; translation: number };
}

export interface BuiltinBank {
  meta: BuiltinBankMeta;
  reading: ReadingPassage[];
  banked: BankedCloze[];
  long: LongReading[];
  listening: ListeningSet[];
  translation: TranslationItem[];
  writing: WritingItem[];
}

export const BUILTIN_BANKS: BuiltinBank[] = ${JSON.stringify(builtin, null, 2)};
`;
fs.writeFileSync(OUT, ts, 'utf8');
console.log('\n已生成:', OUT, `(${builtin.length} 套)`);
