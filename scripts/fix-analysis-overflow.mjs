#!/usr/bin/env node
// 清理 papers.ts 里 analysis 字段末尾的「越界切片」——题型页导航标记 + 属于其他区块的内容
//
//   node scripts/fix-analysis-overflow.mjs            # dry-run
//   node scripts/fix-analysis-overflow.mjs --apply    # 落盘（备份 .bak-overflow）
//
// 三类：
//   A 纯导航残片      '...故均排除。 PartIII > SectionA ·概览'          → 直接删尾
//   B 翻译题内容越界  '...。PartIV > Translation ·难词译注· …·参考译文· …' → 迁移回翻译 block 的 terms/reference，再删尾
//   C 篇章概览越界    'SectionB ·概览· …·全文翻译· …'                    → 迁移回该 block 的 analysisOverview/translationCn，再删尾
// 原则：先补齐目标字段（仅当为空时才写），再从 analysis 删除，保证零丢失、零重复。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');
const FILE = path.join(ROOT, 'src/data/papers.ts');

const NAV = /Part\s*(?:I{1,3}V?|IV)\s*>|\bSection\s*[ABC]\s*·/;
const NAVHEAD = /^(?:[\s\S]{0,20}?)Part\s*(?:I{1,3}V?|IV)\s*>\s*(?:Translation\s*\d*\s*)?|^\s*Section\s*[ABC]\s*·\s*[A-Za-z]+\s*·\s*/;
const norm = s => s.replace(/\s+/g, '');

function splitTail(tail) {
  // 去掉导航头
  let body = tail.replace(NAVHEAD, '');
  if (body === tail) body = tail.replace(/^\s*Section\s*[ABC]\s*·\s*[A-Za-z]+\s*·\s*/, '');
  let terms = '', reference = '', overview = '', translationCn = '';
  // C 类：概览 + 全文翻译
  const iTr = body.indexOf('全文翻译');
  if (body.includes('概览') && iTr >= 0) {
    overview = body.slice(0, iTr).replace(/^[\s\S]{0,30}?·\s*概览\s*·?\s*/, '').replace(/[·\s]+$/, '').trim();
    translationCn = body.slice(iTr + 4).replace(/^[·\s]*/, '').trim();
    return { kind: 'C', overview, translationCn };
  }
  const iRef = body.indexOf('参考译文');
  const iNote = body.indexOf('难词译注');
  if (iRef >= 0 || iNote >= 0) {
    const cut = iRef >= 0 ? iRef : body.length;
    terms = body.slice(0, cut)
      .replace(/^[\s\S]{0,20}?难词译注\s*·?\s*/, '')
      .replace(/[·\s]+$/, '').trim();
    if (iRef >= 0) {
      reference = body.slice(iRef + 4)
        .replace(/^[·\s]*/, '')
        .split(/[^\s]{0,3}·?\s*译点精析/)[0]
        .replace(/[·\s]+$/, '').trim();
    }
    return { kind: 'B', terms, reference };
  }
  return { kind: 'A' };
}

const src = fs.readFileSync(FILE, 'utf8');
const head = /\][ \t]*=[ \t]*\[/.exec(src);
const a = head.index + head[0].length - 1, b = src.lastIndexOf(']');
const arr = JSON.parse(src.slice(a, b + 1));

const log = [];
let nA = 0, nB = 0, nC = 0, skip = 0;
for (const p of arr) {
  const transBlocks = p.sections.filter(s => s.partName === '翻译').flatMap(s => s.blocks);
  for (const s of p.sections) {
    for (const blk of s.blocks) {
      for (const q of blk.questions || []) {
        const ana = q.analysis || '';
        const m = NAV.exec(ana);
        if (!m || m.index === 0) continue;
        const tail = ana.slice(m.index);
        if (!tail.trim()) continue;
        const parts = splitTail(tail.trim());
        const bodyLen = norm(tail).replace(NAVHEAD, '').length;

        // A：只有导航标记，没有实质内容（bodyLen 兜底，防止切分类误删正文）
        if (bodyLen <= 12) {
          nA++;
          q.analysis = ana.slice(0, m.index).replace(/[·\s]+$/, '');
          log.push(`A ${p.id} sec(${s.partName}) q${q.num}  删尾 ${JSON.stringify(tail.trim())}`);
          continue;
        }
        if (parts.kind === 'A') {
          skip++;
          log.push(`!! ${p.id} sec(${s.partName}) q${q.num}  未识别类型（${bodyLen}字），已跳过：${JSON.stringify(tail.trim().slice(0, 90))}`);
          continue;
        }
        if (parts.kind === 'B') {
          nB++;
          const tb = transBlocks[0];
          const acts = [];
          if (tb) {
            const pool = norm((tb.terms || []).join('') + (tb.reference || ''));
            if (parts.terms && !pool.includes(norm(parts.terms).slice(0, 40))) {
              tb.terms = [...(tb.terms || []), parts.terms]; acts.push('terms+');
            }
            if (parts.reference && !norm(tb.reference || '').includes(norm(parts.reference).slice(0, 40))) {
              tb.reference = ((tb.reference || '') + ' ' + parts.reference).trim(); acts.push('reference+');
            }
          }
          q.analysis = ana.slice(0, m.index).replace(/[·\s]+$/, '');
          log.push(`B ${p.id} q${q.num}  删尾 ${norm(tail).length}字  迁移[${acts.join(',') || '无(已重复)'}]  词表${parts.terms.length}/译文${parts.reference.length}`);
          continue;
        }
        if (parts.kind === 'C') {
          nC++;
          const acts = [];
          if (parts.overview && !blk.analysisOverview) { blk.analysisOverview = parts.overview; acts.push('analysisOverview='); }
          if (parts.translationCn && !blk.translationCn) { blk.translationCn = parts.translationCn; acts.push('translationCn='); }
          q.analysis = ana.slice(0, m.index).replace(/[·\s]+$/, '');
          log.push(`C ${p.id} q${q.num}  删尾 ${norm(tail).length}字  迁移[${acts.join(',') || '无(已重复)'}]`);
        }
      }
    }
  }
}

console.log(log.join('\n'));
console.log(`\nA ${nA} / B ${nB} / C ${nC} / 跳过 ${skip}  合计 ${log.length} 处${APPLY ? '' : '（dry-run）'}`);
if (APPLY) {
  const bak = FILE + '.bak-overflow';
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, src.slice(0, a) + JSON.stringify(arr, null, 2) + src.slice(b + 1));
  console.log(`已写入；备份 ${path.basename(bak)}`);
}
