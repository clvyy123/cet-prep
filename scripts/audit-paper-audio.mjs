// 体检：哪些整卷/听力 section 有音频、哪些没有（papers.ts 是 JSON 字面量，可直接切出来 parse）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, 'src/data/papers.ts'), 'utf8');
const s = raw.indexOf('= [') + 2;
const e = raw.lastIndexOf(']');
const PAPERS = JSON.parse(raw.slice(s, e + 1));

const missing = [];
const badFile = [];
let listenSec = 0;
let withAudio = 0;

for (const p of PAPERS) {
  for (const sec of p.sections || []) {
    if (sec.partName !== '听力理解') continue;
    listenSec++;
    if (sec.audioUrl) {
      withAudio++;
      const f = path.join(ROOT, 'public', sec.audioUrl.replace(/^\//, ''));
      if (!fs.existsSync(f) || fs.statSync(f).size < 1000) badFile.push(`${p.id} → ${sec.audioUrl}`);
    } else {
      missing.push({ id: p.id, title: p.title, setNo: p.setNo, sourceSet: sec.sourceSet || '', blocks: (sec.blocks || []).length });
    }
  }
}

console.log(`卷数 ${PAPERS.length} · 听力 section ${listenSec} · 有音频 ${withAudio} · 缺音频 ${missing.length}`);
console.log(`\n== 缺音频的听力 section ==`);
for (const m of missing) console.log(`${m.id}  ${m.title} ${m.setNo}${m.sourceSet ? ` [sourceSet=${m.sourceSet}]` : ''}  blocks=${m.blocks}`);
console.log(`\n== 音频文件缺失/过小 ==`);
for (const b of badFile) console.log(b);
