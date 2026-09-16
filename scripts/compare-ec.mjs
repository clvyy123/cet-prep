/**
 * 对照 examcrafts 解密数据修正本地题库
 *   node scripts/compare-ec.mjs
 *
 * 输入：.qa/ec/api/_cards.json + .qa/ec/api/ec-<id>.json（解密后的整卷）
 * 输出：.qa/papers/ec-report.md（报告）+ scripts/paper-fixes.json（修正补丁）
 *
 * 站点 JSON 的字段前缀是随机反爬噪声（wkz_/tdb_/ffj_…），全部按「去掉前缀后的字段名」识别。
 * 词库是字母序字符串数组 → 选词填空的答案(单词)按下标换算成 A-O 字母。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API_DIR = '.qa/ec/api';
const OUT_REPORT = '.qa/papers/ec-report.md';
const OUT_FIXES = 'scripts/paper-fixes.json';

/* ---------- 站点 JSON 解析（形状识别） ---------- */
const strip = (k) => k.replace(/^[a-z]{2,5}_(?=[a-zA-Z])/, '');
const fields = (o) =>
  Object.entries(o || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => [strip(k), v]);
const getF = (o, name) => fields(o).find(([n]) => n === name)?.[1];
const getArr = (o, name) => {
  const e = fields(o).find(([n, v]) => n === name && Array.isArray(v));
  return e ? e[1] : null;
};

/** 从根对象里找「内容容器」：自身或其子对象上带 sections 数组 */
const findSectionsRoot = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  const direct = getArr(obj, 'sections');
  if (direct?.length) return { name: '(self)', sections: direct };
  for (const [n, v] of fields(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const secs = getArr(v, 'sections');
      if (secs?.length) return { name: n, sections: secs };
    }
  }
  return null;
};

/** 提取题目数组：题项形如 {id:number, answer:string, options?:string[], question?:string, explanation?:string} */
const isQItem = (it) =>
  it && typeof it === 'object' && Number.isFinite(getF(it, 'id')) && typeof getF(it, 'answer') === 'string' && getF(it, 'answer').length <= 3;

const extractPaper = (data) => {
  const out = { listening: {}, readingA: {}, readingB: {}, readingC: {}, bank: null, translation: null, writing: null, audio: null, transcripts: {} };
  const audioRoot = findSectionsRoot(getF(data, 'audio_content') || {});
  if (audioRoot) {
    for (const sec of audioRoot.sections) {
      const qs = getArr(sec, 'questions') || [];
      for (const q of qs) {
        if (!isQItem(q)) continue;
        out.listening[getF(q, 'id')] = {
          answer: getF(q, 'answer'),
          question: getF(q, 'question') || '',
          options: getF(q, 'options') || [],
          explanation: getF(q, 'explanation') || '',
        };
      }
    }
  }
  const textRoot = findSectionsRoot(getF(data, 'text_content') || {});
  if (textRoot) {
    for (const sec of textRoot.sections) {
      const blanks = getArr(sec, 'blanks');
      if (blanks?.length) {
        // Section A 选词填空：答案是单词，词库是字母序数组 → 下标换字母。
        // 站点的空格 id 可能按段内 1-10 编号（也可能已是绝对题号 26-35），统一归位到 26-35
        const bank = getArr(sec, 'word_bank') || getArr(sec, 'bank') || [];
        out.bank = bank;
        const ids = blanks.map((b) => getF(b, 'id')).filter(Number.isFinite);
        const offset = ids.length && Math.max(...ids) <= 15 ? 25 : 0;
        for (const b of blanks) {
          const id = getF(b, 'id');
          const word = getF(b, 'answer');
          const idx = bank.indexOf(word);
          out.readingA[id + offset] = { answer: idx > -1 ? String.fromCharCode(65 + idx) : '', word, explanation: getF(b, 'explanation') || '' };
        }
        continue;
      }
      const answers = getArr(sec, 'answers');
      if (answers?.length && getF(answers[0], 'paragraphId') !== undefined) {
        // Section B 段落匹配：optionId=题号, paragraphId=段落字母；段内相对编号则归位 36-45
        const ids = answers.map((a) => getF(a, 'optionId')).filter(Number.isFinite);
        const offset = ids.length && Math.max(...ids) <= 15 ? 35 : 0;
        for (const a of answers) {
          if (!isQItem(a)) continue;
          out.readingB[getF(a, 'optionId') + offset] = { answer: getF(a, 'paragraphId'), explanation: getF(a, 'explanation') || '' };
        }
        continue;
      }
      const passages = getArr(sec, 'passages');
      if (passages?.length) {
        // 仔细阅读题号若为段内相对编号（1-20），归位到 46-55 起点
        const allIds = passages.flatMap((p) => (getArr(p, 'questions') || []).map((q) => getF(q, 'id'))).filter(Number.isFinite);
        const offset = allIds.length && Math.max(...allIds) <= 20 ? 45 : 0;
        for (const p of passages) {
          for (const q of getArr(p, 'questions') || []) {
            if (!isQItem(q)) continue;
            out.readingC[getF(q, 'id') + offset] = {
              answer: getF(q, 'answer'),
              question: getF(q, 'question') || '',
              options: getF(q, 'options') || [],
              explanation: getF(q, 'explanation') || '',
            };
          }
        }
      }
    }
  }
  const conv = getF(data, 'convert');
  if (conv && getF(conv, 'reference')) {
    out.translation = { prompt: getF(conv, 'content') || '', reference: getF(conv, 'reference') || '' };
  }
  const au = getF(data, 'audio_urls');
  if (au) {
    out.audio = {};
    for (const [n, v] of fields(au)) {
      if (/^Section [ABC]$/.test(n) && typeof v === 'string' && v.startsWith('http')) out.audio[n.slice(-1)] = v;
    }
  }
  const comp = getF(data, 'composition');
  if (comp) {
    out.writing = {
      sample: getF(comp, 'sample_answer') || '',
      directions: getF(comp, 'directions') || '',
      criteria: getF(comp, 'grading_criteria') || '',
    };
  }
  for (const name of ['news_transcript_en', 'conversations_transcript_en', 'passages_transcript_en']) {
    const v = getF(data, name);
    if (v) out.transcripts[name] = v;
  }
  return out;
};

/* ---------- 卡片 → 本地套卷 id ---------- */
const CN_NUM = { 一: '1', 二: '2', 三: '3', 四: '4' };
const cardToId = (c) => {
  const m = /^(2026|2025|2024|2023|2022|2021|2020)年(\d{1,2})月(四|六)级真题第(.+?)套/.exec(c.title);
  if (!m) return null;
  const level = m[3] === '四' ? 4 : 6;
  const set = CN_NUM[m[4]] ?? m[4];
  return `cet${level}-${m[1]}_${String(m[2]).padStart(2, '0')}_${set}`;
};

/* ---------- 本地题库 ---------- */
const raw = readFileSync('src/data/papers.ts', 'utf8');
const anchor = raw.indexOf('PAPERS: Paper[] = [');
const papers = JSON.parse(raw.slice(raw.indexOf('= [', anchor) + 1, raw.lastIndexOf(']') + 1));
const byId = new Map(papers.map((p) => [p.id, p]));

/* ---------- 比对 ---------- */
const fixes = {};
const stats = { ansFill: 0, ansOverride: 0, ansAgree: 0, anaFill: 0, anaOverride: 0, stemFill: 0, stemOverride: 0, optOverride: 0, matFill: 0, transFill: 0, sampleFill: 0, papersMatched: 0, papersUnmatched: [], noSite: [] };
const report = ['# examcrafts 对照报告', ''];

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** SRT 字幕 → 纯文本（去序号行与时间轴行） */
const srtToText = (s) =>
  s
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** 按 "Questions X-Y are based on…" 分组标记把整场听力文本切成 {from,to,text}[] */
const splitTranscript = (raw) => {
  const text = /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(raw) ? srtToText(raw) : raw;
  const re = /Questions?\s+\d+(?:\s*(?:-|to|and|through)\s*\d+)?\s+are based on[^.]*\./gi;
  const marks = [...text.matchAll(re)];
  if (!marks.length) return null;
  const groups = [];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const nums = (m[0].match(/\d+/g) || []).map(Number);
    groups.push({ from: nums[0], to: nums[nums.length - 1], text: text.slice(start, end).trim() });
  });
  return groups;
};
const similar = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  let hit = 0;
  for (let i = 0; i + 12 <= y.length; i += 12) if (x.includes(y.slice(i, i + 12))) hit++;
  return hit / Math.max(1, Math.ceil(y.length / 12));
};

const cards = JSON.parse(readFileSync(join(API_DIR, '_cards.json'), 'utf8'));
for (const c of cards) {
  const localId = cardToId(c);
  const file = join(API_DIR, `ec-${c.id}.json`);
  if (!localId || !byId.has(localId)) {
    if (localId) stats.papersUnmatched.push(`${c.title} → ${localId}(本地无)`);
    continue;
  }
  if (!existsSync(file)) {
    stats.noSite.push(c.title);
    continue;
  }
  const site = extractPaper(JSON.parse(readFileSync(file, 'utf8')));
  const paper = byId.get(localId);
  const fix = { answers: {}, analyses: {}, stems: {}, options: {}, materials: {}, translation: null, writing: null, banked: null, audio: null };
  let touched = false;

  // 站点题号 → 内容 map（1-55 全并起来，含听力/阅读）
  const siteQ = {};
  for (const [n, q] of [
    ...Object.entries(site.listening),
    ...Object.entries(site.readingA).map(([n, v]) => [n, { ...v, isBanked: true }]),
    ...Object.entries(site.readingB),
    ...Object.entries(site.readingC),
  ]) {
    siteQ[n] = q;
  }
  // 听力原文分组缓存（按类型切好的题号区间 → 文本）
  const transcriptGroups = {};

  // 站点优先原则：站点是人工校验的数据源，所有字段一律以站点为准（本地仅作站点缺项时的兜底）。
  // 答案不一致不再做映射可靠性校验，直接按站点修正并记录。
  for (const sec of paper.sections) {
    for (const b of sec.blocks) {
      // 选词填空：词库以站点为准整体替换
      if (b.wordBank && site.bank?.length === 15) {
        const ours = Object.values(b.wordBank).map((w) => norm(w));
        const theirs = site.bank.map((w) => norm(w));
        const sameOrder = ours.length === 15 && ours.every((w, i) => w === theirs[i]);
        if (!sameOrder) {
          fix.banked = { bank: site.bank };
          touched = true;
        }
      }
      for (const q of b.questions) {
        const s = siteQ[q.num];
        if (!s) continue;
        // 1. 答案：无条件以站点为准
        if (s.answer && /^[A-O]$/.test(s.answer)) {
          fix.answers[q.num] = s.answer;
          touched = true;
          if (!q.answer) {
            stats.ansFill++;
          } else if (q.answer !== s.answer) {
            stats.ansOverride++;
            report.push(`- ✅ 答案修正 [${paper.id}] #${q.num}: ${q.answer} → ${s.answer}`);
          } else {
            stats.ansAgree++;
          }
        }
        // 2. 解析：站点有就用站点的
        if (s.explanation) {
          if (q.analysis && q.analysis !== s.explanation) stats.anaOverride++;
          else if (!q.analysis) stats.anaFill++;
          fix.analyses[q.num] = s.explanation;
          touched = true;
        }
        // 3. 题干：站点题目文本为准（选词填空无题干概念，跳过）
        if (s.question && !s.isBanked) {
          if (q.stem && norm(q.stem) !== norm(s.question)) stats.stemOverride++;
          else if (!q.stem) stats.stemFill++;
          fix.stems[q.num] = s.question;
          touched = true;
        }
        // 4. 选项：站点选项为准
        if (s.options?.length && !s.isBanked) {
          const opts = {};
          s.options.forEach((t, i) => {
            const m = /^([A-O])[.、)]\s*(.*)$/.exec(t);
            if (m) opts[m[1]] = m[2] || t;
            else opts[String.fromCharCode(65 + i)] = t;
          });
          const localOpts = JSON.stringify(q.options || {});
          if (localOpts !== JSON.stringify(opts)) stats.optOverride++;
          fix.options[q.num] = opts;
          touched = true;
        }
      }
      // 5. 听力原文：站点 transcripts 是「整场听力的 SRT 字幕」（可能带时间轴）。
      //    纯文本化后按 "Questions X-Y are based on…" 分组标记切开，按题号归位到对应分组块
      if (sec.partNo === 'II') {
        const type = /News/i.test(b.label) ? 'news_transcript_en' : /Conversation/i.test(b.label) ? 'conversations_transcript_en' : 'passages_transcript_en';
        const raw = site.transcripts[type];
        if (raw) {
          if (!transcriptGroups[type]) transcriptGroups[type] = splitTranscript(raw);
          const nums = b.questions.map((q) => q.num);
          const lo = nums.length ? Math.min(...nums) : 0;
          const g = (transcriptGroups[type] || []).find((grp) => lo >= grp.from && lo <= grp.to);
          const text = g?.text || '';
          if (text && norm(b.material || '') !== norm(text)) {
            fix.materials[b.id] = text;
            touched = true;
          }
        }
      }
    }
  }
  // 6. 翻译：站点原文/参考译文为准
  const tSec = paper.sections.find((s) => s.partNo === 'IV');
  if (site.translation && tSec) {
    const tb = tSec.blocks[0];
    const f = {};
    if (site.translation.prompt && norm(tb.prompt) !== norm(site.translation.prompt)) f.prompt = site.translation.prompt;
    if (site.translation.reference && norm(tb.reference) !== norm(site.translation.reference)) f.reference = site.translation.reference;
    if (Object.keys(f).length) {
      fix.translation = f;
      stats.transFill++;
      touched = true;
    }
  }
  // 7. 写作：站点范文/题目为准
  const wSec = paper.sections.find((s) => s.partNo === 'I');
  if (site.writing?.sample && wSec) {
    const wb = wSec.blocks[0];
    const f = {};
    if (norm(wb.sample) !== norm(site.writing.sample)) f.sample = site.writing.sample;
    const sitePrompt = (site.writing.directions || '').replace(/^Directions[:：]\s*/i, '');
    if (sitePrompt && norm(wb.prompt) !== norm(sitePrompt)) f.prompt = sitePrompt;
    if (Object.keys(f).length) {
      fix.writing = f;
      stats.sampleFill++;
      touched = true;
    }
  }

  // 8. 听力音频 URL（本地已下载的 mp3 才会进 build，见 download-ec-audio.mjs）
  if (site.audio) {
    fix.audio = site.audio;
    touched = true;
  }

  if (touched || Object.keys(fix.answers).length) {
    fixes[localId] = fix;
    stats.papersMatched++;
  }
}

report.unshift(
  '# examcrafts 对照报告（站点优先原则：所有字段以站点为准）',
  '',
  `- 答案回填：${stats.ansFill}`,
  `- 答案一致：${stats.ansAgree}`,
  `- 答案修正（按站点覆盖）：${stats.ansOverride}`,
  `- 解析回填：${stats.anaFill}（站点覆盖：${stats.anaOverride || 0}）`,
  `- 题干回填：${stats.stemFill}（站点覆盖：${stats.stemOverride || 0}）`,
  `- 选项按站点覆盖：${stats.optOverride || 0} 题`,
  `- 听力原文回填：${stats.matFill}`,
  `- 翻译补全：${stats.transFill}`,
  `- 范文/题目补全：${stats.sampleFill}`,
  `- 有修正的套卷：${stats.papersMatched}`,
  `- 站点有但本地没有/未匹配：${stats.papersUnmatched.length}`,
  `- 站点无内容文件：${stats.noSite.length}`,
  ''
);

writeFileSync(OUT_REPORT, report.join('\n'), 'utf8');
// fixes 是 build-papers.mjs 的常驻输入（站点答案 = 权威答案源），必须与已有内容合并、
// 只增不删 —— 否则本地应用过修正后重跑比对会得到空 diff，把已修正的答案清掉
const prev = existsSync(OUT_FIXES) ? JSON.parse(readFileSync(OUT_FIXES, 'utf8')) : {};
const merged = { ...prev };
for (const [id, f] of Object.entries(fixes)) {
  merged[id] = {
    answers: { ...(prev[id]?.answers || {}), ...f.answers },
    analyses: { ...(prev[id]?.analyses || {}), ...f.analyses },
    stems: { ...(prev[id]?.stems || {}), ...f.stems },
    options: { ...(prev[id]?.options || {}), ...f.options },
    // materials 完全由当前站点数据推导，不用 prev —— 否则旧的整段 SRT 会残留
    materials: { ...(f.materials || {}) },
    translation: f.translation || prev[id]?.translation || null,
    writing: f.writing || prev[id]?.writing || null,
    banked: f.banked || prev[id]?.banked || null,
    audio: f.audio || prev[id]?.audio || null,
  };
}
writeFileSync(OUT_FIXES, JSON.stringify(merged, null, 1), 'utf8');
console.log(report.join('\n'));
console.log('fixes ->', OUT_FIXES);
