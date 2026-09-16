// 核查 2026 套题数据完整性
import fs from 'node:fs';
const t = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const ids = ['bi-cet4-2026_06_1', 'bi-cet4-2026_06_2', 'bi-cet4-2026_06_3', 'bi-cet6-2026_06_1', 'bi-cet6-2026_06_2', 'bi-cet6-2026_06_3'];
for (const id of ids) {
  const i = t.indexOf(`"id": "${id}"`);
  if (i === -1) { console.log(id, '未找到'); continue; }
  const seg = t.slice(i, t.indexOf('\n  },', i) + 200);
  // 各字段
  const count = (re) => { const m = seg.match(re); return m ? m.length : 0; };
  const bankedBlanks = count(/____/g);
  const bankedAnswers = (seg.match(/"answers": \[([^\]]*)\]/s) || [])[1]?.split(',').filter(s => s.trim().startsWith('"')).length ?? 0;
  const hasEmptyReading = /"passage": "Section C"[\s\S]*?"questions": \[\]/.test(seg);
  const listeningQ = (seg.match(/"num": \d+/g) || []).filter(n => Number(n.match(/\d+/)[0]) <= 25).length;
  console.log(`\n${id}`);
  console.log(`  选词空位: ${bankedBlanks} (应10) | 选词答案: ${bankedAnswers}`);
  console.log(`  空阅读项: ${hasEmptyReading}`);
  // 听力题干为"第 X 题"的数量
  const fakeStem = count(/"question": "第 \d+ 题"/g);
  console.log(`  听力占位题干(第X题): ${fakeStem}`);
}
