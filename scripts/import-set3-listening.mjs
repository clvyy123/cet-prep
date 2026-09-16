#!/usr/bin/env node
// 把每个年月的「第1套/第2套听力」导入到同场次第三套卷，作为两个可随机切换的听力 variant。
//
//   node scripts/import-set3-listening.mjs           # dry-run：打印匹配与导入计划
//   node scripts/import-set3-listening.mjs --apply   # 写回 papers.ts（先备份 .bak5）+ 拼接缺失音频
//
// 数据链：
//   1) 第1/2套听力不全或缺整套的 → 用 .qa/lazynote（懒笔记全量）重建听力 section（listeningBlocks）。
//      站点套号与本地「第 N 套」经常不是同一份卷 → 必须做排列匹配（阅读题按「选项原文」比对，
//      相似度 <80% 整套跳过，见 HANDOVER.md 铁律）。
//   2) 第3套卷 deep-clone 第1/2套的听力 section（blocks+questions+audioUrl 一起带过去，保证音题一一对应），
//      写入 sourceSet 标记；前端 Papers 页对同一 partNo 的多个 variant 随机显示一个。
//   3) 有 A/B/C 分段但缺合并 mp3 的套卷 → 字节拼接生成 public/audio/papers/<id>.mp3。
//   4) 不动第三套原有的写作/阅读/翻译 section。
//
// 已知边界：站点没有 2022-06/09、2023-03「第2套」听力页（404 已探测）；ec 无 2021 年六级音频 →
// cet6-2021 两场的听力导入为「有题无音频」。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, '.qa', 'lazynote', 'raw');
const EXT = path.join(ROOT, '.qa', 'lazynote', 'extract');
const AUDIO = path.join(ROOT, 'public', 'audio', 'papers');
const APPLY = process.argv.includes('--apply');
const MIN_SCORE = 0.8;

// ---------- papers.ts 读写 ----------
function loadPapers() {
  const file = path.join(ROOT, 'src/data/papers.ts');
  const src = fs.readFileSync(file, 'utf8');
  const eq = src.indexOf('=', src.indexOf('PAPERS: Paper[] ='));
  const a = src.indexOf('[', eq), b = src.lastIndexOf(']');
  return { file, src, a, b, papers: JSON.parse(src.slice(a, b + 1)) };
}

// ---------- 懒笔记工具（与 lz-build-2026.mjs 同款） ----------
const unent = s => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// ① 清完整标签；② unent 解回 &lt; 后再清一遍；③ 清无闭合 > 的半截标签（切分残片，曾漏进正文）
const txt = s => unent(String(s).replace(/<[^>]*>/g, ' '))
  .replace(/<[^>]*>/g, ' ')
  .replace(/<[a-zA-Z/][^<>]*/g, ' ')
  .replace(/\s+/g, ' ').trim();

const raw = rel => {
  const f = path.join(RAW, rel.replace(/\//g, '_') + '.html');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '') : '';
};
function between(html, fromMark, toMarks, span = 60000) {
  const i = html.indexOf(fromMark);
  if (i < 0) return '';
  let end = Math.min(html.length, i + span);
  for (const m of toMarks) {
    const j = html.indexOf(m, i + fromMark.length);
    if (j >= 0 && j < end) end = j;
  }
  return html.slice(i, end);
}
const letter = s => (/^\s*([A-O])/.exec(s || '') || [, ''])[1];

function listeningBlocks(level, site, ext) {
  const html = raw(`cet${level}/sections/listening/${site}`);
  const page = ext.pages.find(p => p.part === site);
  if (!html || !page) return [];
  const groups = [...html.matchAll(/class="ptoc__link ptoc__link--top"[^>]*>\s*([^<]+?)\s*<\/a>/g)]
    .map(m => /^Section ([ABC]) · 第 (\d+) 篇 ([^·]+?) · \d+ 段 · (\d+)[–-](\d+) 题$/.exec(m[1].trim()))
    .filter(Boolean)
    .map(m => ({ group: `Section ${m[1]}`, idx: +m[2], type: m[3].trim(), from: +m[4], to: +m[5] }));
  const SEQ = ['One', 'Two', 'Three'];
  const NAME = { '短篇新闻': 'News Report', '长对话': 'Conversation', '听力篇章': 'Passage', '讲座/讲话': 'Recording' };
  const CN = { '短篇新闻': '短新闻', '长对话': '长对话', '听力篇章': '听力篇章', '讲座/讲话': '讲座/讲话' };
  const qs = Object.fromEntries(page.questions.map(q => [q.num, q]));
  return groups.map(g => {
    const paras = page.transcript?.[g.from] || [];
    const head = between(html, `id="lt-${g.from}"`, ['class="lt-body"', `id="lt-${g.to + 1}"`]);
    const intro = (/<div class="lt-piece-head"[\s\S]*?<span>([^<]+)<\/span>/.exec(head) || [, ''])[1];
    const nums = Object.keys(qs).map(Number).filter(n => n >= g.from && n <= g.to).sort((a, b) => a - b);
    return {
      id: `__SET__-L${g.from}`,
      group: g.group,
      groupCn: CN[g.type] || g.type,
      label: `${NAME[g.type] || g.type} ${SEQ[g.idx - 1]}`,
      intro: txt(intro),
      material: paras.map((p, i) => `${i + 1}. ${p.en}`).join('\n'),
      questions: nums.map(n => {
        const q = qs[n];
        return { num: n, stem: q.stem || '', stemCn: q.stemCn || '', options: q.options || {}, optionCn: q.optionCn || {}, answer: letter(q.answer), analysis: q.analysis || '' };
      }),
    };
  });
}

// ---------- 排列匹配 ----------
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** 站点某套的听力题 map（num → q） */
function siteListeningQs(level, site) {
  const f = path.join(EXT, `cet${level}-${site}.json`);
  if (!fs.existsSync(f)) return null;
  const ext = JSON.parse(fs.readFileSync(f, 'utf8'));
  const page = ext.pages.find(p => p.part === `listening/${site}`) || ext.pages.find(p => p.part === site);
  if (!page || !page.questions?.length) return null;
  return { ext, qs: Object.fromEntries(page.questions.map(q => [q.num, q])) };
}

/** 站点某套的全卷答案 map（num → 原始答案串） */
function siteAnswers(ext) { return ext.answers || {}; }

function siteWordOf(ansStr) {
  const m = /^\s*[A-O]\)\s*(.+?)\s*$/.exec(ansStr || '');
  return m ? norm(m[1]) : '';
}

/** 两道「四选一」题是否同一题：按选项原文定位（不按字母比） */
function sameChoiceQuestion(a, b) {
  if (!a || !b) return false;
  const oa = a.options || {}, ob = b.options || {};
  const ka = Object.keys(oa), kb = Object.keys(ob);
  if (ka.length && kb.length) {
    // 正确项原文一致 → 同题同答
    const ta = norm(oa[a.answer]), tb = norm(ob[b.answer]);
    if (ta && tb) return ta === tb;
    // 答案文本缺失时退一步：≥2 个相同字母的选项原文一致
    let hits = 0;
    for (const L of ka) if (ob[L] && norm(oa[L]) === norm(ob[L])) hits++;
    return hits >= 2;
  }
  return false;
}

/** 本地某 section 的题 map */
const localQs = sec => Object.fromEntries((sec?.blocks || []).flatMap(b => b.questions).map(q => [q.num, q]));

/** 听力相似度：共享题号里「正确选项原文一致」的比例 */
function listeningScore(localSec, siteQs) {
  const lq = localQs(localSec);
  const nums = Object.keys(lq).map(Number).filter(n => siteQs[n]);
  if (!nums.length) return { score: 0, shared: 0, hits: 0 };
  let hits = 0;
  for (const n of nums) if (sameChoiceQuestion(lq[n], siteQs[n])) hits++;
  return { score: hits / nums.length, shared: nums.length, hits };
}

/** 阅读相似度：选词填空按词、长篇按段落字母、仔细阅读按正确选项原文 */
function readingScore(paper, ext) {
  const ans = siteAnswers(ext);
  const sec = paper.sections.find(s => /^III/.test(s.partNo) || /阅读/.test(s.partName));
  if (!sec) return { score: 0, shared: 0, hits: 0 };
  let shared = 0, hits = 0;
  for (const b of sec.blocks) {
    if (b.wordBank && Object.keys(b.wordBank).length) {
      for (const q of b.questions) {
        const sw = siteWordOf(ans[q.num]);
        if (!sw) continue;
        shared++;
        const lw = norm(b.wordBank[q.answer]);
        if (lw && lw === sw) hits++;
      }
    } else if (/长篇|Long/i.test(b.groupCn + b.group)) {
      for (const q of b.questions) {
        const sl = letter(ans[q.num]);
        if (!sl) continue;
        shared++;
        if (sl === q.answer) hits++;
      }
    } else if (b.questions.length && Object.keys(b.questions[0].options || {}).length) {
      for (const q of b.questions) {
        const siteQ = (ext.pages.find(p => /part3-section-c/.test(p.part))?.questions || []).find(x => x.num === q.num);
        if (!siteQ) continue;
        shared++;
        if (sameChoiceQuestion(q, siteQ)) hits++;
      }
    }
  }
  return { score: shared ? hits / shared : 0, shared, hits };
}

// ---------- 音频 ----------
function ensureMergedAudio(id, report) {
  const merged = path.join(AUDIO, `${id}.mp3`);
  if (fs.existsSync(merged)) return `/audio/papers/${id}.mp3`;
  const parts = ['A', 'B', 'C'].map(L => path.join(AUDIO, `${id}-${L}.mp3`));
  if (parts.some(f => !fs.existsSync(f))) return undefined;
  if (!APPLY) { report.audio.push(`[dry-run] 将拼接 ${id}.mp3`); return `/audio/papers/${id}.mp3`; }
  const bufs = parts.map(f => fs.readFileSync(f));
  fs.writeFileSync(merged, Buffer.concat(bufs));
  report.audio.push(`已拼接 ${id}.mp3（${(Buffer.concat(bufs).length / 1048576).toFixed(1)} MB）`);
  return `/audio/papers/${id}.mp3`;
}

// ---------- 主流程 ----------
const { file, src, a, b, papers } = loadPapers();
const byId = new Map(papers.map(p => [p.id, p]));

// 需要处理的场次 = 存在第三套卷的 (level, year, month)
const sessions = new Map();
for (const p of papers) {
  if (p.setNo !== '第3套') continue;
  sessions.set(`cet${p.level}-${p.year}_${p.month}`, { level: p.level, year: p.year, month: p.month, set3: p });
}

const report = { sessions: [], audio: [] };
let changed = false;

for (const [, S] of [...sessions.entries()].sort()) {
  const { level, year, month, set3 } = S;
  const MM = String(month).padStart(2, '0');
  const entry = { id: `cet${level}-${year}_${month}`, variants: [], notes: [] };

  // 站点候选套（1..3，按有没有数据过滤）
  const siteCandidates = [];
  for (const n of [1, 2, 3]) {
    const site = `${year}-${MM}-${n}`;
    const f = path.join(EXT, `cet${level}-${site}.json`);
    if (fs.existsSync(f)) siteCandidates.push({ n, site, ext: JSON.parse(fs.readFileSync(f, 'utf8')) });
  }

  const variants = [];
  for (const n of [1, 2]) {
    const local = papers.find(p => p.level === level && p.year === year && p.month === month && p.setNo === `第${n}套`);
    if (!local) { entry.notes.push(`本地无第${n}套卷，跳过`); continue; }
    let sec = local.sections.find(s => /听力/.test(s.partName));
    const qCount = sec ? sec.blocks.reduce((m, x) => m + x.questions.length, 0) : 0;

    if (sec && qCount >= 25) {
      entry.notes.push(`第${n}套听力完整（${qCount} 题），直接复用`);
      variants.push({ from: n, section: sec });
      ensureMergedAudio(local.id, report);
      continue;
    }

    // —— 需要重建：找站点同源套 ——
    // 先用本地已有听力题验证（最强信号：≥3 题且 ≥80% 即采信），
    // 听力样本不足时退回阅读排列匹配（≥5 题且 ≥80%）。
    let best = null;
    for (const c of siteCandidates) {
      const ls = siteListeningQs(level, c.site);
      const lis = listeningScore(sec, ls?.qs || {});
      const m = (sec && lis.shared >= 3 && lis.score >= MIN_SCORE)
        ? lis
        : readingScore(local, c.ext);
      if (!best || m.score > best.m.score) best = { c, m, ls };
    }
    const need = sec ? 3 : 5;
    if (!best || best.m.score < MIN_SCORE || best.m.shared < need) {
      entry.notes.push(`第${n}套：站点无同源数据（最高相似度 ${best ? (best.m.score * 100).toFixed(0) + '%/' + best.m.shared + '题' : '无候选'}），跳过`);
      continue;
    }
    const blocks = listeningBlocks(level, best.c.site, best.c.ext);
    const builtQs = blocks.reduce((m, x) => m + x.questions.length, 0);
    if (!blocks.length || builtQs < 10) {
      entry.notes.push(`第${n}套：站点 ${best.c.site} 听力页解析不足（${builtQs} 题），跳过`);
      continue;
    }
    // 交叉验证：本地已有的听力题必须与站点重建一致
    if (sec && qCount >= 3) {
      const v = listeningScore(sec, Object.fromEntries(blocks.flatMap(x => x.questions).map(q => [q.num, q])));
      if (v.score < MIN_SCORE) {
        entry.notes.push(`第${n}套：站点重建与本地听力仅 ${(v.score * 100).toFixed(0)}% 一致，放弃（铁律）`);
        continue;
      }
    }
    const audioUrl = ensureMergedAudio(local.id, report);
    for (const blk of blocks) blk.id = blk.id.replace('__SET__', local.id);
    const newSec = {
      partNo: 'II', partName: '听力理解', partNameEn: 'Listening Comprehension',
      score: 248.5, minutes: 25, blocks,
      ...(audioUrl ? { audioUrl } : {}),
    };
    if (!audioUrl) entry.notes.push(`第${n}套：无音频源（题+原文完整，播放器不显示）`);
    // 替换/插入本地第 n 套的听力 section
    const at = local.sections.findIndex(s => /听力/.test(s.partName));
    if (at >= 0) local.sections[at] = newSec;
    else local.sections.splice(1, 0, newSec);
    changed = true;
    entry.notes.push(`第${n}套：用站点 ${best.c.site} 重建听力（${builtQs} 题，相似度 ${(best.m.score * 100).toFixed(0)}%/${best.m.shared}题）`);
    variants.push({ from: n, section: newSec });
  }

  // —— 导入第三套 ——
  if (variants.length) {
    // 内容完全一致（同源排列）的 variant 去重
    const uniq = [];
    for (const v of variants) {
      const sig = JSON.stringify(v.section.blocks.map(x => [x.group, x.questions.map(q => [q.num, q.answer, norm(q.options?.[q.answer])])])); 
      v.sig = sig;
      if (!uniq.some(u => u.sig === sig)) uniq.push(v);
      else entry.notes.push(`第${v.from}套听力与前面 variant 内容一致，去重`);
    }
    const set3Id = set3.id;
    // 重跑幂等：先移除上次导入的 variant
    set3.sections = set3.sections.filter(s => !s.sourceSet);
    const at = Math.max(set3.sections.findIndex(s => s.partNo === 'I'), 0) + 1;
    const clones = uniq.map((v, i) => {
      const tag = `L${i + 1}`;
      const c = JSON.parse(JSON.stringify(v.section));
      for (const blk of c.blocks) blk.id = `${set3Id}-${tag}-${blk.id.split('-').pop()}`;
      c.sourceSet = `第${v.from}套`;
      return c;
    });
    set3.sections.splice(at, 0, ...clones);
    changed = true;
    entry.variants = uniq.map(v => `第${v.from}套`);
    entry.notes.push(`第三套导入 ${clones.length} 个听力 variant（${clones.map(c => c.blocks.reduce((m, x) => m + x.questions.length, 0) + '题').join(' / ')}）`);
  } else {
    entry.notes.push('第三套无可导入听力');
  }
  report.sessions.push(entry);
}

// ---------- 落盘 ----------
const render = () => {
  for (const s of report.sessions) {
    console.log(`\n【${s.id}】variants: ${s.variants.join(', ') || '—'}`);
    for (const n of s.notes) console.log('  · ' + n);
  }
  if (report.audio.length) { console.log('\n—— 音频 ——'); for (const x of report.audio) console.log('  ' + x); }
  const withVariants = report.sessions.filter(s => s.variants.length);
  console.log(`\n场次 ${report.sessions.length}，成功导入 ${withVariants.length}，variant 总数 ${withVariants.reduce((m, s) => m + s.variants.length, 0)}`);
};

render();

if (APPLY && changed) {
  const bak = path.join(ROOT, '.qa/lazynote/papers.ts.bak5');
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  fs.writeFileSync(file, src.slice(0, a) + JSON.stringify(papers, null, 2) + src.slice(b + 1));
  console.log(`\n已写回 ${path.relative(ROOT, file)}（备份 ${path.relative(ROOT, bak)}）`);
} else {
  console.log('\n（dry-run，未写盘；加 --apply 生效）');
}
