/**
 * 批量导入整卷试卷
 *
 *   node scripts/import-all-papers.mjs [--level 4|6] [--limit N] [--conc 4] [--force]
 *
 * 每套：真题 PDF 文字层 → 卷面；答案解析 PDF → 本地 OCR → 版式还原 → 解析；
 * 再由 scripts/build-papers.mjs 合并进 src/data/papers.ts。
 *
 * 两段都有缓存（.qa/papers/cache/<id>/），中断后重跑会自动续上。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const OCR_ROOT = 'ocr/pdfs';
const DL = 'scripts/.download';
const CACHE = '.qa/papers/cache';
const WORK_ROOT = 'C:/Users/yy/AppData/Local/Temp/cetocr/batch';
const OUT = 'src/data/papers.ts';

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 ? argv[i + 1] : null;
};
const LEVEL = arg('level') ? Number(arg('level')) : null;
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity;
const CONC = Number(arg('conc')) || 4;
const FORCE = argv.includes('--force');
const THREADS = Number(arg('threads')) || 4; // 每个 OCR 进程的线程数；CONC × THREADS 别超过物理核数

const log = (s) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${s}`);

/* ---------- 1. 发现套卷 ---------- */
function discover() {
  const sets = [];
  const skipped = [];
  for (const [cn, level] of [
    ['四级', 4],
    ['六级', 6],
  ]) {
    const dir = path.join(OCR_ROOT, cn);
    if (!fs.existsSync(dir) || (LEVEL && LEVEL !== level)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.pdf')) continue;
      const m = /^(?:四|六)级_(\d{4})年(\d{1,2})月 第(.+?)套_答案解析\.pdf$/.exec(f);
      if (!m) {
        skipped.push(`命名不符：${f}`);
        continue;
      }
      const year = Number(m[1]);
      const month = Number(m[2]);
      const setKey = m[3];
      const key = `${year}_${String(month).padStart(2, '0')}_${setKey}`;
      const paperPdf = path.join(DL, `cet${level}`, key, 'test.pdf');
      if (!fs.existsSync(paperPdf)) {
        skipped.push(`缺真题 PDF：${key}`);
        continue;
      }
      sets.push({
        id: `cet${level}-${key}`,
        level,
        year,
        month,
        setNo: `第${setKey}套`,
        anaPdf: path.join(dir, f),
        paperPdf,
      });
    }
  }
  sets.sort((a, b) => a.level - b.level || b.year - a.year || b.month - a.month || a.setNo.localeCompare(b.setNo));
  return { sets: sets.slice(0, LIMIT), skipped };
}

/* ---------- 2. 单套：卷面文字 + 解析文本 ---------- */
function prepare(set) {
  const dir = path.join(CACHE, set.id);
  const paperTxt = path.join(dir, 'paper.txt');
  const anaTxt = path.join(dir, 'analysis.txt');
  if (FORCE) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(paperTxt)) {
    execFileSync(process.execPath, ['scripts/dump-paper-text.mjs', set.paperPdf, paperTxt], { stdio: 'ignore' });
    // 老一套的真题 PDF 是扫描件，没有文字层 → 也走 OCR
    if (fs.statSync(paperTxt).size < 2000) {
      const work = path.join(WORK_ROOT, set.id + '-paper');
      execFileSync(process.execPath, ['scripts/ocr-pdf.mjs', set.paperPdf, work, '200', String(THREADS)], { stdio: 'ignore' });
      execFileSync(process.execPath, ['scripts/layout-lines.mjs', path.join(work, 'out'), paperTxt], { stdio: 'ignore' });
    }
  }
  if (!fs.existsSync(anaTxt)) {
    const work = path.join(WORK_ROOT, set.id);
    execFileSync(process.execPath, ['scripts/ocr-pdf.mjs', set.anaPdf, work, '200', String(THREADS)], { stdio: 'ignore' });
    execFileSync(process.execPath, ['scripts/layout-lines.mjs', path.join(work, 'out'), anaTxt], { stdio: 'ignore' });
  }
  return { paperTxt, anaTxt };
}

/* ---------- 3. 并发跑 prepare ---------- */
async function runPool(sets) {
  let idx = 0;
  let ok = 0;
  let fail = 0;
  const errors = [];
  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= sets.length) return;
      const s = sets[i];
      const t0 = Date.now();
      try {
        prepare(s);
        ok++;
        log(`✓ ${i + 1}/${sets.length} ${s.id}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (e) {
        fail++;
        errors.push(`${s.id}: ${e.message}`);
        log(`✗ ${i + 1}/${sets.length} ${s.id}  ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, sets.length) }, worker));
  return { ok, fail, errors };
}

/* ---------- 4. 逐个合并进 papers.ts ---------- */
function build(sets) {
  let ok = 0;
  const bad = [];
  for (const s of sets) {
    const dir = path.join(CACHE, s.id);
    const paperTxt = path.join(dir, 'paper.txt');
    const anaTxt = path.join(dir, 'analysis.txt');
    if (!fs.existsSync(paperTxt) || !fs.existsSync(anaTxt)) continue;
    const meta = JSON.stringify({ id: s.id, level: s.level, year: s.year, month: s.month, setNo: s.setNo });
    try {
      const out = execFileSync(
        process.execPath,
        ['scripts/build-papers.mjs', '--paper', paperTxt, '--analysis', anaTxt, '--meta', meta, '--out', OUT],
        { encoding: 'utf8' }
      );
      const m = /各 Part 题数：(.+)$/m.exec(out.trim());
      ok++;
      if (m) log(`  ${s.id} → ${m[1]}`);
    } catch (e) {
      bad.push(`${s.id}: ${e.message.split('\n')[0]}`);
    }
  }
  return { ok, bad };
}

/* ---------- main ---------- */
const { sets, skipped } = discover();
log(`发现 ${sets.length} 套（跳过 ${skipped.length} 条：${skipped.slice(0, 5).join('；')}${skipped.length > 5 ? ' …' : ''}）`);
if (!sets.length) process.exit(0);

log(`并行 ${CONC} 路 · 每路 ${THREADS} 线程，开始提取…`);
const t0 = Date.now();
const { ok, fail, errors } = await runPool(sets);
log(`提取完成：成功 ${ok}，失败 ${fail}，用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);

log('合并进 src/data/papers.ts …');
const { ok: built, bad } = build(sets);
log(`合并完成：${built} 套`);

/* ---------- 4.5 拼装 src/data/papers.ts ---------- */
function assemble() {
  const dir = path.dirname(path.resolve(OUT));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const papers = files
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    // 0 题的套卷（扫描件 OCR 全军覆没，只剩写作/翻译题干）没有练习价值，不进题库
    .filter((p) => p.sections.some((s) => s.blocks.some((b) => b.questions.length)))
    .sort(
      (a, b) =>
        a.level - b.level || b.year - a.year || b.month - a.month || String(a.setNo).localeCompare(String(b.setNo))
    );
  const header = `// 整卷试卷数据（由 scripts/build-papers.mjs + scripts/import-all-papers.mjs 生成，勿手改）\nimport type { Paper } from '../types';\n\nexport const PAPERS: Paper[] = `;
  fs.writeFileSync(OUT, `${header}${JSON.stringify(papers, null, 2)};\n`, 'utf8');
  log(`拼装 ${papers.length} 套 → ${OUT}（${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB）`);
  return papers;
}

/* ---------- 5. 汇总校验：逐套统计题量/缺解析/缺原文 ---------- */
function audit(ids, all) {
  const papers = all ?? [];
  if (!papers.length) return;
  const rows = [];
  for (const p of papers) {
    if (ids && !ids.has(p.id)) continue;
    let total = 0;
    let noAna = 0;
    let noMat = 0;
    const groups = [];
    for (const sec of p.sections) {
      let n = 0;
      for (const b of sec.blocks) {
        for (const q of b.questions) {
          total++;
          n++;
          if (!q.analysis) noAna++;
        }
        if (b.questions.length && !b.material) noMat++;
      }
      if (n) groups.push(`${sec.partNo}:${n}`);
    }
    rows.push({ id: p.id, total, noAna, noMat, groups: groups.join(' ') });
  }
  fs.writeFileSync(path.join(CACHE, '_audit.json'), JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.total !== 55 || r.noAna > 0);
  log(`校验：${rows.length} 套，题量/解析异常 ${bad.length} 套`);
  for (const r of bad.slice(0, 20)) log(`  ! ${r.id} 题数=${r.total} 缺解析=${r.noAna} 缺原文=${r.noMat} [${r.groups}]`);
}
for (const e of [...errors, ...bad]) log(`  ! ${e}`);
const all = assemble();
audit(new Set(sets.map((s) => s.id)), all);
fs.writeFileSync(
  path.join(CACHE, '_report.json'),
  JSON.stringify({ total: sets.length, ok, fail, built, errors: [...errors, ...bad] }, null, 2)
);
