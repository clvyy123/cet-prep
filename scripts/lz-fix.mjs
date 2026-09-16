#!/usr/bin/env node
// 用 english-exam.lazynote.cn 的站点数据修正本地题库（papers.ts / builtin-banks.ts）
//
//   node scripts/lz-fix.mjs                # dry-run：出统计 + .qa/lazynote/fixes.json
//   node scripts/lz-fix.mjs --apply        # 落盘（先备份 .qa/lazynote/*.bak2）
//
// 站点逐题给出答案 / 题干 / 选项 / 中译 / 解析 / 录音原文，是人工整理的权威源。
//
// 两条实测经验（别改回去）：
//  1. 本地卷面来自扫描件 OCR，选项**字母顺序常与官方卷不同**（同一组选项被打乱）。
//     所以「答案是否一致」不能比字母，要比**选项原文**：先看站点说哪个文本对，
//     再在本地选项里找同文本的字母。只按字母比会把 100% 正确的题判成 58% 错。
//  2. 套卷对齐同样按「选项原文集合」（与顺序无关）比对，比按答案比稳得多。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LZ = path.join(ROOT, '.qa', 'lazynote');
const APPLY = process.argv.includes('--apply');
const MIN_RATIO = 0.8;   // 选项相似度均值门槛（词元 Dice），低于此判为「对不上」

const norm = t => { const m = /^\s*([A-O])\s*[).、]?/.exec(t || ''); return m ? m[1] : ''; };
const nrm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const toks = s => new Set((s || '').toLowerCase().match(/[a-z0-9]+/g) || []);
/** 词元 Dice 相似度：容忍 OCR 把个别词串错 */
const dice = (a, b) => {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
};
/** 两道题的四选项有多像：取「本地每个选项都能在站点选项里找到近邻」的比例 */
const qsim = (lo, so) => {
  const l = Object.values(lo || {}), s = Object.values(so || {});
  if (l.length < 2 || l.length !== s.length) return 0;
  const used = new Set();
  let hit = 0;
  for (const x of l) for (let i = 0; i < s.length; i++) {
    if (used.has(i) || dice(x, s[i]) < 0.6) continue;
    used.add(i); hit++; break;
  }
  return hit / l.length;
};
const kindOf = n => (n <= 25 ? 'listening' : n <= 35 ? 'banked' : n <= 45 ? 'long' : 'reading');
const pct = r => +(r * 100).toFixed(0);

function loadTs(file, marker) {
  const s = fs.readFileSync(file, 'utf8');
  const eq = s.indexOf('=', s.indexOf(marker));
  const a = s.indexOf('[', eq), b = s.lastIndexOf(']');
  return { file, prefix: s.slice(0, a), suffix: s.slice(b + 1), arr: JSON.parse(s.slice(a, b + 1)) };
}
const saveTs = t => fs.writeFileSync(t.file, t.prefix + JSON.stringify(t.arr, null, 2) + t.suffix);
function backup(file) {
  if (!APPLY) return;
  const bak = path.join(LZ, path.basename(file) + '.bak2');
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

// ---------- 站点数据 ----------
const SITE = [];
for (const f of fs.readdirSync(path.join(LZ, 'extract'))) {
  if (!/^cet[46]-\d{4}-\d{2}-\d+\.json$/.test(f)) continue;
  const j = JSON.parse(fs.readFileSync(path.join(LZ, 'extract', f), 'utf8'));
  const m = /^cet([46])-(\d{4})-(\d{2})-(\d+)$/.exec(j.key);
  const answers = {}, words = {};
  for (const [n, v] of Object.entries(j.answers)) {
    const l = norm(v); if (!l) continue;
    answers[n] = l;
    words[n] = v.replace(/^\s*[A-O]\s*[).、]\s*/, '').trim();
  }
  const wordBank = {}, qs = {}, transcripts = {};
  for (const p of j.pages) {
    Object.assign(wordBank, p.wordBank || {});
    Object.assign(transcripts, p.transcript || {});
    for (const q of p.questions) qs[q.num] = q;
  }
  SITE.push({ key: j.key, level: +m[1], year: +m[2], month: +m[3], no: +m[4], answers, words, wordBank, qs, transcripts });
}
const byKey = k => SITE.find(s => s.key === k);

/** 站点某题的正确答案「文本」→ 在给定选项表里找出对应字母（顺序无关） */
const letterByText = (options, siteLetter, siteOptions) => {
  const target = siteOptions?.[siteLetter];
  if (!target) return '';
  const exact = Object.entries(options || {}).find(([, v]) => nrm(v) && nrm(v) === nrm(target));
  if (exact) return exact[0];
  let best = '', bs = 0.75;
  for (const [L2, v] of Object.entries(options || {})) { const d = dice(v, target); if (d > bs) { bs = d; best = L2; } }
  return best;
};
/** 站点字母 → 本地字母（按选项原文配对） */
const letterMap = (localOptions, siteOptions) => {
  const m = {};
  for (const [SL, v] of Object.entries(siteOptions || {})) {
    const t = nrm(v);
    if (!t) continue;
    const hit = Object.entries(localOptions || {}).find(([, x]) => nrm(x) === t);
    if (hit) m[SL] = hit[0];
  }
  return m;
};

/** 套卷对齐：按选项原文集合（与顺序无关）算相似度；选项不足时退化到答案字母 */
function align(level, year, month, localAns, localOpt) {
  const cands = SITE.filter(s => s.level === level && s.year === year && s.month === month);
  if (!cands.length) return { ok: false, why: '站点无同年月数据' };
  let best = null;
  for (const c of cands) {
    const oK = Object.keys(localOpt).filter(n => c.qs[n]?.options);
    const keys = oK.length >= 6 ? oK : Object.keys(localAns).filter(n => c.answers[n]);
    if (!keys.length) continue;
    const agree = oK.length >= 6
      ? keys.reduce((a, n) => a + qsim(localOpt[n], c.qs[n].options), 0)
      : keys.filter(n => localAns[n] === c.answers[n]).length;
    const ratio = agree / keys.length;
    if (!best || ratio > best.ratio) best = { set: c, ratio, overlap: keys.length, agree, by: oK.length >= 6 ? '选项原文' : '答案字母' };
  }
  if (!best) return { ok: false, why: '站点套卷无可比内容' };
  if (best.overlap < 6) return { ok: false, why: `可比题量不足（${best.overlap} 题，站点第${best.set.no}套）` };
  if (best.ratio < MIN_RATIO) return { ok: false, why: `最高一致率 ${pct(best.ratio)}%（站点第${best.set.no}套，按${best.by}比 ${best.agree}/${best.overlap}）`, best };
  return { ok: true, ...best };
}
function nearestAnywhere(level, localOpt) {
  let best = null;
  for (const s of SITE) {
    if (s.level !== level) continue;
    const keys = Object.keys(localOpt).filter(n => s.qs[n]?.options);
    if (keys.length < 6) continue;
    const ratio = keys.reduce((a, n) => a + qsim(localOpt[n], s.qs[n].options), 0) / keys.length;
    if (!best || ratio > best.ratio) best = { key: s.key, ratio, overlap: keys.length };
  }
  return best;
}

// ---------- 修正 ----------
const stats = {}, ops = [], skipped = [], aligned = [];
const bump = (t, file, setId, num, from, to) => {
  stats[t] = (stats[t] || 0) + 1;
  ops.push({ file, setId, num, kind: kindOf(Number(num)) || String(num), type: t, from, to });
};

// ===== papers.ts =====
const papers = loadTs(path.join(ROOT, 'src/data/papers.ts'), 'PAPERS: Paper[] =');
backup(papers.file);
for (const p of papers.arr) {
  const localAns = {}, localOpt = {};
  for (const sec of p.sections) for (const bl of sec.blocks || []) for (const q of bl.questions || []) {
    const l = norm(q.answer); if (l) localAns[q.num] = l;
    if (Object.keys(q.options || {}).length > 1) localOpt[q.num] = q.options;
  }
  const a = align(p.level, p.year, p.month, localAns, localOpt);
  if (!a.ok) { skipped.push({ file: 'papers.ts', setId: p.id, why: a.why, nearest: a.best ? null : nearestAnywhere(p.level, localOpt) }); continue; }
  const s = a.set;
  aligned.push({ file: 'papers.ts', setId: p.id, siteSet: s.key, ratio: pct(a.ratio), overlap: a.overlap, by: a.by, sameNo: s.no === +(/第(\d+)套/.exec(p.setNo)?.[1] || 0) });

  for (const sec of p.sections) for (const bl of sec.blocks || []) for (const q of bl.questions || []) {
    const num = q.num, sq = s.qs[num], siteAns = s.answers[num];
    const kind = kindOf(num);
    const la = norm(q.answer);

    if (siteAns) {
      // 按「正确选项的原文」在本地选项里定位字母（本地选项顺序可能与官方不同）
      let target = '';
      if (kind === 'banked') {
        // 只用本地词库做「词 → 字母」定位；本地词库里没这个词就跳过这一空
        // （站点有几套的干扰词与本地不同，如 operating / type，无法判定谁对，不动词库）
        const w = s.words[num];
        target = Object.entries(bl.wordBank || {}).find(([, v]) => nrm(v) === nrm(w))?.[0] || '';
      } else if (Object.keys(q.options || {}).length > 1) {
        target = letterByText(q.options, siteAns, sq?.options);
      }
      if (!target) target = siteAns;                 // 无选项可比（长篇阅读 / 选词填空无词库）→ 用站点字母
      if (!la) bump('ADD_ANSWER', 'papers.ts', p.id, num, '', target);
      else if (la !== target) bump('FIX_ANSWER', 'papers.ts', p.id, num, `${la} …`, `${target} …`);
      q.answer = target;
    }
    if (sq) {
      // 选词填空 / 长篇阅读的选项就是 A–O 字母格，不补选项、不挂中译
      // （站点页面上这类题的 options 字段抓到的是解析里的「竞争词」，不是选项）
      if (kind === 'listening' || kind === 'reading') {
        // 本地缺哪个字母就补哪个字母（能对上原文的跳过）；中译一律按「选项原文」挂到本地字母上
        const map = letterMap(q.options, sq.options);
        for (const [SL, v] of Object.entries(sq.options || {})) {
          if (!v || map[SL] || q.options?.[SL]) continue;
          bump('ADD_OPTION', 'papers.ts', p.id, num, SL, v);
          (q.options ||= {})[SL] = v; map[SL] = SL;
        }
        for (const [SL, v] of Object.entries(sq.optionCn || {})) {
          const ll = map[SL];
          if (!v || !ll || q.optionCn?.[ll]) continue;
          bump('ADD_OPTION_CN', 'papers.ts', p.id, num, ll, v);
          (q.optionCn ||= {})[ll] = v;
        }
      }
      if (sq.stemCn && !q.stemCn) { bump('ADD_STEM_CN', 'papers.ts', p.id, num, '', sq.stemCn); q.stemCn = sq.stemCn; }
      if (sq.analysis && !q.analysis) { bump('ADD_ANALYSIS', 'papers.ts', p.id, num, '', sq.analysis.slice(0, 80)); q.analysis = sq.analysis; }
    }
    if (kind === 'listening' && !bl.material && s.transcripts[num]) {
      const tx = s.transcripts[num].map((x, i) => `${i + 1}. ${x.en}`).join('\n');
      bump('ADD_TRANSCRIPT', 'papers.ts', p.id, num, '', tx.slice(0, 80));
      bl.material = tx;
    }
  }
}

// ===== builtin-banks.ts =====
const banks = loadTs(path.join(ROOT, 'src/data/builtin-banks.ts'), 'BUILTIN_BANKS: BuiltinBank[] =');
backup(banks.file);
const arrOpts = o => (Array.isArray(o) ? Object.fromEntries(o.map((v, i) => [String.fromCharCode(65 + i), v])) : (o || {}));

for (const b of banks.arr) {
  const key = b.meta.id.replace(/^bi-/, '').replace(/_/g, '-');
  const s0 = byKey(key);
  const localAns = {}, localOpt = {};
  const addQ = q => {
    const l = norm(q.answer); if (l) localAns[q.num] = l;
    const o = arrOpts(q.options); if (Object.keys(o).length > 1) localOpt[q.num] = o;
  };
  for (const it of b.listening || []) for (const q of it.questions || []) addQ(q);
  for (const it of b.reading || []) for (const q of it.questions || []) addQ(q);
  for (const it of b.long || []) for (const st of it.statements || []) { const l = norm(st.answer); if (l) localAns[st.num] = l; }

  if (!s0) { skipped.push({ file: 'builtin-banks.ts', setId: key, why: '站点无此套卷' }); continue; }
  const a = align(b.meta.level, s0.year, s0.month, localAns, localOpt);
  if (!a.ok) { skipped.push({ file: 'builtin-banks.ts', setId: key, why: a.why, nearest: a.best ? null : nearestAnywhere(b.meta.level, localOpt) }); continue; }
  const s = a.set;
  aligned.push({ file: 'builtin-banks.ts', setId: key, siteSet: s.key, ratio: pct(a.ratio), overlap: a.overlap, by: a.by, sameNo: s.no === s0.no });
  const tag = (t, num, from, to) => bump(t, 'builtin-banks.ts', key, num, from, to);

  for (const [arr, kind] of [['listening', 'listening'], ['reading', 'reading']])
    for (const it of b[arr] || []) for (const q of it.questions || []) {
      const sq = s.qs[q.num], siteAns = s.answers[q.num], la = norm(q.answer);
      if (siteAns) {
        const target = letterByText(arrOpts(q.options), siteAns, sq?.options) || siteAns;
        if (!la) tag('ADD_ANSWER', q.num, '', target);
        else if (la !== target) tag('FIX_ANSWER', q.num, `${la} …`, `${target} …`);
        q.answer = target;
      }
      // 注意：内置题库的 ListeningQuestion / ReadingQuestion 没有 stemCn 字段，
      //       模拟考试页也不渲染题干译文 —— 不补，补了是死数据
      if (sq?.analysis && !q.analysis) { tag('ADD_ANALYSIS', q.num, '', '…'); q.analysis = sq.analysis; }
      if (kind === 'listening' && !it.transcript && s.transcripts[q.num]) {
        const tx = s.transcripts[q.num].map((x, i) => `${i + 1}. ${x.en}`).join('\n');
        tag('ADD_TRANSCRIPT', q.num, '', tx.slice(0, 80));
        it.transcript = tx;
      }
    }
  for (const it of b.long || []) for (const st of it.statements || []) {
    const siteAns = s.answers[st.num], la = norm(st.answer);
    if (!siteAns) continue;
    if (!la) tag('ADD_ANSWER', st.num, '', siteAns);
    else if (la !== siteAns) tag('FIX_ANSWER', st.num, `${la} …`, `${siteAns} …`);
    st.answer = siteAns;
    if (s.qs[st.num]?.analysis && !st.analysis) { tag('ADD_ANALYSIS', st.num, '', '…'); st.analysis = s.qs[st.num].analysis; }
  }
  for (const it of b.banked || []) {
    if (!Array.isArray(it.answers)) continue;
    it.answers.forEach((w, i) => {
      const num = 26 + i, sw = s.words[num], sl = s.answers[num];
      if (!sw || !sl) return;
      if (!w) { tag('ADD_ANSWER', num, '', `${sl}) ${sw}`); it.answers[i] = sw; }
      else if (w !== sw) { tag('FIX_ANSWER', num, w, `${sl}) ${sw}`); it.answers[i] = sw; }
    });
  }
}

if (APPLY) { saveTs(papers); saveTs(banks); }

// ---------- 自检：修正后，两套库在同一套卷上的正确答案应指向同一段文本 ----------
// （修正前两库分歧 428 条；这条检查失败就说明有内容映射跑偏）
const paperByKey = new Map(papers.arr.map(p => [p.id, p]));
let cmpN = 0, cmpAgree = 0;
for (const b of banks.arr) {
  const p = paperByKey.get(b.meta.id.replace(/^bi-/, '')); if (!p) continue;
  const pq = {}, bq = {};
  for (const sec of p.sections) for (const bl of sec.blocks || []) for (const q of bl.questions || [])
    if (q.answer) pq[q.num] = q.options?.[q.answer] || q.answer;
  for (const arr of ['listening', 'reading']) for (const it of b[arr] || []) for (const q of it.questions || [])
    if (q.answer) bq[q.num] = arrOpts(q.options)[q.answer] || q.answer;
  for (const it of b.long || []) for (const st of it.statements || []) if (st.answer) bq[st.num] = st.answer;
  for (const n of Object.keys(bq)) {
    if (!pq[n] || !bq[n]) continue;
    cmpN++;
    const a = pq[n], c = bq[n];
    if (a.length < 3 || c.length < 3 ? a === c : dice(a, c) >= 0.6) cmpAgree++;
  }
}

// dry-run 写 fixes.dryrun.json，避免把 --apply 生成的权威修正清单覆盖成空表
fs.writeFileSync(path.join(LZ, APPLY ? 'fixes.json' : 'fixes.dryrun.json'), JSON.stringify({ stats, aligned, skipped, ops }, null, 1));
console.log(`${APPLY ? '已落盘' : 'dry-run'}  ` + Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`对齐 ${aligned.length} 套（套号同名 ${aligned.filter(a => a.sameNo).length}）· 跳过 ${skipped.length} 套 · 修正 ${ops.length} 条`);
console.log(`自检：两库同卷答案一致 ${cmpAgree}/${cmpN} = ${pct(cmpAgree / cmpN)}%（修正前 428 条分歧）`);
console.log('跳过明细：');
for (const s of skipped) console.log(`  [${s.file === 'papers.ts' ? '试卷' : '模拟'}] ${s.setId}: ${s.why}` + (s.nearest ? `；全站最相似 = ${s.nearest.key} (${pct(s.nearest.ratio)}%)` : ''));
