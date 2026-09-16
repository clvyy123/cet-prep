// 从答案解析 txt 的词性分析提取选词词库（A-O 顺序 15 词）→ wordbank.json
// 用法：node scripts/extract-wordbank.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'scripts/.download';
const ANS_SRC = 'C:\\Users\\yy\\Desktop\\四级\\答案解析';
const levelName = { 4: '四级', 6: '六级' };

function findAnsTxt(level, key) {
  const y = key.slice(0, 4);
  const mm = String(Number(key.slice(5, 7)));
  let s = key.slice(8);
  const base = path.join(ANS_SRC, levelName[level]);
  if (!fs.existsSync(base)) return null;
  for (const f of fs.readdirSync(base)) {
    if (f.includes(`${y}年${mm}月 第${s}套`) && f.endsWith('.txt')) return path.join(base, f);
  }
  return null;
}

// 从词性分析区提取 letter→word（同一字母取首次出现）
function extractBank(text) {
  const bank = {};
  // 词性分析区：找 "词性分析" 或 名词/动词/形容词 行，到 答案详解 前
  let region = text;
  const i = text.search(/词性分析|名\s*词\s*[:：]|动\s*词\s*[:：]/);
  if (i !== -1) {
    const j = text.indexOf('答案详解', i);
    region = text.slice(i, j === -1 ? i + 2000 : j);
  }
  const re = /([A-Oa-o0-9])\s*[\)）]\s*([a-zA-Z][a-zA-Z'\-]*)/g;
  let m;
  while ((m = re.exec(region)) !== null) {
    const u = m[1].toUpperCase();
    const l = u === '0' ? 'O' : u;
    if (!/^[A-O]$/.test(l)) continue;
    if (!bank[l]) bank[l] = m[2].toLowerCase();
  }
  // 按 A-O 顺序输出
  return 'ABCDEFGHIJKLMNO'.split('').map((l) => bank[l]).filter(Boolean);
}

let done = 0, skipped = 0;
for (const level of ['4', '6']) {
  const base = path.join(DIR, `cet${level}`);
  if (!fs.existsSync(base)) continue;
  for (const key of fs.readdirSync(base).sort()) {
    const dir = path.join(base, key);
    if (!fs.statSync(dir).isDirectory()) continue;
    const out = path.join(dir, 'wordbank.json');
    const ansTxt = findAnsTxt(level, key);
    if (!ansTxt) { console.log(`无解析txt: cet${level}/${key}`); skipped++; continue; }
    const words = extractBank(fs.readFileSync(ansTxt, 'utf8'));
    if (words.length >= 10) {
      fs.writeFileSync(out, JSON.stringify(words, null, 2), 'utf8');
      console.log(`cet${level}/${key}: ${words.length} 词`);
      done++;
    } else {
      if (fs.existsSync(out)) fs.unlinkSync(out);
      console.log(`词库不足(删): cet${level}/${key} ${words.length}`);
      skipped++;
    }
  }
}
console.log(`完成 ${done} 套（跳过 ${skipped} 套）`);
