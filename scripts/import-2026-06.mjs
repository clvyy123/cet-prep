// 导入 2026年6月 CET 真题：从 hqwx 合并 PDF + book118 预览文本构建题库
// 用法：node scripts/import-2026-06.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const DIR = path.resolve('scripts/.download');
const PDFJS_OPTS = {
  wasmUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/wasm')).href + '/',
  cMapUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/cmaps')).href + '/',
  cMapPacked: true,
  standardFontDataUrl: pathToFileURL(path.resolve('node_modules/pdfjs-dist/standard_fonts')).href + '/',
};

// book118 预览文本文件（实际试卷格式，含题目+选项）
const BOOK118 = {
  'cet4/2026_06_1': 'C:\\Users\\yy\\AppData\\Local\\Temp\\trae\\toolcall-output\\58af757c-5f1e-46cc-a726-d5e8620f4c26.txt',
  'cet4/2026_06_2': 'C:\\Users\\yy\\AppData\\Local\\Temp\\trae\\toolcall-output\\be429f85-30de-451f-9ded-fccca784e5fc.txt',
  'cet6/2026_06_2': 'C:\\Users\\yy\\AppData\\Local\\Temp\\trae\\toolcall-output\\9c452e5c-dd1c-481a-be76-6101dc646135.txt',
  'cet6/2026_06_3': 'C:\\Users\\yy\\AppData\\Local\\Temp\\trae\\toolcall-output\\f1238315-b874-460f-a1ef-1aa3b4806bf3.txt',
};

// 提取 PDF 全文
async function extractPdfText(file) {
  const buf = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data: buf, ...PDFJS_OPTS }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push((tc.items || []).map((it) => it.str || '').join(' '));
  }
  try { await doc.destroy(); } catch {}
  return pages;
}

// 从 hqwx PDF 文本解析各套答案
// 答案格式："1、 C) His son had ordered food..." 或 "26-30 NAIKF" 或 "26. N) squeezed"
function parseAnswers(allText, level) {
  const fullText = allText.join('\n');
  const sets = { 1: {}, 2: {}, 3: {} };

  // 答案速查格式："26-30 NAIKF" / "36-40 FLAHO" / "46-50 BDCCD" / "51-55 ABCDA"
  // 出现在阅读答案区，按套分组
  // 听力答案格式："1、 C) option text" / "1. B How to make progress..."

  // 按套切分文本（根据 "第X套" 标记和 "阅读第X套参考答案"）
  // CET4 结构：P1-3 听力答案(所有套), P10-12 阅读1, P13-15 阅读2, P16-18 阅读3
  // CET6 结构：P1-3 听力答案, P17-19 阅读1, P20-23 阅读2, P24-28 阅读3

  // 1) 听力答案：从全文中提取所有 "N、 X)" 或 "N. X" 格式
  // hqwx 格式：CET4 用 "1、 C)" CET6 用 "1. B"
  const lisRe = /(\d{1,2})\s*[、.．]\s*([A-Oa-o])\s*[\)）]?/g;
  let m;
  const allAns = [];
  while ((m = lisRe.exec(fullText)) !== null) {
    const n = parseInt(m[1], 10);
    const a = m[2].toUpperCase();
    if (n >= 1 && n <= 55) allAns.push({ n, a, idx: m.index });
  }

  // 2) 答案速查："26-30 NAIKF" 格式
  const rangeRe = /(\d{1,2})\s*[-—~]\s*(\d{1,2})\s+([A-Oa-o]{2,})/g;
  const ranges = [];
  while ((m = rangeRe.exec(fullText)) !== null) {
    const s = parseInt(m[1], 10);
    const e = parseInt(m[2], 10);
    const letters = m[3].toUpperCase();
    ranges.push({ s, e, letters, idx: m.index });
  }

  // 3) 单题答案："26. N) squeezed" 格式
  const singleRe = /(\d{1,2})\s*\.\s*([A-Oa-o])\s*[\)）]/g;
  const singles = [];
  while ((m = singleRe.exec(fullText)) !== null) {
    const n = parseInt(m[1], 10);
    const a = m[2].toUpperCase();
    if (n >= 26 && n <= 55) singles.push({ n, a, idx: m.index });
  }

  // 按套分配答案：使用 "阅读第X套参考答案" / "阅读第X套" 标记定位
  // CET4: P10 "阅读第一套参考答案", P13 "阅读第二套", P16 "阅读第三套"
  // CET6: P17 长篇阅读(1), P20 "阅读第二套", P24 "阅读第三套"
  const setMarkers = [];
  const setRe = /阅读第([一二三四123])套|听力第([一二三四123])套/g;
  while ((m = setRe.exec(fullText)) !== null) {
    const setNum = m[1] ? ({ '一': 1, '二': 2, '三': 3, '1': 1, '2': 2, '3': 3 })[m[1]] || 0
                       : ({ '一': 1, '二': 2, '三': 3, '1': 1, '2': 2, '3': 3 })[m[2]] || 0;
    if (setNum > 0) setMarkers.push({ set: setNum, idx: m.index, type: m[1] ? 'reading' : 'listening' });
  }

  // 听力答案分配：CET4 P1 "听力第一套参考答案" CET6 P1 "听力第一套完整答案"
  // 各套听力答案按出现顺序分配
  const lisMarkers = setMarkers.filter((s) => s.type === 'listening').sort((a, b) => a.idx - b.idx);
  if (lisMarkers.length >= 3) {
    for (let si = 0; si < lisMarkers.length; si++) {
      const start = lisMarkers[si].idx;
      const end = si + 1 < lisMarkers.length ? lisMarkers[si + 1].idx : fullText.length;
      const setNum = lisMarkers[si].set;
      const seg = fullText.slice(start, end);
      // 提取该段内的所有听力答案（题号1-25）
      const re = /(\d{1,2})\s*[、.．]\s*([A-Da-d])\s*[\)）]?/g;
      let mm;
      while ((mm = re.exec(seg)) !== null) {
        const n = parseInt(mm[1], 10);
        if (n >= 1 && n <= 25) {
          sets[setNum][n] = mm[2].toUpperCase();
        }
      }
    }
  } else {
    // 回退：听力答案按顺序分配给3套（各套听力题号1-25）
    // 第一套的答案先出现，然后第二套，然后第三套
    // 按 "16、" 或 "18." 这样的题号重置来判断新套开始
    let curSet = 1;
    let lastN = 0;
    for (const { n, a } of allAns.filter((x) => x.n <= 25)) {
      if (n <= 3 && lastN > 20) curSet = Math.min(curSet + 1, 3);
      if (curSet <= 3 && !sets[curSet][n]) sets[curSet][n] = a;
      lastN = n;
    }
  }

  // 阅读答案分配：使用 "阅读第X套" 标记
  const rdMarkers = setMarkers.filter((s) => s.type === 'reading').sort((a, b) => a.idx - b.idx);
  for (let si = 0; si < rdMarkers.length; si++) {
    const start = rdMarkers[si].idx;
    const end = si + 1 < rdMarkers.length ? rdMarkers[si + 1].idx : fullText.length;
    const setNum = rdMarkers[si].set;
    const seg = fullText.slice(start, end);

    // 答案速查："26-30 NAIKF"
    const rngRe = /(\d{1,2})\s*[-—~]\s*(\d{1,2})\s+([A-Oa-o]{2,})/g;
    let mm;
    while ((mm = rngRe.exec(seg)) !== null) {
      const s = parseInt(mm[1], 10);
      const e = parseInt(mm[2], 10);
      const letters = mm[3].toUpperCase();
      for (let i = 0; i < letters.length && s + i <= e; i++) {
        if (s + i >= 26 && s + i <= 55) sets[setNum][s + i] = letters[i];
      }
    }
    // 单题："26. N) squeezed"
    const sglRe = /(\d{1,2})\s*\.\s*([A-Oa-o])\s*[\)）]/g;
    while ((mm = sglRe.exec(seg)) !== null) {
      const n = parseInt(mm[1], 10);
      if (n >= 26 && n <= 55 && !sets[setNum][n]) sets[setNum][n] = mm[2].toUpperCase();
    }
    // 选词答案单词（26-35）："26. N) squeezed" 中的 squeezed
    const wordRe = /(\d{1,2})\s*\.\s*[A-Oa-o]\s*[\)）]\s*([a-zA-Z][a-zA-Z'\-]*)/g;
    while ((mm = wordRe.exec(seg)) !== null) {
      const n = parseInt(mm[1], 10);
      if (n >= 26 && n <= 35) sets[setNum][`word_${n}`] = mm[2].toLowerCase();
    }
  }

  return sets;
}

// 提取写作题目和翻译原文
function parseWritingAndTranslation(allText, level) {
  const fullText = allText.join('\n');
  const result = { 1: { writing: '', translation: '' }, 2: { writing: '', translation: '' }, 3: { writing: '', translation: '' } };

  // 写作部分：P21-23 (CET4), P16 (CET6)
  // 写作第一套/第二套/第三套
  const writeStart = fullText.search(/写作部分/);
  if (writeStart !== -1) {
    const writeSeg = fullText.slice(writeStart);
    const wsRe = /写作第([一二三四123])套/g;
    const wsMarks = [];
    let m;
    while ((m = wsRe.exec(writeSeg)) !== null) {
      const sn = ({ '一': 1, '二': 2, '三': 3, '1': 1, '2': 2, '3': 3 })[m[1]] || 0;
      wsMarks.push({ set: sn, idx: m.index });
    }
    for (let i = 0; i < wsMarks.length; i++) {
      const start = wsMarks[i].idx;
      const end = i + 1 < wsMarks.length ? wsMarks[i + 1].idx : writeSeg.length;
      const seg = writeSeg.slice(start, end);
      // 提取写作题目（Directions 或作文题目）
      const promptMatch = seg.match(/(?:作文\s*\d+\s*[：:])?([^\n]{20,})/);
      if (promptMatch) result[wsMarks[i].set].writing = promptMatch[1].trim();
    }
  }

  // 翻译部分：P19-20 (CET4), P12-15 (CET6)
  const transStart = fullText.search(/翻译部分/);
  if (transStart !== -1) {
    const transSeg = fullText.slice(transStart);
    // 翻译题按标题分割："翻译一" / "翻译二" / "翻译三" 或直接按 Chinese text 分割
    // CET4 P19: "一日为师，终身为父" (set 1), P20: second translation
    // CET6: "远程医疗" (set 1), "电子商务" (set 2), "无人机" (set 3), "传统文化" (set 2/3 shared)
    const transParts = transSeg.split(/翻译第?[一二三123]套|第[一二三123]篇翻译/).filter((s) => s.trim());
    // 简单分配：按顺序
    // 更好的方法：找中文段落
    const cnTexts = [];
    const cnRe = /([\u4e00-\u9fff][\u4e00-\u9fff\u3000-\u303f\uff00-\uffef，。！？；：、""''（）\s]{30,})/g;
    let tm;
    while ((tm = cnRe.exec(transSeg)) !== null) {
      const t = tm[1].trim();
      if (t.length > 30 && !t.includes('扫描二维码')) cnTexts.push(t);
    }
    // 分配翻译文本到各套
    for (let i = 0; i < Math.min(3, cnTexts.length); i++) {
      result[i + 1].translation = cnTexts[i].slice(0, 500);
    }
  }

  return result;
}

// 清理 book118 预览文本（去掉页眉页脚）
function cleanBook118(text) {
  return text
    .replace(/^# .+$/gm, '')
    .replace(/^vip 文档名称:.+$/gm, '')
    .replace(/^格式:.+$/gm, '')
    .replace(/^发布时间:.+$/gm, '')
    .replace(/^下载源文档需要:.+$/gm, '')
    .replace(/^阅读:.+$/gm, '')
    .replace(/^能力描述：.+$/gm, '')
    .replace(/^领域认证：.+$/gm, '')
    .replace(/^VIP免费下载$/gm, '')
    .replace(/^\s*$/gm, '')
    .trim();
}

// 主流程
async function main() {
  console.log('=== 导入 2026年6月 CET 真题 ===\n');

  for (const [levelName, levelNum, combinedPdf] of [
    ['cet4', 4, 'cet4_2026_06_combined.pdf'],
    ['cet6', 6, 'cet6_2026_06_combined.pdf'],
  ]) {
    console.log(`\n--- 处理 ${levelName.toUpperCase()} ---`);
    const pdfPath = path.join(DIR, combinedPdf);
    if (!fs.existsSync(pdfPath)) { console.warn('PDF 不存在:', pdfPath); continue; }

    console.log('提取 PDF 文本...');
    const pages = await extractPdfText(pdfPath);
    console.log(`  共 ${pages.length} 页`);

    // 解析答案
    console.log('解析答案...');
    const answers = parseAnswers(pages, levelNum);
    for (const s of [1, 2, 3]) {
      const ans = answers[s];
      const count = Object.keys(ans).filter((k) => !k.startsWith('word_')).length;
      console.log(`  第${s}套: ${count} 题答案`);
    }

    // 解析写作和翻译
    const wt = parseWritingAndTranslation(pages, levelNum);

    // 为每套题创建目录
    for (const setNum of [1, 2, 3]) {
      const setDir = path.join(DIR, levelName, `2026_06_${setNum}`);
      fs.mkdirSync(setDir, { recursive: true });

      // 复制合并 PDF 作为 test.pdf（占位，build-banks 会优先用 test-ocr.txt）
      fs.copyFileSync(pdfPath, path.join(setDir, 'test.pdf'));

      // 创建 answers.json
      const ansJson = {};
      for (const [k, v] of Object.entries(answers[setNum])) {
        if (!k.startsWith('word_')) ansJson[k] = v;
      }
      fs.writeFileSync(path.join(setDir, 'answers.json'), JSON.stringify(ansJson, null, 2));
      console.log(`  第${setNum}套 answers.json: ${Object.keys(ansJson).length} 题`);

      // 创建 test-ocr.txt
      const book118Key = `${levelName}/2026_06_${setNum}`;
      const book118Path = BOOK118[book118Key];
      let testText = '';

      if (book118Path && fs.existsSync(book118Path)) {
        // 使用 book118 预览文本（实际试卷格式）
        console.log(`  第${setNum}套: 使用 book118 预览文本`);
        testText = cleanBook118(fs.readFileSync(book118Path, 'utf8'));
      } else {
        // 从 hqwx PDF 构建最小试卷文本
        console.log(`  第${setNum}套: 从 hqwx PDF 构建试卷文本`);
        const fullText = pages.join('\n');
        testText = `2026年6月大学英语${levelNum === 4 ? '四级' : '六级'}考试真题(第${setNum}套)\n\n`;

        // 写作
        if (wt[setNum].writing) {
          testText += `Part I Writing (30 minutes)\nDirections: ${wt[setNum].writing}\n\n`;
        }

        // 听力（从 transcript 提取题干）
        testText += `Part II Listening Comprehension\n`;
        const lisAns = answers[setNum];
        for (let n = 1; n <= 25; n++) {
          if (lisAns[n]) {
            testText += `${n}. A) option A B) option B C) option C D) option D\n`;
          }
        }
        testText += '\n';

        // 阅读
        testText += `Part III Reading Comprehension\n`;
        // 答案区（让 build-banks 的 parseAnswerMap 能提取）
        testText += `\nKEYS\n`;
        for (let n = 1; n <= 55; n++) {
          if (lisAns[n]) testText += `${n}. ${lisAns[n]}\n`;
        }
        testText += '\n';

        // 翻译
        if (wt[setNum].translation) {
          testText += `Part IV Translation (30 minutes)\nDirections: For this part, you are allowed 30 minutes to translate a passage from Chinese into English.\n${wt[setNum].translation}\n`;
        }
      }

      fs.writeFileSync(path.join(setDir, 'test-ocr.txt'), testText);
      console.log(`  第${setNum}套 test-ocr.txt: ${testText.length} 字符`);
    }
  }

  console.log('\n=== 导入完成，请运行: node scripts/build-banks.mjs --auto ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
