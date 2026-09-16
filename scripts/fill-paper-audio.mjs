/**
 * 补齐「听力理解」section 的 audioUrl（整卷听力音频）。
 *
 *   node scripts/fill-paper-audio.mjs            # dry-run：只报告将要做什么
 *   node scripts/fill-paper-audio.mjs --apply    # 真正落盘（backup + 写回 papers.ts）
 *   node scripts/fill-paper-audio.mjs --apply --skip-fetch   # 不联网，只用已缓存/已有文件
 *
 * 三种来源：
 *   1. bank     —— public/audio/<key>.mp3（用户自备真题音频，听力训练页用的是同一份，实测 28.1min 与懒笔记 28.2min 同长）
 *   2. lazynote —— 站点只有 HLS，靠 scripts/lz-audio.mjs 抽成单文件 AAC 落到 public/audio/papers/<id>.aac
 *   3. segments —— public/audio/papers/<id>-{A,B,C}.mp3 已存在时字节拼接（本次未用上，保留能力）
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildLzAudio } from './lz-audio.mjs';

const APPLY = process.argv.includes('--apply');
const SKIP_FETCH = process.argv.includes('--skip-fetch');
const ROOT = path.resolve(import.meta.dirname, '..');
const PAPERS_TS = path.join(ROOT, 'src/data/papers.ts');

/** section 级目标：paperId + sourceSet（null = 该卷自己的听力） → audioUrl */
const TARGETS = [
  // ① 复用题库内置真题音频（听力训练页同源，零拷贝）
  { paper: 'cet6-2021_06_1', sourceSet: null, audio: '/audio/cet6-2021_06_1.mp3' },
  { paper: 'cet6-2021_06_2', sourceSet: null, audio: '/audio/cet6-2021_06_2.mp3' },
  { paper: 'cet6-2021_06_3', sourceSet: '第1套', audio: '/audio/cet6-2021_06_1.mp3' },
  { paper: 'cet6-2021_06_3', sourceSet: '第2套', audio: '/audio/cet6-2021_06_2.mp3' },
  { paper: 'cet6-2021_12_1', sourceSet: null, audio: '/audio/cet6-2021_12_1.mp3' },
  { paper: 'cet6-2021_12_2', sourceSet: null, audio: '/audio/cet6-2021_12_2.mp3' },
  { paper: 'cet6-2021_12_3', sourceSet: '第1套', audio: '/audio/cet6-2021_12_1.mp3' },
  { paper: 'cet6-2021_12_3', sourceSet: '第2套', audio: '/audio/cet6-2021_12_2.mp3' },
  { paper: 'cet6-2023_12_2', sourceSet: null, audio: '/audio/cet6-2023_12_2.mp3' },
  { paper: 'cet6-2023_12_3', sourceSet: '第2套', audio: '/audio/cet6-2023_12_2.mp3' },
  // ② 2026 年 6 月四套：题库无音频、ec 也没有 → 懒笔记 HLS 抽 AAC
  { paper: 'cet4-2026_06_1', sourceSet: null, audio: '/audio/papers/cet4-2026_06_1.aac', lz: ['cet4', '2026-06-1'] },
  { paper: 'cet4-2026_06_2', sourceSet: null, audio: '/audio/papers/cet4-2026_06_2.aac', lz: ['cet4', '2026-06-2'] },
  { paper: 'cet6-2026_06_1', sourceSet: null, audio: '/audio/papers/cet6-2026_06_1.aac', lz: ['cet6', '2026-06-1'] },
  { paper: 'cet6-2026_06_2', sourceSet: null, audio: '/audio/papers/cet6-2026_06_2.aac', lz: ['cet6', '2026-06-2'] },
];

// ------------------------------------------------------ 1. 生成缺失的音频文件
for (const t of TARGETS) {
  const f = path.join(ROOT, 'public', t.audio.replace(/^\//, ''));
  if (fs.existsSync(f) && fs.statSync(f).size > 500_000) continue;
  if (!t.lz) {
    console.log(`[!] ${t.audio} 不存在，且没有可抓取的来源`);
    continue;
  }
  if (SKIP_FETCH) {
    console.log(`[skip] ${t.paper} 需要抓取（--skip-fetch 已跳过）`);
    continue;
  }
  console.log(`[fetch] ${t.paper} ← 懒笔记 ${t.lz[1]}`);
  await buildLzAudio(t.paper, t.lz[0], t.lz[1]);
}

// ------------------------------------------------------ 2. 校验文件真的在
const missing = [];
for (const t of TARGETS) {
  const f = path.join(ROOT, 'public', t.audio.replace(/^\//, ''));
  if (!fs.existsSync(f) || fs.statSync(f).size < 500_000) missing.push(`${t.paper} → ${t.audio}`);
}
if (missing.length) {
  console.log('\n[x] 以下目标音频不可用，先修复再落盘：');
  for (const m of missing) console.log('   ', m);
  process.exit(1);
}

// ------------------------------------------------------ 3. 回写 papers.ts
const raw = fs.readFileSync(PAPERS_TS, 'utf8');
const head = raw.slice(0, raw.indexOf('= [') + 2);
const body = raw.slice(head.length, raw.lastIndexOf(']') + 1);
const tail = raw.slice(raw.lastIndexOf(']') + 1);
const PAPERS = JSON.parse(body);

let patched = 0;
const report = [];
for (const t of TARGETS) {
  const p = PAPERS.find((x) => x.id === t.paper);
  if (!p) {
    report.push(`[?] 无此卷 ${t.paper}`);
    continue;
  }
  const sec = p.sections.find(
    (s) => s.partName === '听力理解' && (t.sourceSet ? s.sourceSet === t.sourceSet : !s.sourceSet)
  );
  if (!sec) {
    report.push(`[?] ${t.paper}${t.sourceSet ? ' [' + t.sourceSet + ']' : ''} 找不到听力 section`);
    continue;
  }
  if (sec.audioUrl) {
    report.push(`[=] ${t.paper}${t.sourceSet ? ' [' + t.sourceSet + ']' : ''} 已有 ${sec.audioUrl}`);
    continue;
  }
  // 保持既有键序：audioUrl 插在 sourceSet 之前（与 build-papers.mjs 生成的一致）
  const next = {};
  for (const [k, v] of Object.entries(sec)) {
    if (k === 'sourceSet') next.audioUrl = t.audio;
    next[k] = v;
  }
  if (!next.audioUrl) next.audioUrl = t.audio;
  for (const k of Object.keys(sec)) delete sec[k];
  Object.assign(sec, next);
  patched++;
  report.push(`[+] ${t.paper}${t.sourceSet ? ' [' + t.sourceSet + ']' : ''} → ${t.audio}`);
}
for (const r of report) console.log(r);
console.log(`\n共写入 ${patched} 处`);

if (!APPLY) {
  console.log('[dry-run] 未写盘，加 --apply 生效');
  process.exit(0);
}

const nextBody = JSON.stringify(PAPERS, null, 2);
if (nextBody === body) {
  console.log('内容无变化，未写盘');
  process.exit(0);
}
const bak = path.join(ROOT, '.qa/lazynote', `papers.ts.bak-audio-${Date.now()}`);
fs.mkdirSync(path.dirname(bak), { recursive: true });
fs.copyFileSync(PAPERS_TS, bak);
fs.writeFileSync(PAPERS_TS, head + nextBody + tail);
console.log(`已写回 src/data/papers.ts（备份：${path.relative(ROOT, bak)}）`);

// ------------------------------------------------------ 4. 自检
const after = JSON.parse(
  fs.readFileSync(PAPERS_TS, 'utf8').replace(/^[\s\S]*?= \[/, '[').replace(/;\s*$/, '')
);
let bad = 0;
for (const p of after)
  for (const s of p.sections) {
    if (s.partName !== '听力理解' || !s.audioUrl) continue;
    const f = path.join(ROOT, 'public', s.audioUrl.replace(/^\//, ''));
    if (!fs.existsSync(f)) {
      console.log(`[x] ${p.id} 引用的文件不存在：${s.audioUrl}`);
      bad++;
    }
  }
console.log(bad ? `自检失败 ${bad} 处` : '自检通过：所有听力 section 的 audioUrl 都指向真实文件');
