// 测试 stripBankedOptions 对 book118 两栏词库的处理（取阅读区 Section A）
import fs from 'node:fs';
const t = fs.readFileSync('scripts/.download/cet4/2026_06_1/test-ocr.txt', 'utf8');
// 阅读区 Section A = "Part Ⅲ ReadingComprehension" 之后的第一个 "Section A"
const part3 = t.indexOf('ReadingComprehension');
const sa = Math.max(t.indexOf('Section A', part3), t.indexOf('SectionA', part3));
const sb = Math.max(t.indexOf('Section B', sa), t.indexOf('SectionB', sa));
const block = t.slice(sa, sb || t.length);
console.log('=== 阅读 Section A 末尾 500 字符 ===');
console.log(block.slice(-500));

function stripBankedOptions(p) {
  const re = /(?:^|[\s\n])A[\)\.]\s+[A-Za-z][A-Za-z'\-]*(?:\s+[B-O][\)\.]\s+[A-Za-z][A-Za-z'\-]*)+/;
  const m = re.exec(p);
  if (m) { console.log('模式1命中，index=', m.index); return p.slice(0, m.index).trim(); }
  const mm = /(?:^|[\s\n])([A-O][\)\.]\s+[A-Za-z][A-Za-z'\-]*)/g;
  let cnt = 0;
  let cur;
  while ((cur = mm.exec(p)) !== null && cnt < 8) {
    cnt++;
    console.log('mm匹配:', JSON.stringify(cur[0]), 'group1=', JSON.stringify(cur[1]), 'index=', cur.index, 'lastIndex=', mm.lastIndex);
  }
  mm.lastIndex = 0;
  let cand = null;
  while ((cur = mm.exec(p)) !== null) {
    if (!cur[1].startsWith('A')) continue;
    const tail = p.slice(mm.lastIndex);
    const opts = tail.match(/\b[B-O][\)\.]\s+[A-Za-z][A-Za-z'\-]*/g) || [];
    console.log('A标记于', mm.lastIndex - cur[0].length, '尾随B-O选项数:', opts.length, '样例:', opts.slice(0, 3).join(','));
    if (opts.length >= 4) { cand = mm.lastIndex - cur[0].length; break; }
  }
  if (cand !== null && cand > 100) return p.slice(0, cand).trim();
  return p;
}
const out = stripBankedOptions(block);
console.log('\n=== stripBankedOptions 后末尾 400 字符 ===');
console.log(out.slice(-400));
