/**
 * 从真题卷 OCR 文本（scripts/.download/<level>/<key>/test-ocr.txt）解析出每题的 A–D 选项。
 *
 * 卷面是「双栏」排版，OCR 出来的常见三种形态：
 *   1. A) ...  C) ...        换行  B) ...  D) ...     ← 最常见
 *   2. A) ... C) ... B) ... D) ...                    ← 挤在一行
 *   3. A) ... / B) ... / C) ... / D) ...              ← 四行
 * 另外题号可能单独成行、选项可能被 ===== PAGE n ===== 打断，解析时都要容错。
 */
import fs from 'node:fs';
import path from 'node:path';

const DL = 'scripts/.download';

/** 卷面里不属于选项内容的行（小节标题、指令、篇章正文起始等） */
const STOP_LINE =
  /^\s*(?:#{1,6}\s*)?(?:Part\s+[IVX]+|Section\s+[A-C]|Directions?:|Questions?\s+\d|Reading Comprehension|Listening Comprehension|Translation|Writing|Part\s+III|Part\s+IV)/i;

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const squash = (s) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

/**
 * @returns {Map<number, {A?:string,B?:string,C?:string,D?:string}>}
 */
export function parseTestOptions(text) {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => !/^={3,}\s*PAGE\s+\d+\s*={3,}$/i.test(l.trim()))
    .map((l) => l.replace(/^#{1,6}\s*/, '').trimEnd());

  // ① 定位题号行：行首是「数字 + 点」
  const qStart = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(\d{1,2})\s*[.．、]\s*(.*)$/);
    if (m) qStart.push({ idx: i, num: Number(m[1]), rest: m[2] });
  });

  const out = new Map();
  for (let k = 0; k < qStart.length; k++) {
    const { idx, num, rest } = qStart[k];
    const end = k + 1 < qStart.length ? qStart[k + 1].idx : lines.length;

    // ② 收集题目块：题号行 + 后续行，直到下一个题号 / 小节标题
    const chunk = [rest];
    for (let i = idx + 1; i < end; i++) {
      const l = lines[i];
      if (STOP_LINE.test(l)) break;
      chunk.push(l);
    }
    const body = chunk.join('\n');

    // ③ 在块内按字母标记切分选项
    const opts = {};
    const marks = [];
    const re = /(?:^|[\s\n])([A-D])\s*[)．、]\s*/g;
    let m;
    while ((m = re.exec(body))) {
      marks.push({ letter: m[1], from: m.index + m[0].length, start: m.index });
    }
    for (let i = 0; i < marks.length; i++) {
      const seg = body.slice(marks[i].from, i + 1 < marks.length ? marks[i + 1].start : body.length);
      const val = squash(seg.replace(/[ \t]*\n[ \t]*/g, ' '));
      // 去掉行尾残留的题号/页脚噪声
      const clean = val
        .replace(/\s*\[?第\s*\d+\s*页\]?\s*$/, '')
        .replace(/\s*\d*\s*[四六]级\s*\d{4}\s*[.\-·年]\s*\d{1,2}.*$/, '')
        .trim();
      if (clean) opts[marks[i].letter] = clean;
    }
    if (Object.keys(opts).length) out.set(num, opts);
  }
  return out;
}

/** 解析选词填空词库（A–O），卷面是一行挤满：`A) adjustI) participatedB) alter...` */
export function parseWordBank(text) {
  const bank = {};
  // 只取「词库」那一段：Section A 之后、Section B 之前
  const start = text.search(/Reading Comprehension/i);
  if (start === -1) return bank;
  const seg = text.slice(start, start + 200000);
  const end = seg.search(/##\s*Section\s*B/i);
  const scope = (end === -1 ? seg.slice(0, 40000) : seg.slice(0, end))
    // 卷面词库挤成一行：`A) adjustI) participatedB) alterJ) patterns...`
    // 下一个字母标记直接粘在单词尾部，先把它们切开
    .replace(/([a-z])([A-O])\s*\)/g, '$1 $2)');
  const re = /([A-O])\s*[)．、]\s*/g;
  let m;
  const marks = [];
  while ((m = re.exec(scope))) marks.push({ letter: m[1], from: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const w = scope.slice(marks[i].from, i + 1 < marks.length ? marks[i + 1].from - 2 : marks[i].from + 30);
    const word = (w.match(/^([A-Za-z][A-Za-z'-]*)/) || [])[1];
    // 词库单词都是小写且不超过 24 字符
    if (word && word.length <= 24 && /^[a-z]/.test(word)) bank[marks[i].letter] = word;
  }
  return bank;
}

export function loadTestOcr(level, key) {
  const p = path.join(DL, level === 4 ? 'cet4' : 'cet6', key, 'test-ocr.txt');
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  return { text, options: parseTestOptions(text), wordBank: parseWordBank(text) };
}

/* ---------------- CLI 自检 ---------------- */
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/lib-parse-testocr.mjs')) {
  const [level, key] = [process.argv[2], process.argv[3]];
  const r = loadTestOcr(Number(level), key);
  if (!r) {
    console.log('无 test-ocr.txt');
    process.exit(0);
  }
  console.log(`题号 ${r.options.size} 个，词库 ${Object.keys(r.wordBank).length} 项`);
  for (const n of [1, 3, 16, 22, 46, 47]) {
    if (r.options.has(n)) console.log(`  ${n}:`, JSON.stringify(r.options.get(n)));
  }
  console.log('词库:', JSON.stringify(r.wordBank));
}
