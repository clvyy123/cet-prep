// 题库质量扫描：找出 papers.ts 中的乱码 / 缺失 / 结构错误
// 用法: node scripts/qa-papers.mjs [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync('src/data/papers.ts', 'utf8');
const anchor = raw.indexOf('PAPERS: Paper[] = [');
const start = raw.indexOf('= [', anchor) + 1;
const end = raw.lastIndexOf(']');
const papers = JSON.parse(raw.slice(start, end + 1));

const issues = [];
const add = (id, kind, detail) => { issues.push({ id, kind, detail }); };

// 页脚/页眉泄漏：如「四级2025.12第一套」「六级2021年6月31」「斤第一套」
const FOOTER_RE = /[四六]级\s*\d{4}年\d+月\d*/;
const REFFOOT_RE = /第[一二三]套|2-3套/;

// 乱码特征：替换符、控制符（é/è 等合法外文字母不算，如 résumé）
const GARBAGE_RE = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
// 中文里夹的奇怪符号串
const WEIRD_PUNCT_RE = /[\u4e00-\u9fff]\s*[▁▂▃■□◆◇→←↑↓…]{2,}/;
// 连续空格过多（版式残留）
const MANY_SPACE_RE = /\S {5,}\S/;
// 英文粘连启发：常见短词直接相连（小写边界）
const STUCK_RE = /\b[a-z]{3,}(?:the|and|of|to|in|that|is|was|for|with)[a-z]{2,}\b/;

const isEn = (s) => /^[\x00-\x7F\u2018\u2019\u201C\u201D\u2013\u2014\u00e9\u00e8\u00e0\u00fc\u00f6\u2026\s]*$/.test(s || '');

for (const p of papers) {
  const walkQ = (q, ctx, block) => {
    if (!q) return;
    const banked = !!block?.wordBank;
    // 26-35 选词填空 / 36-45 段落匹配：字母格选项，0 options 正常
    const letterGrid = banked || (q.num >= 26 && q.num <= 45);
    if (!q.stem && !letterGrid) add(p.id, 'missing', `${ctx} #${q.num} 题干为空`);
    if (letterGrid && q.stem && !q.stem.trim()) add(p.id, 'missing', `${ctx} #${q.num} 题干为空`);
    if (!q.answer) add(p.id, 'missing', `${ctx} #${q.num} 缺答案`);
    if (!q.analysis) add(p.id, 'missing', `${ctx} #${q.num} 缺解析`);
    if (!letterGrid) {
      const n = Object.keys(q.options).length;
      if (n !== 4) add(p.id, 'structure', `${ctx} #${q.num} 选项数 ${n} (期望 4)`);
      for (const [k, v] of Object.entries(q.options)) {
        if (!v || !v.trim()) add(p.id, 'missing', `${ctx} #${q.num} 选项 ${k} 为空`);
      }
    }
    for (const field of ['stem', 'analysis']) {
      const s = q[field] || '';
      if (GARBAGE_RE.test(s)) add(p.id, 'garble', `${ctx} #${q.num} ${field} 乱码: ${JSON.stringify(s.match(GARBAGE_RE).slice(0, 5))}`);
      if (FOOTER_RE.test(s)) add(p.id, 'leak', `${ctx} #${q.num} ${field} 混入页脚: ${JSON.stringify(s.match(FOOTER_RE)[0])}`);
    }
  };
  const walkBlock = (b, ctx) => {
    if (!b) return;
    const tag = `${ctx} block[${b.id || b.group || ''}]`;
    for (const field of ['prompt', 'mat']) {
      const s = b[field] || '';
      if (!s && field === 'mat' && ctx.includes('II')) { /* 听力原文可缺 */ }
      if (s) {
        if (GARBAGE_RE.test(s)) add(p.id, 'garble', `${tag} ${field} 乱码`);
        if (FOOTER_RE.test(s)) add(p.id, 'leak', `${tag} ${field} 页脚泄漏: ${JSON.stringify((s.match(new RegExp(FOOTER_RE.source, 'g')) || []).slice(0, 3))}`);
        if (MANY_SPACE_RE.test(s)) add(p.id, 'spacing', `${tag} ${field} 含 5+ 连续空格`);
      }
    }
    for (const field of ['review', 'sample', 'sampleNote', 'sampleCn', 'reference', 'notes']) {
      const s = b[field] || '';
      if (s) {
        if (GARBAGE_RE.test(s)) add(p.id, 'garble', `${tag} ${field} 乱码`);
        if (FOOTER_RE.test(s)) add(p.id, 'leak', `${tag} ${field} 页脚泄漏: ${JSON.stringify((s.match(new RegExp(FOOTER_RE.source, 'g')) || []).slice(0, 3))}`);
      }
    }
    if (b.type === 'writing') {
      if (!b.sample) add(p.id, 'missing', `${tag} 缺范文`);
      if (!b.reference && b.prompt) { /* 翻译才有 reference */ }
    }
    if (b.type === 'translation') {
      if (!b.reference) add(p.id, 'missing', `${tag} 缺参考译文`);
      if (!b.prompt) add(p.id, 'missing', `${tag} 缺翻译原文`);
    }
    (b.questions || []).forEach((q) => walkQ(q, ctx));
  };
  for (const sec of p.sections || []) {
    (sec.blocks || []).forEach((b) => walkBlock(b, `Part${sec.partNo}`));
  }
}

// 汇总
const byKind = {};
for (const it of issues) (byKind[it.kind] ||= []).push(it);
for (const [k, arr] of Object.entries(byKind)) {
  console.log(`\n===== ${k}: ${arr.length} 条 =====`);
  for (const it of arr.slice(0, 400)) console.log(`[${it.id}] ${it.detail.slice(0, 220)}`);
}
if (process.argv.includes('--json')) {
  const out = process.argv[process.argv.indexOf('--json') + 1];
  writeFileSync(out, JSON.stringify({ papers: papers.length, issues }, null, 1));
  console.log(`\nsaved -> ${out}`);
}
console.log(`\n总计: ${papers.length} 套, ${issues.length} 条问题`);
