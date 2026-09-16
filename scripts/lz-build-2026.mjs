#!/usr/bin/env node
// 把 2026 年 6 月四六级真题整卷补进 src/data/papers.ts
//
//   node scripts/lz-build-2026.mjs            # dry-run：打印将生成的卷面摘要
//   node scripts/lz-build-2026.mjs --apply    # 追加进 papers.ts（先备份 .bak3）
//
// 数据源：english-exam.lazynote.cn 的「真题与解析页」（.qa/lazynote/raw 缓存，由 lz-crawl.mjs 抓好）
//   - 题干 / 选项 / 中译 / 答案 / 逐题解析  → .qa/lazynote/extract/<套>.json
//   - 阅读与选词填空的篇章原文、写作范文、翻译参考译文 → 各题型页的 DOM（本脚本直接解析）
//
// 为什么不用本地 test-ocr.txt：那是 OCR 文本，粘连严重且只覆盖部分套卷；
// 站点是与「试卷排版」同源的官方卷面，题干/选项/篇章都是干净文本。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, '.qa', 'lazynote', 'raw');
const EXT = path.join(ROOT, '.qa', 'lazynote', 'extract');
const APPLY = process.argv.includes('--apply');

// 站点有 55 题完整答案 + 听力页 + 写作/翻译页的 4 套；第 3 套站点无听力页，暂不导
const SETS = [
  { id: 'cet4-2026_06_1', level: 4, no: 1 },
  { id: 'cet4-2026_06_2', level: 4, no: 2 },
  { id: 'cet6-2026_06_1', level: 6, no: 1 },
  { id: 'cet6-2026_06_2', level: 6, no: 2 },
];

// ---------- HTML 工具 ----------
const unent = s => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// ① 清完整标签；② unent 把 &lt; 解回 < 后可能又冒出标签，再清一遍；
// ③ 清「没有闭合 > 的半截标签」——between() 按属性位置切分会在正文尾部留下
//    <section class="section section--warm"  这种残片，只靠 /<[^>]*>/ 清不掉（曾漏进页面）
const txt = s => unent(String(s).replace(/<[^>]*>/g, ' '))
  .replace(/<[^>]*>/g, ' ')
  .replace(/<[a-zA-Z/][^<>]*/g, ' ')
  .replace(/\s+/g, ' ').trim();

const raw = rel => {
  const f = path.join(RAW, rel.replace(/\//g, '_') + '.html');
  if (!fs.existsSync(f)) return '';
  return fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
};
/** 从 fromMark 切到最近的 toMark 之一（都在 fromMark 之后） */
function between(html, fromMark, toMarks, span = 60000) {
  const i = html.indexOf(fromMark);
  if (i < 0) return '';
  let end = Math.min(html.length, i + span);
  for (const m of toMarks) {
    const j = html.indexOf(m, i + fromMark.length);
    if (j >= 0 && j < end) end = j;
  }
  // toMark 常常是「属性」而非标签起点（如 <section class="x" id="pitfalls">）。
  // 若切点落在开标签内部，回退到该标签的 '<'，否则前半截属性会以无闭合 > 的
  // 残片形式混进正文 → 页面直接把 class="..." 当文字显示出来。
  const lt = html.lastIndexOf('<', end);
  if (lt >= 0 && lt > html.lastIndexOf('>', end)) end = lt;
  return html.slice(i, end);
}
/** 取 id="X" 元素的内容（跳过开标签本身，避免把属性当正文） */
const elt = (html, id, toMarks, span = 60000) => {
  const seg = between(html, `id="${id}"`, toMarks, span);
  const gt = seg.indexOf('>');
  return gt < 0 ? '' : seg.slice(gt + 1);
};

/** 段落集：站点把篇章段落挂在 id="p-N" 上（阅读 P1..Pn / 长篇 A)..O) / 选词填空同款）
 *  末尾一段要停在题目区（id="q-N"）之前，否则会把整片解析页也当成正文吞进来 */
function paragraphs(html) {
  const hits = [...html.matchAll(/<div[^>]*\sid="p-(\d+)"[^>]*>/g)];
  const firstQ = html.search(/id="q-\d+"/);
  return hits.map((h, i) => {
    const nextP = i + 1 < hits.length ? hits[i + 1].index : Infinity;
    const end = Math.min(nextP, firstQ > h.index ? firstQ : Infinity, h.index + 12000);
    const chunk = html.slice(h.index, end);
    const zh = /<p class="lt-zh"[^>]*>([\s\S]*?)<\/p>/.exec(chunk);
    // 英文正文只取「段译文之前」的那一截：末段之后还跟着词库 / 「题目与逐题解析」等标题
    let body = chunk.split('<p class="lt-zh"')[0].replace(/<button[\s\S]*?<\/button>/g, '');
    // 长篇阅读：英文挂在 data-pdh-letter="A" 的内层 div 上，外层的 "A)" span 要去掉
    const inner = /<div[^>]*data-pdh-letter="[A-O]"[^>]*>([\s\S]*)$/.exec(body);
    if (inner) body = inner[1];
    return {
      idx: +h[1],
      // 选词填空的空位在页面上是 <u> 26 </u>，还原成 ___26___
      en: txt(body.replace(/<u>\s*(\d{1,2})\s*<\/u>/g, '___$1___')).replace(/^P\d+\s*/, ''),
      zh: zh ? txt(zh[1]) : '',
    };
  });
}
/** 答案统一成单个字母（站点上选词填空写作 "N) squeezed"） */
const letter = s => (/^\s*([A-O])/.exec(s || '') || [, ''])[1];

// ---------- 各题型页 → block ----------
function listeningBlocks(level, site, ext) {
  const html = raw(`cet${level}/sections/listening/${site}`);
  const page = ext.pages.find(p => p.part === site);
  if (!html || !page) return [];
  // 目录给出权威的 Section / 篇 / 题型 / 题号范围
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
    // 首段的 lt-piece-head 里是「Questions X and Y are based on …」
    const head = between(
      html, `id="lt-${g.from}"`,
      ['class="lt-body"', `id="lt-${g.to + 1}"`],
    );
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

function passageBlock(level, site, ext, part, opts) {
  const html = raw(`cet${level}/sections/${site}/${part}`);
  const page = ext.pages.find(p => p.part === part);
  const ps = html ? paragraphs(html) : [];
  const qs = page?.questions || [];
  const material = opts.join(ps, html);
  const block = {
    id: `__SET__-${opts.suffix}`,
    group: opts.group,
    groupCn: opts.groupCn,
    label: opts.label,
    material,
    translationCn: ps.map(p => opts.zhOf(p)).filter(Boolean).join('\n'),
    questions: qs.map(q => ({
      num: q.num,
      stem: q.stem || '',
      stemCn: q.stemCn || '',
      options: opts.letterOnly ? {} : (q.options || {}),
      optionCn: opts.letterOnly ? {} : (q.optionCn || {}),
      answer: letter(q.answer),
      analysis: q.analysis || '',
    })),
  };
  if (opts.wordBankOf) {
    const wb = page?.wordBank || {};
    if (Object.keys(wb).length) block.wordBank = wb;
  }
  return block;
}

function writingBlock(level, site) {
  const html = raw(`cet${level}/sections/${site}/part1`);
  if (!html) return null;
  const directions = elt(html, 'directions', ['<div id="parsing"']);
  const essay = elt(html, 'essay', ['<div id="essay-zh"']);
  const essayZh = elt(html, 'essay-zh', ['<div id="bd"', '<section']);
  const analysis = elt(html, 'analysis', ['id="structure"']);
  const review = elt(html, 'review', ['id="pitfalls"']);
  const prompt = txt(directions).replace(/^Directions\s*:?\s*/i, '').trim();
  const strip = (h, ...drop) => {
    let t = h;
    for (const d of drop) t = t.replace(d, '');
    return txt(t);
  };
  return {
    id: '__SET__-writing',
    group: '短文写作',
    groupCn: 'Writing',
    label: 'Writing',
    prompt: prompt || undefined,
    sample: txt(essay) || undefined,
    sampleCn: txt(essayZh) || undefined,
    review: strip(analysis, /^[\s\S]{0,400}?<\/header>/, /ANALYSIS · 审题与立意/,
      /这道题到底要写什么、立意是什么/) || undefined,
    sampleNote: strip(review, /^[\s\S]{0,400}?<\/header>/, /REVIEW · 自检避坑/,
      /本题在四个评分维度怎样算达标、容易在哪丢分/) || undefined,
    questions: [],
  };
}

function translationBlock(level, site) {
  const html = raw(`cet${level}/sections/${site}/part-iv`);
  if (!html) return null;
  const stem = elt(html, 'stem', ['id="translation"']);
  const ref = elt(html, 'translation', ['id="global"', '<section']);
  return {
    id: '__SET__-translation',
    group: '短文翻译',
    groupCn: 'Translation',
    label: 'Translation',
    prompt: txt(stem) || undefined,
    reference: txt(ref) || undefined,
    questions: [],
  };
}

// ---------- 组装整套 ----------
function buildPaper(s) {
  const ext = JSON.parse(fs.readFileSync(path.join(EXT, `${s.id.replace(/_/g, '-')}.json`), 'utf8'));
  const L = s.level, site = `2026-06-${s.no}`;

  const listening = listeningBlocks(L, site, ext);
  const banked = passageBlock(L, site, ext, 'part3-section-a', {
    suffix: 'banked', group: 'Section A', groupCn: '选词填空', label: 'Banked Cloze',
    join: ps => ps.map(p => p.en).join(' '),
    zhOf: p => p.zh, letterOnly: true, wordBankOf: true,
  });
  const long = passageBlock(L, site, ext, 'part3-section-b', {
    suffix: 'long', group: 'Section B', groupCn: '长篇阅读', label: 'Long Reading',
    join: ps => ps.map(p => `${String.fromCharCode(64 + p.idx)}) ${p.en}`).join('\n'),
    zhOf: p => p.zh, letterOnly: true,
  });
  const rdParts = ['part3-section-c-1', 'part3-section-c-2']
    .filter(p => fs.existsSync(path.join(RAW, `cet${L}_sections_${site}_${p}.html`)));
  // 有的套卷把第一篇写成 part3-section-c（无 -1）
  const rdNames = rdParts.length === 2
    ? rdParts
    : ['part3-section-c', 'part3-section-c-2'].filter(p => fs.existsSync(path.join(RAW, `cet${L}_sections_${site}_${p}.html`)));
  const readings = rdNames.map((p, i) => passageBlock(L, site, ext, p, {
    suffix: `rd${i + 1}`, group: 'Section C', groupCn: '仔细阅读',
    label: i === 0 ? 'Passage One' : 'Passage Two',
    join: ps => ps.map(x => x.en).join(' '),
    zhOf: x => x.zh, letterOnly: false,
  }));

  const secIII = [banked, long, ...readings];
  const paper = {
    id: s.id,
    level: L,
    year: 2026,
    month: 6,
    setNo: `第${s.no}套`,
    title: `2026年6月${L === 4 ? '四' : '六'}级真题（第${s.no}套）`,
    minutes: 125,
    sections: [
      { partNo: 'I', partName: '写作', partNameEn: 'Writing', score: 106.5, minutes: 30, blocks: [writingBlock(L, site)].filter(Boolean) },
      { partNo: 'II', partName: '听力理解', partNameEn: 'Listening Comprehension', score: 248.5, minutes: 25, blocks: listening },
      { partNo: 'III', partName: '阅读理解', partNameEn: 'Reading Comprehension', score: 248.5, minutes: 40, blocks: secIII },
      { partNo: 'IV', partName: '翻译', partNameEn: 'Translation', score: 106.5, minutes: 30, blocks: [translationBlock(L, site)].filter(Boolean) },
    ],
  };
  // 占位 id → 真 id
  for (const sec of paper.sections) for (const b of sec.blocks) b.id = b.id.replace('__SET__', s.id);
  return paper;
}

// ---------- 落盘 ----------
const built = SETS.map(buildPaper);

const summary = (p) => {
  const q = p.sections.flatMap(s => s.blocks).flatMap(b => b.questions || []);
  return `${p.id}  区块 ${p.sections.map(s => s.blocks.length).join('/')}  题 ${q.length}  缺答案 ${q.filter(x => !x.answer).length}` +
    `  篇章 ${p.sections.flatMap(s => s.blocks).filter(b => b.material).length}` +
    `  词库 ${p.sections.flatMap(s => s.blocks).filter(b => b.wordBank).length}`;
};
for (const p of built) console.log(summary(p));

if (!APPLY) {
  const f = built[0];
  console.log('\n—— 首套抽样 ——');
  for (const sec of f.sections) for (const b of sec.blocks.slice(0, 3)) {
    console.log(`${b.id} | ${b.group} | ${b.groupCn} | ${b.label} | intro=${JSON.stringify(b.intro || '').slice(0, 60)}`);
    console.log('   material:', JSON.stringify((b.material || b.prompt || '').slice(0, 110)));
    console.log('   q:', JSON.stringify(b.questions[0] || {}).slice(0, 220));
  }
  console.log('\n（dry-run，未写入）');
  process.exit(0);
}

const file = path.join(ROOT, 'src/data/papers.ts');
const bak = path.join(ROOT, '.qa/lazynote/papers.ts.bak3');
if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
const src = fs.readFileSync(file, 'utf8');
const eq = src.indexOf('=', src.indexOf('PAPERS: Paper[] ='));
const a = src.indexOf('[', eq), b = src.lastIndexOf(']');
const arr = JSON.parse(src.slice(a, b + 1));

for (const p of built) {
  const at = arr.findIndex(x => x.id === p.id);
  if (at >= 0) arr.splice(at, 1);
}
// 列表是「cet4 全在前、cet6 在后，各自按时间倒序」；按级别整组插到该级别块首，保持 1→2→3 顺序
for (const lv of [4, 6]) {
  const group = built.filter(p => p.level === lv);
  if (!group.length) continue;
  const first = arr.findIndex(x => x.id.startsWith(`cet${lv}-`));
  arr.splice(first < 0 ? arr.length : first, 0, ...group);
}
fs.writeFileSync(file, src.slice(0, a) + JSON.stringify(arr, null, 2) + src.slice(b + 1));
console.log(`已写入 ${built.length} 套 → papers.ts（共 ${arr.length} 套）；备份 ${path.relative(ROOT, bak)}`);
