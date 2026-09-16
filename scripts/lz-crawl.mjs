#!/usr/bin/env node
// 抓取 english-exam.lazynote.cn 的结构化解析数据（答案 / 题干 / 选项 / 译文 / 解析）
//
//   node scripts/lz-crawl.mjs                 # 抓本地两套题库涵盖的全部套卷
//   node scripts/lz-crawl.mjs --only cet6-2025_12_1
//   node scripts/lz-crawl.mjs --conc 6
//
// 缓存：.qa/lazynote/raw/*.html（存在即跳过）；解析结果：.qa/lazynote/extract/<key>.json
// 站点是静态 Astro HTML（无鉴权、无图片），直接解析 DOM 文本即可，不需要 OCR。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LZ = path.join(ROOT, '.qa', 'lazynote');
const RAW = path.join(LZ, 'raw');
const OUT = path.join(LZ, 'extract');
const ORIGIN = 'https://english-exam.lazynote.cn';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const CONC = Number(arg('--conc', '6'));
const ONLY = arg('--only', '');

// ---------- 本地套卷 ----------
function loadTsArray(file, marker) {
  const s = fs.readFileSync(file, 'utf8');
  const eq = s.indexOf('=', s.indexOf(marker));
  const a = s.indexOf('[', eq), b = s.lastIndexOf(']');
  return JSON.parse(s.slice(a, b + 1));
}

const localKeys = new Set();
for (const p of loadTsArray(path.join(ROOT, 'src/data/papers.ts'), 'PAPERS: Paper[] =')) localKeys.add(p.id);
for (const b of loadTsArray(path.join(ROOT, 'src/data/builtin-banks.ts'), 'BUILTIN_BANKS: BuiltinBank[] ='))
  localKeys.add(b.meta.id.replace(/^bi-/, ''));

const sets = [...localKeys].filter(k => !ONLY || k === ONLY).map(k => {
  const m = /^cet([46])-(\d{4})_(\d{2})_(\d+)$/.exec(k);
  if (!m) throw new Error('无法解析套卷 id: ' + k);
  return { key: k, level: +m[1], site: `${m[2]}-${m[3]}-${m[4]}` };
});

// ---------- 站点 URL 清单（sitemap） ----------
const sitemapFiles = {
  'urls-papers.txt': ORIGIN + '/sitemap-papers.xml',
  'urls-sections.txt': ORIGIN + '/sitemap-sections.xml',
};
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

for (const [f, u] of Object.entries(sitemapFiles)) {
  const p = path.join(LZ, f);
  if (!fs.existsSync(p) || fs.statSync(p).size < 1000) {
    const xml = await (await fetch(u)).text();
    fs.writeFileSync(p, [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).join('\n'));
  }
}
const sectionUrls = fs.readFileSync(path.join(LZ, 'urls-sections.txt'), 'utf8').split('\n').filter(Boolean);

// ---------- HTML 工具 ----------
const unent = s => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// ① 清完整标签；② unent 解回 &lt; 后再清一遍；③ 清无闭合 > 的半截标签（切分残片，曾漏进正文）
const text = s => unent(String(s).replace(/<[^>]*>/g, ' '))
  .replace(/<[^>]*>/g, ' ')
  .replace(/<[a-zA-Z/][^<>]*/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** 把一页 HTML 切成「逐题单元」：站点每道题都挂在 id="q-N" 上 */
function sliceUnits(html) {
  // 先去掉 HTML 注释 —— 注释里也写着 data-pdh-stem 之类，会把正则带偏
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const hits = [...clean.matchAll(/id="q-(\d+)"/g)];
  return hits.map((h, i) => ({
    num: +h[1],
    chunk: clean.slice(h.index, i + 1 < hits.length ? hits[i + 1].index : Math.min(clean.length, h.index + 40000)),
  }));
}

/** 从 pos 处按同名标签配平取出一整个元素（rp-ana 里嵌着 rp-row 的 div，懒惰正则会被截断） */
function sliceBalanced(html, pos, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'g');
  re.lastIndex = pos;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') { if (--depth === 0) return html.slice(pos, m.index + m[0].length); }
    else depth++;
  }
  return html.slice(pos, pos + 20000);
}
/** 解析正文：从 <div|aside class="rp-ana"> 里取配平内容，并丢掉前面的【题目】【翻译】行 */
function parseAnalysis(chunk) {
  const at = chunk.search(/<(?:div|aside) class="rp-ana"/);
  if (at < 0) return '';
  const tag = /^<(div|aside)/.exec(chunk.slice(at))[1];
  const body = sliceBalanced(chunk, at, tag);
  const s = text(body);
  const i = s.search(/【答案】/);
  return (i > 0 ? s.slice(i) : s).trim();
}

function parsePage(html) {
  const qs = [];
  for (const { num, chunk } of sliceUnits(html)) {
    const pick = re => { const m = re.exec(chunk); return m ? text(m[1]) : ''; };
    const options = {};
    for (const m of chunk.matchAll(/data-pdh-letter="([A-O])"[^>]*>([\s\S]*?)<\/span>/g)) options[m[1]] = text(m[2]);
    if (!Object.keys(options).length)
      for (const m of chunk.matchAll(/>([A-O])\)<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/g)) options[m[1]] = text(m[2]);

    const optionCn = {};
    const trans = /class="lqp-trans-choices"[^>]*>([\s\S]*?)<\/ul>/.exec(chunk);
    if (trans) for (const m of trans[1].matchAll(/lqp-trans-letter"[^>]*>([A-O])\)<\/span>\s*([\s\S]*?)<\/li>/g))
      optionCn[m[1]] = text(m[2]);

    qs.push({
      num,
      answer: pick(/class="rp-ans"[^>]*>([\s\S]{0,120}?)<\/strong>/),
      // 听力题干在 rp-stem-en；阅读/长篇的英文题干挂在卷面块的 data-pdh-stem 上。
      // 注意闭合标签要同时认 </span> 和 </div>：阅读题干是 <span data-pdh-stem>，
      // 只写 </div> 会一路吞到选项块（把 A) 开头那段拼进题干）。
      stem: pick(/class="rp-stem-en"[^>]*>([\s\S]*?)<\/p>/) || pick(/data-pdh-stem[^>]*>([\s\S]*?)<\/(?:span|div)>/),
      stemCn: pick(/class="lqp-trans-stem"[^>]*>([\s\S]*?)<\/p>/) || pick(/class="lqp-stem"[^>]*>([\s\S]*?)<\/p>/),
      options, optionCn,
      analysis: parseAnalysis(chunk),
    });
  }
  return qs;
}

/** 选词填空词库 */
function parseWordBank(html) {
  const bank = {};
  for (const m of html.matchAll(/class="select-none"[^>]*>([A-O])\)<\/span><span>([^<]{1,40})<\/span>/g))
    bank[m[1]] = unent(m[2]).trim();
  return bank;
}

/** 听力录音原文：段落锚 id="p-{首题号}-{段序}"，en/zh 成对 */
function parseTranscript(html) {
  const blocks = {};
  for (const m of html.matchAll(/<p id="p-(\d+)-(\d+)" class="lt-en"[^>]*>([\s\S]*?)<\/p>([\s\S]{0,400}?)<\/p>/g)) {
    const first = +m[1];
    const en = text(m[3]).replace(/^\d+\s*/, '');
    const zh = /class="lt-zh"[^>]*>([\s\S]*?)<\/p>/.exec(m[4]);
    (blocks[first] ||= []).push({ en, zh: zh ? text(zh[1]) : '' });
  }
  return blocks;
}

// ---------- 抓取 ----------
// 抓「全部」四六级题型页（含本地没有的套号），这样才能对「第N套」编号做排列匹配：
// 本地套卷是扫描卷 OCR 出来的，站点与本地对「第 N 套」的定义经常不是同一份卷。
const bySet = new Map();
for (const u of sectionUrls) {
  const m = new RegExp(`/cet([46])/sections/(?:listening/)?(\\d{4})-(\\d{2})-(\\d+)/`).exec(u);
  if (!m) continue;
  const key = `cet${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
  if (ONLY && `cet${m[1]}-${m[2]}_${m[3]}_${m[4]}` !== ONLY) continue;
  if (!bySet.has(key)) bySet.set(key, []);
  bySet.get(key).push(u);
}
const raw = p => path.join(RAW, p.replace(ORIGIN + '/', '').replace(/\/$/, '').replace(/\//g, '_') + '.html');
async function get(url) {
  const f = raw(url);
  if (fs.existsSync(f) && fs.statSync(f).size > 5000) return;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cet-bank-fix)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fs.writeFileSync(f, await r.text());
      return;
    } catch (e) {
      if (i === 3) { console.error('FAIL', url, e.message); return; }
      await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
}

const jobs = [...bySet.values()].flat();
console.log(`站点套号 ${bySet.size} · 待抓页面 ${jobs.length}`);
let done = 0;
await Promise.all(Array.from({ length: CONC }, async function worker() {
  while (jobs.length) {
    const u = jobs.pop();
    await get(u);
    if (++done % 100 === 0) console.log(`  ... ${done}`);
  }
}));

// ---------- 聚合 ----------
let written = 0, total = 0;
for (const [key, urls] of bySet) {
  const pages = [];
  for (const url of urls) {
    const f = raw(url);
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8');
    const title = (/<title>(.*?)<\/title>/.exec(html) || [, ''])[1];
    if (/404 · 页面不存在/.test(title)) continue;
    pages.push({
      part: url.replace(ORIGIN + '/', '').replace(/\/$/, '').split('/').slice(3).join('/'),
      url, title,
      questions: parsePage(html),
      wordBank: parseWordBank(html),
      transcript: parseTranscript(html),
    });
  }
  const answers = {};
  for (const p of pages) for (const q of p.questions) if (q.answer) answers[q.num] = q.answer;
  total += Object.keys(answers).length;
  if (pages.length) fs.writeFileSync(path.join(OUT, key + '.json'), JSON.stringify({ key, pages, answers }));
  written++;
}
console.log(`抓取完成；写出 ${written} 套，累计答案 ${total} 条 → ${path.relative(ROOT, OUT)}`);
