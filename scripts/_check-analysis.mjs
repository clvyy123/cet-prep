// 检查听力题干空的套题
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('scripts/.download');
const sets = [
  ['cet4', '2024_06_1'],
  ['cet4', '2025_06_1'],
  ['cet6', '2024_06_1'],
];

for (const [lv, s] of sets) {
  const p = path.join(DIR, lv, s, 'analysis.json');
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const a = j.analysis || {};
  const listening = a.listening || {};
  console.log(`\n=== ${lv}/${s} (listening keys: ${Object.keys(listening).length}) ===`);
  for (const n of [1, 2, 3, 8, 15]) {
    const txt = listening[n] || '';
    if (!txt) { console.log(`[${n}]: (空)`); continue; }
    // 尝试提取英文题干
    const m = txt.match(/(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here)\b[^?!]{13,198}?[?!]/i);
    console.log(`[${n}] 前120字: ${txt.slice(0, 120)}`);
    if (m) console.log(`  → 提取题干: ${m[0].slice(0, 80)}`);
    else console.log(`  → 未提取到题干`);
  }
  // 检查 answer-layer.txt
  const layer = path.join(DIR, lv, s, 'answer-layer.txt');
  console.log(`answer-layer.txt: ${fs.existsSync(layer) ? '存在' : '不存在'}`);
  // 检查 ocr-full.txt
  const ocr = path.join(DIR, lv, s, 'ocr-full.txt');
  console.log(`ocr-full.txt: ${fs.existsSync(ocr) ? '存在' : '不存在'}`);
}
