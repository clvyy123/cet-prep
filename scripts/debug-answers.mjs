// 调试：打印答案详解块 + 每题归位后的文本，用于改进提取规则
import fs from 'node:fs';
const txt = process.argv[2];
const all = fs.readFileSync(txt, 'utf8').replace(/^\uFEFF/, '');

const Q_HEAD = /^(\d{1,2})[.、。]?\s*(?=[A-Z©(（\[【]|[\u4e00-\u9fff]|$)/;
const RIGHT_Q = /(\d{1,2})[.、。]?\s*[(（\[【]\s*(?:定位|考点|精析|语义|语法|结构|避错)/;

const ansBlocks = [];
{
  const re = /答案详解/g;
  let m;
  while ((m = re.exec(all)) !== null) {
    const start = m.index + 4;
    const nextAns = all.indexOf('答案详解', start);
    const nextRef = all.indexOf('参考译文', start);
    const nextSecB = all.indexOf('Section B', start);
    const nextPass = all.indexOf('Passage', start);
    const nextPart = all.search(/Part\s*[IVX|Jl了\[0-9N]+\s*(?:Reading|Translation|Comprehension)/i);
    const cands = [nextAns, nextRef, nextSecB, nextPass, nextPart].filter((x) => x !== -1 && x > start);
    const end = cands.length ? Math.min(...cands) : all.length;
    ansBlocks.push(all.slice(start, end));
  }
}

const target = Number(process.argv[3] || 0);
for (const [bi, block] of ansBlocks.entries()) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  // 统计块内题号
  const nums = [];
  for (const line of lines) {
    const m1 = line.match(Q_HEAD);
    if (m1) nums.push(Number(m1[1]));
    const r = line.match(RIGHT_Q);
    if (r) nums.push(Number(r[1]));
  }
  const minN = nums.length ? Math.min(...nums) : 0;
  const owner = minN >= 46 ? 'reading' : minN >= 36 ? 'long' : minN >= 26 ? 'banked' : minN >= 1 ? 'listening' : null;
  if (!owner) continue;
  console.log(`===== 块${bi} owner=${owner} 题号=[${nums.join(',')}] =====`);
  if (target && !nums.includes(target)) continue;
  for (const line of lines) {
    console.log('  |', line);
  }
}
