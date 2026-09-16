// 找出每套题缺失答案的具体题号，输出可抓取清单
import fs from 'node:fs';
const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const startIdx = src.indexOf('BUILTIN_BANKS');
const arrStart = src.indexOf('[', startIdx);
const arrEnd = src.lastIndexOf('];');
const banks = eval(src.slice(arrStart, arrEnd + 1));

for (const b of banks) {
  const id = b.meta.id;
  const missing = [];

  // 听力缺失答案
  const lst = b.listening[0];
  if (lst) {
    for (const q of (lst.questions || [])) {
      if (!q.answer) missing.push(`听${q.num}`);
    }
  }

  // 选词填空缺失答案
  const bk = b.banked[0];
  if (bk) {
    const ans = bk.answers || [];
    for (let i = 0; i < ans.length; i++) {
      if (!ans[i]) missing.push(`选词${i + 1}`);
    }
  }

  // 仔细阅读缺失答案
  for (const r of (b.reading || [])) {
    for (const q of (r.questions || [])) {
      if (!q.answer) missing.push(`阅读${q.num}`);
    }
  }

  if (missing.length) {
    console.log(`${id}: ${missing.join(' ')}`);
  }
}
