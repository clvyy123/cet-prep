// 一次性迁移：听力音频不再按 Section A/B/C 分段，改为每套卷一个完整音频。
// 1) 将 public/audio/papers/{id}-A/B/C.mp3 拼接为 public/audio/papers/{id}.mp3（仅处理 papers.ts 引用到的卷）
// 2) 将 src/data/papers.ts 中的 "audio": { A, B, C } 记录改写为 "audioUrl": "/audio/papers/{id}.mp3"
// 用法：node scripts/merge-paper-audio.mjs [--apply]   （默认 dry-run）
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const ROOT = path.resolve(import.meta.dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'public/audio/papers');
const PAPERS_TS = path.join(ROOT, 'src/data/papers.ts');

const paperTs = fs.readFileSync(PAPERS_TS, 'utf8');

// —— 1. 收集 papers.ts 中引用的试卷 id（只给实际用到的卷生成合并音频，避免多余占盘）——
const re = /"audio": \{\s*\n\s*"A": "\/audio\/papers\/(.+?)-A\.mp3",\s*\n\s*"B": "\/audio\/papers\/\1-B\.mp3",\s*\n\s*"C": "\/audio\/papers\/\1-C\.mp3"\s*\n\s*\}/g;
const ids = [...paperTs.matchAll(re)].map((m) => m[1]);
console.log(`papers.ts 中引用分段音频的试卷：${ids.length} 套`);

// —— 2. 拼接 A+B+C → {id}.mp3 ——
let merged = 0;
for (const id of ids) {
  const out = path.join(AUDIO_DIR, `${id}.mp3`);
  if (fs.existsSync(out)) {
    console.log(`跳过（已存在）：${id}.mp3`);
    continue;
  }
  const parts = ['A', 'B', 'C'].map((L) => path.join(AUDIO_DIR, `${id}-${L}.mp3`));
  const missing = parts.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    console.warn(`缺段，跳过 ${id}：${missing.map((f) => path.basename(f)).join(', ')}`);
    continue;
  }
  if (!APPLY) {
    console.log(`[dry-run] 将拼接 ${id}.mp3`);
    continue;
  }
  const bufs = parts.map((f) => fs.readFileSync(f));
  fs.writeFileSync(out, Buffer.concat(bufs));
  merged++;
  console.log(`已生成 ${id}.mp3（${(Buffer.concat(bufs).length / 1048576).toFixed(1)} MB）`);
}

// —— 3. 改写 papers.ts ——
let hits = 0;
const nextTs = paperTs.replace(re, (_m, id) => {
  hits++;
  return `"audioUrl": "/audio/papers/${id}.mp3"`;
});
console.log(`papers.ts 待改写记录：${hits} 处`);
if (APPLY) {
  if (hits) fs.writeFileSync(PAPERS_TS, nextTs);
  console.log(`papers.ts 已写回（audio 记录 → audioUrl）；本次新拼接音频 ${merged} 份`);
} else {
  console.log('[dry-run] 未写盘，加 --apply 生效');
}
