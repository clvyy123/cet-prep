// 全面审计 builtin-banks.ts：每套题的结构完整性与内容质量
import fs from 'node:fs';
const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
// 稳健提取：定位 "BUILTIN_BANKS... = [" 到末尾 "];" 的数组文本
const startIdx = src.indexOf('BUILTIN_BANKS');
const arrStart = src.indexOf('[', startIdx);
const arrEnd = src.lastIndexOf('];');
let banks;
try {
  banks = eval(src.slice(arrStart, arrEnd + 1));
} catch (e) {
  console.error('解析失败:', e.message, '范围:', arrStart, arrEnd);
  process.exit(1);
}

console.log('套题总数:', banks.length, '\n');

const hasHan = (s) => /[\u4e00-\u9fff]/.test(s || '');
let totalIssues = 0;
const cat = {}; // 分类统计

function addIssue(issues, label) { issues.push(label); cat[label.replace(/\d+/g, '')] = (cat[label.replace(/\d+/g, '')] || 0) + 1; }

for (const b of banks) {
  const id = b.meta.id;
  const c = b.meta.counts;
  const issues = [];

  // 听力：题数 / 题干空 / 答案空 / 选项数异常 / 英文题干混中文
  const lst = b.listening[0];
  if (lst) {
    const qs = lst.questions || [];
    if (qs.length < 25) addIssue(issues, `听力题数<`);
    let emptyStem = 0, emptyAns = 0, badOpt = 0;
    for (const q of qs) {
      if (!q.question || !q.question.trim()) emptyStem++;
      if (!q.answer) emptyAns++;
      if (q.options.length !== 4) badOpt++;
    }
    if (emptyStem) addIssue(issues, `听力题干空`);
    if (emptyAns) addIssue(issues, `听力答案缺`);
    if (badOpt) addIssue(issues, `听力选项异常`);
  } else addIssue(issues, '无听力');

  // 选词填空
  const bk = b.banked[0];
  if (bk) {
    if ((bk.words || []).length < 10) addIssue(issues, `选词词库<`);
    if ((bk.answers || []).length < 10) addIssue(issues, `选词答案<`);
  } else addIssue(issues, '无选词');

  // 长阅读
  if ((b.long || []).length === 0) addIssue(issues, '无长阅读');

  // 仔细阅读：passage空/中文混入 / 选项数 / 答案
  for (const r of (b.reading || [])) {
    if (!r.passage || r.passage.length < 200) addIssue(issues, `阅读passage短`);
    if (hasHan(r.passage)) addIssue(issues, `阅读passage混中文`);
    for (const q of (r.questions || [])) {
      if (q.options.length !== 4) addIssue(issues, `阅读选项异常`);
      if (!q.answer) addIssue(issues, `阅读无答案`);
    }
  }

  // 翻译
  if (!(b.translation[0]?.prompt)) addIssue(issues, '无翻译');

  if (issues.length) {
    totalIssues += issues.length;
    console.log(`❌ ${id}: ${issues.join(' | ')}`);
  }
}
console.log('\n问题总数:', totalIssues);
console.log('\n分类汇总:');
for (const [k, v] of Object.entries(cat).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v} 套次`);

