/**
 * 题库修复流水线 —— 一次性修正 papers.ts 里的四类问题
 *
 *   1. 选项缺失  — 从真题卷 OCR 原文回填丢失的 C/D 选项与词库条目
 *   2. 空格间断  — 修复英文词间空格被吞（OCR 粘连）与多余空格
 *   3. 内容冗余  — 清掉页眉页脚、广告、译文前缀、混入解析的词汇表
 *   4. 信息缺失  — 回填可确定的答案（长篇阅读 / answers.json 已核验项）
 *
 * 用法：node scripts/fix-question-bank.mjs [--apply] [--report out.json]
 *       默认只跑 dry-run 并打印统计；加 --apply 才写回 src/data/papers.ts
 */
import fs from 'node:fs';
import { loadTestOcr } from './lib-parse-testocr.mjs';
import { fixEnSpacing, buildVocab } from './lib-spacing.mjs';

const APPLY = process.argv.includes('--apply');
const repArg = process.argv.indexOf('--report');
const REPORT = repArg !== -1 ? process.argv[repArg + 1] : null;

const FILE = 'src/data/papers.ts';
const t = fs.readFileSync(FILE, 'utf8');
const arrStart = t.indexOf('Paper[] = [') + 'Paper[] = '.length;
const arrEnd = t.lastIndexOf('];');
const PAPERS = JSON.parse(t.slice(arrStart, arrEnd + 1));

const log = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* =========================================================
 * 词典（供空格修复用）
 * ======================================================= */
buildVocab(PAPERS);

/* =========================================================
 * 阶段 1：选项缺失 —— 从真题卷 OCR 原文回填
 * ======================================================= */
const s1 = { filled: 0, spaced: 0, wordBank: 0, papers: 0, detail: [] };

for (const p of PAPERS) {
  const key = p.id.replace(/^cet[46]-/, '');
  const src = loadTestOcr(p.level, key);
  if (!src) continue;
  s1.papers++;

  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      // 选词填空词库
      if (b.id.includes('banked') && b.wordBank) {
        for (const [L, w] of Object.entries(src.wordBank)) {
          const cur = b.wordBank[L];
          if (!cur || !String(cur).trim()) {
            b.wordBank[L] = w;
            s1.wordBank++;
            s1.detail.push(`${p.id} 词库补 ${L}) ${w}`);
          } else if (normKey(cur) !== normKey(w) && normKey(cur) === normKey(w).slice(0, 0) + normKey(cur)) {
            /* 内容一致只是大小写不同，不动 */
          } else if (String(cur).includes(' ') && normKey(cur) === normKey(w)) {
            b.wordBank[L] = w; // 词内多了空格
            s1.wordBank++;
          }
        }
      }

      for (const q of b.questions || []) {
        if (b.id.includes('banked') || b.id.includes('long')) continue;
        const want = src.options.get(q.num);
        if (!want) continue;
        q.options = q.options || {};
        for (const L of ['A', 'B', 'C', 'D']) {
          if (!want[L]) continue;
          const cur = q.options[L];
          if (!cur || !String(cur).trim()) {
            q.options[L] = want[L];
            s1.filled++;
            s1.detail.push(`${p.id} ${b.id}#${q.num} 补选项 ${L}: ${want[L]}`);
          } else if (String(cur) !== want[L] && normKey(cur) === normKey(want[L])) {
            q.options[L] = want[L]; // 仅空格差异，用卷面原文纠正
            s1.spaced++;
          }
        }
        // 选项顺序统一 A B C D
        if (Object.keys(q.options).length === 4) {
          q.options = { A: q.options.A, B: q.options.B, C: q.options.C, D: q.options.D };
        }
      }
    }
  }
}
say(`\n[阶段1] 选项回填：覆盖 ${s1.papers} 套，补回缺失选项 ${s1.filled} 个，修正空格 ${s1.spaced} 处，补词库 ${s1.wordBank} 项`);
s1.detail.slice(0, 20).forEach((d) => say('   · ' + d));

/* =========================================================
 * 1b：选项字母归一化
 * OCR 会把 C) 认成 O)，选项键变成 A/B/D/O；四选一的键集合必须是 A–D，按字母序重排还原。
 * ======================================================= */
const s1b = { fixed: 0, detail: [] };
for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      if (b.id.includes('banked') || b.id.includes('long')) continue;
      for (const q of b.questions || []) {
        const keys = Object.keys(q.options || {}).sort();
        if (keys.length !== 4 || keys.every((k) => 'ABCD'.includes(k))) continue;
        const remap = {};
        keys.forEach((k, i) => (remap['ABCD'[i]] = q.options[k]));
        const old = q.answer;
        if (old && keys.includes(old)) q.answer = 'ABCD'[keys.indexOf(old)];
        q.options = remap;
        s1b.fixed++;
        s1b.detail.push(`${p.id} ${b.id}#${q.num} 选项键 ${keys.join('')} → ABCD（答案 ${old}→${q.answer}）`);
      }
    }
  }
}
say(`[阶段1b] 选项字母归一化：${s1b.fixed} 题`);
s1b.detail.slice(0, 8).forEach((d) => say('   · ' + d));

/* =========================================================
 * 阶段 2：空格间断
 * ======================================================= */
const s2 = { changed: 0, fields: 0, samples: [] };
const SPACING_FIELDS = ['material', 'prompt', 'reference', 'sample'];

function applySpacing(paperId, label, obj, field) {
  const v = obj[field];
  if (typeof v !== 'string' || !v.trim()) return;
  const nv = fixEnSpacing(v);
  if (nv !== v) {
    s2.changed++;
    s2.fields++;
    if (s2.samples.length < 15) s2.samples.push(`${paperId} ${label}.${field}`);
    obj[field] = nv;
  }
}

for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      for (const f of SPACING_FIELDS) applySpacing(p.id, b.id, b, f);
      for (const [L, w] of Object.entries(b.wordBank || {})) {
        const nw = fixEnSpacing(w);
        if (nw !== w) {
          b.wordBank[L] = nw;
          s2.changed++;
        }
      }
      for (const q of b.questions || []) {
        if (typeof q.stem === 'string' && q.stem) {
          const nv = fixEnSpacing(q.stem);
          if (nv !== q.stem) {
            q.stem = nv;
            s2.changed++;
          }
        }
        for (const [L, v] of Object.entries(q.options || {})) {
          if (typeof v !== 'string') continue;
          const nv = fixEnSpacing(v);
          if (nv !== v) {
            q.options[L] = nv;
            s2.changed++;
          }
        }
      }
    }
  }
}
say(`\n[阶段2] 空格间断：修复 ${s2.changed} 处（涉及 ${s2.fields} 个篇章字段）`);
s2.samples.forEach((d) => say('   · ' + d));

/* =========================================================
 * 阶段 3：内容冗余
 * ======================================================= */
const s3 = { stemPrefix: 0, pageNo: 0, ad: 0, vocab: 0, dup: 0 };

const stripPageNo = (s) => s.replace(/[【\[]\s*第\s*\d+\s*页\s*[\]】]/g, ' ');

/** 解析里混入的词汇表：`·cholesteroln.胆固醇 ·simvastatinn.辛伐他汀` 连成一片 */
const VOCAB_RUN = /(?:[·•・]\s*[A-Za-z][A-Za-z\s'-]{1,20}\s*(?:adj|adv|n|v|vt|vi|prep|conj|pron|num|art|int)\s*[.．:：]\s*[^\s·•][^\n·•]{0,40}\s*){2,}/g;

const cleanAnalysis = (s) => {
  let o = String(s || '');
  o = stripPageNo(o);
  o = o.replace(VOCAB_RUN, ' ');
  o = o.replace(/^\s*(?:答案解[折析]|答案解析|解析|答案)\s*[:：]?\s*/, '');
  o = o.replace(/\s{2,}/g, ' ').trim();
  return o;
};

for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      for (const f of ['sampleCn', 'translationCn', 'analysisOverview', 'material', 'reference']) {
        if (typeof b[f] !== 'string') continue;
        const o0 = b[f];
        let o = stripPageNo(o0);
        // 范文/译文尾部夹带的「老师讲解视频」广告
        o = o.replace(/老师说[\s\S]{0,300}?一睹为快吧[!！]?/g, ' ');
        o = o.replace(/[^\n]{0,80}(扫描|扫一扫)[^\n]{0,40}二维码[^\n]{0,120}/g, ' ');
        if (o !== o0) {
          b[f] = o.replace(/\s{2,}/g, ' ').trim();
          s3.ad++;
        }
      }
      for (const q of b.questions || []) {
        if (typeof q.stemCn === 'string' && q.stemCn) {
          const o = q.stemCn.replace(/^\s*(?:题干译文|题干翻译)\s*[:：]?\s*/, '');
          if (o !== q.stemCn) {
            q.stemCn = o;
            s3.stemPrefix++;
          }
        }
        if (typeof q.analysis === 'string' && q.analysis) {
          const o = cleanAnalysis(q.analysis);
          if (o !== q.analysis) {
            if (VOCAB_RUN.test(q.analysis)) s3.vocab++;
            s3.dup++;
            q.analysis = o;
          }
        }
      }
    }
  }
}
say(`\n[阶段3] 内容冗余：译文前缀 ${s3.stemPrefix} 处，广告/页码 ${s3.ad} 处，解析清洗 ${s3.dup} 处（其中混入词汇表 ${s3.vocab} 处）`);

/* =========================================================
 * 阶段 4：信息缺失 —— 回填答案
 * ======================================================= */
const s4 = { fromAnalysis: 0, fromAnswers: 0, fromSrc: 0, unresolved: [] };

/** 从解析文本里找长篇阅读答案：`答案解折 G。` / `定位到G段` / `答案 G` */
function answerFromText(txt) {
  if (!txt) return null;
  const cands = [];
  for (const m of String(txt).matchAll(/(?:答案解[折析]|答案|【答案】)\s*[:：]?\s*([A-O])\b/g)) cands.push(m[1]);
  for (const m of String(txt).matchAll(/^\s*([A-O])\s*[。．.]/gm)) cands.push(m[1]);
  if (!cands.length) return null;
  const uniq = [...new Set(cands)];
  return uniq.length === 1 ? uniq[0] : null;
}

/** 长篇阅读：解析里会写「定位到文章 F) 段」/「L) 段最后一句」 */
function longAnswerFromText(txt) {
  if (!txt) return null;
  const cands = [];
  for (const m of String(txt).matchAll(/([A-O])\s*[)）]\s*段/g)) cands.push(m[1]);
  for (const m of String(txt).matchAll(/定位到(?:文章)?\s*([A-O])\b/g)) cands.push(m[1]);
  for (const m of String(txt).matchAll(/^\s*([A-O])\s*[)）]/gm)) cands.push(m[1]);
  if (!cands.length) return null;
  const uniq = [...new Set(cands)];
  return uniq.length === 1 ? uniq[0] : null;
}

/**
 * 选词填空：解析里一定会出现「X) 单词」且该单词在词库里
 * （OCR 常把字母认错，如「巳) housed」，所以反过来用词去定位字母）
 */
function bankedAnswerFromText(txt, wordBank) {
  if (!txt || !wordBank) return null;
  const words = new Set(Object.values(wordBank).map((w) => String(w).toLowerCase()));
  const cands = [];
  for (const m of String(txt).matchAll(/([A-O])\s*[)）]\s*([A-Za-z][a-z-]{1,20})/g)) {
    if (words.has(m[2].toLowerCase())) cands.push(m[1]);
  }
  if (!cands.length) return null;
  const uniq = [...new Set(cands)];
  return uniq.length === 1 ? uniq[0] : uniq[0];
}

/** 已核验答案文件 scripts/.download/<level>/<key>/answers.json（只认 _verified） */
function loadVerifiedAnswers(p) {
  const key = p.id.replace(/^cet[46]-/, '');
  const f = `scripts/.download/${p.level === 4 ? 'cet4' : 'cet6'}/${key}/answers.json`;
  if (!fs.existsSync(f)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(j._verified)) return null;
    return { json: j, ok: new Set(j._verified.map(String)) };
  } catch {
    return null;
  }
}

/** 逐题解析原文 scripts/.download/<level>/<key>/analysis.json（比 papers.ts 里的更完整） */
function loadSrcAnalysis(p) {
  const key = p.id.replace(/^cet[46]-/, '');
  const f = `scripts/.download/${p.level === 4 ? 'cet4' : 'cet6'}/${key}/analysis.json`;
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')).analysis || null;
  } catch {
    return null;
  }
}

for (const p of PAPERS) {
  const va = loadVerifiedAnswers(p);
  const sa = loadSrcAnalysis(p);
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      const isBanked = b.id.includes('banked');
      const isLong = b.id.includes('long');
      for (const q of b.questions || []) {
        if (q.answer) continue;
        let got = null;
        // ① 已人工核验的答案
        if (va && va.ok.has(String(q.num)) && va.json[String(q.num)] && got === null) {
          got = va.json[String(q.num)];
          s4.fromAnswers++;
        }
        // ② 逐题解析原文（banked 用词定位字母，long 用「X) 段」）
        if (!got && sa) {
          const src = isBanked ? sa.banked?.[String(q.num)] : isLong ? sa.long?.[String(q.num)] : sa.listening?.[String(q.num)] || sa.reading?.[String(q.num)];
          if (src) {
            got = isBanked
              ? bankedAnswerFromText(src, b.wordBank)
              : isLong
                ? longAnswerFromText(src) || answerFromText(src)
                : answerFromText(src);
            if (got) s4.fromSrc++;
          }
        }
        // ③ 退回 papers.ts 自带的解析
        if (!got) {
          got = isLong ? longAnswerFromText(q.analysis) || answerFromText(q.analysis) : answerFromText(q.analysis);
          if (got) s4.fromAnalysis++;
        }
        if (got) q.answer = got;
        else s4.unresolved.push(`${p.id} ${b.id}#${q.num}`);
      }
    }
  }
}
say(
  `\n[阶段4] 信息缺失：回填答案 ${s4.fromAnswers + s4.fromSrc + s4.fromAnalysis} 个（已核验 ${s4.fromAnswers} / 解析原文 ${s4.fromSrc} / 卷内解析 ${s4.fromAnalysis}），仍缺 ${s4.unresolved.length} 个`
);
s4.unresolved.slice(0, 15).forEach((d) => say('   · 仍缺：' + d));

/* =========================================================
 * 阶段 5：信息缺失 —— 回填听力题干译文
 * 解析原文形如「English stem? 中文译文? A) … C) …」，
 * 取第一段中文、且必须以问号收尾（题干都是疑问句），并排除解析/定位等噪声。
 * ======================================================= */
const s5 = { filled: 0, samples: [] };
const BAD_CN = /(精析|解析|答案|定位|听力原文|考点|News|Conversation|Passage|Section|第\s*\d+\s*页)/;

function pickStemCn(src) {
  const s = String(src || '');
  // 第一段连续中文（允许夹标点），止于第一个选项标记 / 页码 / 段落标记
  const m = s.match(/([\u4e00-\u9fff][^A-Za-z]{5,120}?)(?=\s*[A-D]\s*[)）]|\[第|【第|$)/);
  if (!m) return null;
  let cn = m[1].replace(/\s+/g, ' ').trim();
  if (!/[?？]/.test(cn.slice(-3))) return null; // 题干译文一定是疑问句
  if (BAD_CN.test(cn)) return null;
  if (cn.length < 6 || cn.length > 90) return null;
  return cn;
}

for (const p of PAPERS) {
  const sa = loadSrcAnalysis(p);
  if (!sa) continue;
  for (const sec of p.sections || []) {
    for (const b of sec.blocks || []) {
      if (!/-L\d/.test(b.id)) continue; // 只处理听力
      for (const q of b.questions || []) {
        if (q.stemCn) continue;
        const cn = pickStemCn(sa.listening?.[String(q.num)]);
        if (!cn) continue;
        q.stemCn = cn;
        s5.filled++;
        if (s5.samples.length < 8) s5.samples.push(`${p.id}#${q.num} ${cn}`);
      }
    }
  }
}
say(`\n[阶段5] 信息缺失：回填听力题干译文 ${s5.filled} 条`);
s5.samples.forEach((d) => say('   · ' + d));

/* =========================================================
 * 写回
 * ======================================================= */
if (APPLY) {
  const body = JSON.stringify(PAPERS, null, 2);
  // arrEnd 指向收尾的 ']'，其后还有 ';'，写回时要跳过这个 ']'
  const next = t.slice(0, arrStart) + body + t.slice(arrEnd + 1);
  if (!next.includes('export const PAPERS') || next.includes(']];')) throw new Error('写回内容异常，已中止');
  fs.writeFileSync(FILE, next, 'utf8');
  say(`\n已写回 ${FILE}（${(next.length / 1024 / 1024).toFixed(2)} MB）`);
} else {
  say('\n[dry-run] 未写回文件，加 --apply 生效');
}

if (REPORT) {
  fs.writeFileSync(
    REPORT,
    JSON.stringify({ stage1: s1, stage2: s2, stage3: s3, stage4: s4, log }, null, 2),
    'utf8'
  );
}
