/**
 * 长篇阅读答案推断：把每条题干与 A–O 各段做关键词重合度匹配，
 * 已知答案当锚点占位，未知的在剩余段落里取最高分。
 *
 * 先用「已有正确答案」的题做回测，确认准确率后再用于缺失题。
 *   node scripts/infer-long-answers.mjs [--apply-file src/data/papers.ts]
 */
import fs from 'node:fs';

const t = fs.readFileSync('src/data/papers.ts', 'utf8');
const arrStart = t.indexOf('Paper[] = [') + 'Paper[] = '.length;
const PAPERS = JSON.parse(t.slice(arrStart, t.lastIndexOf('];') + 1));

const STOP = new Set(
  `a an the and or but if as at by for from in into of on onto to up with within without over under above about
after before during since until while when where why how what which who whom whose that this these those there here
it its he she they we you i me him her them us my your his their our be is are was were been being am do does did done
have has had having will would shall should can could may might must not no nor so than then too very just also only
even still yet again once ever never always often sometimes more most much many few little less least own same other
another such all any some both each every either neither`
    .split(/\s+/)
    .filter(Boolean)
);

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));

/** 把长篇阅读篇章按 `A)` `B)` … 切成段落 */
function splitParagraphs(material) {
  const out = {};
  const marks = [];
  const re = /(?:^|\n)\s*([A-O])\s*[)）]\s*/g;
  let m;
  while ((m = re.exec(material))) marks.push({ L: m[1], from: m.index + m[0].length, start: m.index });
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : material.length;
    out[marks[i].L] = material.slice(marks[i].from, end);
  }
  return out;
}

function score(stem, para) {
  const a = new Set(words(stem));
  const b = new Set(words(para));
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / Math.sqrt(a.size);
}

/* ---------- 回测：对已有答案的题，看匹配是否命中 ---------- */
let tested = 0,
  hit = 0,
  hitTop3 = 0;
const perf = [];

for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      if (!b.id.includes('long') || !b.material) continue;
      const paras = splitParagraphs(b.material);
      if (Object.keys(paras).length < 10) continue;
      const qs = b.questions || [];
      if (qs.length !== 10) continue;
      const known = new Set(qs.filter((q) => q.answer).map((q) => q.answer));
      for (const q of qs) {
        if (!q.answer || !paras[q.answer]) continue;
        const ranked = Object.entries(paras)
          .filter(([L]) => L !== q.answer || known.size < 2)
          .map(([L, txt]) => [L, score(q.stem, txt)])
          .sort((x, y) => y[1] - x[1]);
        if (!ranked.length) continue;
        tested++;
        const top = ranked[0];
        if (top[0] === q.answer) hit++;
        if (ranked.slice(0, 3).some(([L]) => L === q.answer)) hitTop3++;
        else if (perf.length < 10) perf.push(`${p.id}#${q.num} 正确=${q.answer} 匹配=${ranked.slice(0, 3).map(([L, s]) => L + ':' + s.toFixed(2)).join(' ')}`);
      }
    }
  }
}
console.log(`回测 ${tested} 题：Top1 命中 ${hit}（${((hit / tested) * 100).toFixed(1)}%），Top3 命中 ${hitTop3}（${((hitTop3 / tested) * 100).toFixed(1)}%）`);
perf.forEach((s) => console.log('  ' + s));

/* ---------- 推断缺失答案 ---------- */
const filled = [];
for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      if (!b.id.includes('long') || !b.material) continue;
      const paras = splitParagraphs(b.material);
      const qs = b.questions || [];
      const missing = qs.filter((q) => !q.answer);
      if (!missing.length || Object.keys(paras).length < 10) continue;
      const used = new Set(qs.filter((q) => q.answer).map((q) => q.answer));
      for (const q of missing) {
        const ranked = Object.entries(paras)
          .filter(([L]) => !used.has(L))
          .map(([L, txt]) => [L, score(q.stem, txt)])
          .sort((x, y) => y[1] - x[1]);
        if (!ranked.length) continue;
        q.answer = ranked[0][0];
        used.add(q.answer);
        filled.push(`${p.id} #${q.num} → ${q.answer}（得分 ${ranked[0][1].toFixed(2)}，次选 ${ranked[1] ? ranked[1][0] + ':' + ranked[1][1].toFixed(2) : '无'}）`);
      }
    }
  }
}
console.log(`\n推断填充 ${filled.length} 题：`);
filled.forEach((s) => console.log('  ' + s));

if (process.argv.includes('--write')) {
  fs.writeFileSync('src/data/papers.ts', t.slice(0, arrStart) + JSON.stringify(PAPERS, null, 2) + t.slice(t.lastIndexOf('];')), 'utf8');
  console.log('\n已写入 src/data/papers.ts');
}
