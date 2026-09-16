// 清理听力数据中残留的"题号前行提示"：
// 1) "Part X Listening Comprehension (25 minutes)" 板块标题
// 2) "Section A/B/C" 小节标签（含独立成列的残片）
// 3) "Directions:" / "Directions;" 引导标签
// 4) 题组引导句 "Questions 1 and 2 are based on the ... you have just heard."
// 5) 选项尾部粘连的上述引导句 / "Directions; In this section..." 完整引导块
// 仅对听力相关字符串生效（引导句/引导块模式为听力特有，不会误伤写作/阅读正文）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'data', 'builtin-banks.ts');
const text = fs.readFileSync(file, 'utf8');

const PART_HEADER_RE = /Part\s+.{0,3}?\s*Listening\s+Comprehension\s*(?:\(?\s*\d{1,2}\s*minutes?\s*\)?)?/gi;
const SECTION_LABEL_RE = /\bSection\s+[A-F]\b/gi;
const DIRECTIONS_LABEL_RE = /Directions?[\s]*[:;：；][\s]*/gi;
const GUIDE_RE = /Questions?\s+\d{1,2}(?:\s+(?:and|to)\s+\d{1,2})?\s+are based on\s+[^."\n]{0,80}?just heard\s*[.,]?\s*/gi;
const DIRECTIONS_BLOCK_RE = /Directions?[\s]*[:;：；]\s*(?:In this section|There are\s+\d+\s+passages? in this section)[^"]*$/gi;
// 完整 Directions 引导块（含 OCR 变体 "/n this section"、以 "marked" 结尾等）
const DIRECTIONS_TEXT_RE =
  /(?:In\s+this\s+section|[/\\|1l]\s*n\s+this\s+section|There\s+are\s+\d+\s+passages?\s+in\s+this\s+section)[\s\S]*?(?:more\s+than\s+once|played\s+only\s+once|spoken\s+only\s+once)\s*\.?\s*(?:After\s+you\s+hear\s+a\s+question[\s\S]*?marked\s*)?/gi;
// 选项尾部粘连的 Directions 后半段（"Both the conversation...once. After you hear a question...marked"）
const OPT_TAIL_RE =
  /(?:\bBoth\s+the\s+(?:conversation|passage|recording|news\s+report)\s+and\s+the\s+questions?[\s\S]*|At\s+the\s+end\s+of\s+each\s+(?:conversation|passage|recording)[\s\S]*|After\s+you\s+hear\s+(?:a\s+)?question[\s\S]*)$/gi;
// "Then mark the corresponding letter ... Answer Sheet ... through the centre." 引导残句（OCR 幸存）
const MARK_LETTER_RE =
  /(?:A\)\s*,?\s*B\)\s*,?\s*C\)\s*,?\s*and\s*D\)\s*\.?\s*)?Then\s+mark\s+the\s+corresponding\s+letter[\s\S]*?through\s+the\s+centre\s*\.?/gi;

const lines = text.split('\n');
let tChanged = 0;
let oChanged = 0;

const out = lines.map((line) => {
  // 听力原文行（transcript 仅在听力数据中出现）
  const tm = line.match(/^(\s*"transcript":\s*")(.*)("[,]?\s*)$/);
  if (tm) {
    // 先把转义换行 \n 换成占位符，避免其后紧跟的 Section/Questions 因 "n" 是单词字符而无法匹配 \b 边界
    const work = tm[2].replace(/(?:\\r)?\\n/g, '\u0001');
    const v = work
      .replace(PART_HEADER_RE, ' ')
      .replace(SECTION_LABEL_RE, ' ')
      .replace(DIRECTIONS_LABEL_RE, ' ')
      .replace(DIRECTIONS_TEXT_RE, ' ')
      .replace(MARK_LETTER_RE, ' ')
      .replace(GUIDE_RE, ' ')
      .replace(/\u0001\s*\d{1,2}\s*(?=\u0001)/g, '\u0001') // Directions 标签后粘连的孤立数字残片
      .replace(/\u0001\s+\u0001/g, '\u0001') // 折叠空行
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim()
      .replace(/^\u0001+|\u0001+$/g, '')
      .replace(/\u0001/g, '\\n');
    if (v !== tm[2]) {
      tChanged++;
      return tm[1] + v + tm[3];
    }
    return line;
  }

  // 其余带引号字符串行：仅清理听力特有的引导句 / 引导块粘连
  const om = line.match(/^(\s*")(.*)("[,]?\s*)$/);
  if (om) {
    const v = om[2].replace(GUIDE_RE, ' ').replace(DIRECTIONS_BLOCK_RE, '').replace(OPT_TAIL_RE, '');
    if (v !== om[2]) {
      const clean = v.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
      oChanged++;
      return om[1] + clean + om[3];
    }
    return line;
  }

  return line;
});

fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log(`听力原文行改动: ${tChanged}`);
console.log(`选项等字符串行改动: ${oChanged}`);
