/**
 * 把 PP-OCRv5 的页级 JSON 还原成正确阅读顺序的文本
 *
 *   node scripts/layout-lines.mjs <json根目录> <out.txt>
 *
 * 目录结构：<json根目录>/page_001/page_001.json …
 *
 * 解析 PDF 是「单栏正文 + 局部双栏（范文/点评）」混排，直接按 y 拼行会把双栏
 * 两段文字串在一行里。做法：
 *   1. 用水平投影直方图找真正的栏间空白（不能用页面中线，左栏常常跨过中线）
 *   2. 没找到 → 全页单栏，按 y 聚行即可
 *   3. 找到 → 按栏切分；跨过栏间距的块算「通栏」，作为分节符把页面切成若干带
 *   4. 每个带内先输出左栏（上→下）再输出右栏（上→下）
 */
import fs from 'node:fs';
import path from 'node:path';

const [jsonRoot, outTxt] = process.argv.slice(2);
const dirs = fs
  .readdirSync(jsonRoot)
  .filter((d) => /^page_\d+$/.test(d))
  .sort();

const LINE_TOL = 14; // 同一行的 y 容差（px @200dpi）

const MIN_GUTTER = 14; // 最小栏间距

/**
 * 找栏间距：按行统计「行内部」的横向空白，出现次数最多的那个位置就是栏间距。
 * 不能用全页水平投影——页面下方的通栏段落会在其它 y 上填满栏间距。
 */
function findGutter(raw, width) {
  const lines = [];
  for (const it of [...raw].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y0 - it.y0) < LINE_TOL) last.parts.push(it);
    else lines.push({ y0: it.y0, parts: [it] });
  }

  const tally = new Map();
  for (const l of lines) {
    const parts = l.parts.sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < parts.length - 1; i++) {
      const gapStart = parts[i].x1;
      const gapEnd = parts[i + 1].x0;
      if (gapEnd - gapStart < MIN_GUTTER) continue;
      if (gapStart < width * 0.2 || gapEnd > width * 0.92) continue; // 排除页边距
      const key = Math.round((gapStart + gapEnd) / 2 / 24);
      const rec = tally.get(key) || { n: 0, start: [], end: [] };
      rec.n++;
      rec.start.push(gapStart);
      rec.end.push(gapEnd);
      tally.set(key, rec);
    }
  }

  let best = null;
  for (const rec of tally.values()) if (!best || rec.n > best.n) best = rec;
  if (!best || best.n < 3) return null; // 至少要 3 行共享同一条栏间空白
  const mid = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  return [mid(best.start), mid(best.end)];
}

function toLines(items) {
  items.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y0 - it.y0) < LINE_TOL) {
      last.parts.push(it);
      last.y1 = Math.max(last.y1, it.y1);
    } else {
      lines.push({ y0: it.y0, y1: it.y1, parts: [it] });
    }
  }
  return lines.map((l) => ({
    y0: l.y0,
    text: l.parts
      .sort((a, b) => a.x0 - b.x0)
      .map((p) => p.text)
      .join(' ')
      .replace(/\s+/g, ' '),
  }));
}

const out = [];
for (const d of dirs) {
  const jf = path.join(jsonRoot, d, `${d}.json`);
  if (!fs.existsSync(jf)) continue;
  const data = JSON.parse(fs.readFileSync(jf, 'utf8'));
  const raw = (data.rec_texts || [])
    .map((t, i) => {
      const b = data.rec_boxes?.[i] || [0, 0, 0, 0];
      return { text: String(t).trim(), x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
    })
    .filter((it) => it.text);
  if (!raw.length) continue;

  const width = Math.max(...raw.map((it) => it.x1));
  out.push(`\n===== PAGE ${Number(d.replace('page_', ''))} =====`);

  const gutter = findGutter(raw, width);
  if (!gutter) {
    for (const l of toLines(raw)) out.push(l.text);
    continue;
  }

  const [gs, ge] = gutter;
  const k = (it) => (it.x0 < gs && it.x1 > ge ? 'full' : it.x1 <= ge ? 'L' : 'R');
  const seq = raw.map((it) => ({ ...it, k: k(it) })).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  const bands = [];
  let cur = [];
  for (const it of seq) {
    if (it.k === 'full') {
      if (cur.length) bands.push({ type: 'col', items: cur });
      bands.push({ type: 'full', items: [it] });
      cur = [];
    } else cur.push(it);
  }
  if (cur.length) bands.push({ type: 'col', items: cur });

  for (const band of bands) {
    if (band.type === 'full') {
      const t = toLines(band.items)[0]?.text;
      if (t) out.push(t);
      continue;
    }
    for (const l of toLines(band.items.filter((i) => i.k === 'L'))) out.push(l.text);
    for (const l of toLines(band.items.filter((i) => i.k === 'R'))) out.push(l.text);
  }
}

fs.writeFileSync(outTxt, out.join('\n'), 'utf8');
console.log(`✅ ${dirs.length} 页 → ${outTxt}（${out.length} 行）`);
