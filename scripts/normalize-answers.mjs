// 修复 answers.json：把嵌套格式 {banked:{26:..},long:{...},reading:{...},listening:{...}} 转回扁平 {26:..}
// 用法：node scripts/normalize-answers.mjs [setDir...]（不传则扫描全部）
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'scripts/.download';
const targets = process.argv.slice(2);

function fixAnswers(p) {
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return 'ERR parse'; }
  // 已经是扁平（键为数字）
  const keys = Object.keys(j);
  if (keys.some((k) => /^\d+$/.test(k))) return 'flat ok';
  // 嵌套格式
  const out = {};
  for (const [mod, map] of Object.entries(j)) {
    if (map && typeof map === 'object') {
      for (const [n, v] of Object.entries(map)) {
        if (/^\d+$/.test(n) && v) out[n] = v;
      }
    }
  }
  if (!Object.keys(out).length) return 'EMPTY';
  fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf8');
  return 'converted(' + Object.keys(out).length + ')';
}

const dirs = [];
for (const lvl of ['4', '6']) {
  const base = path.join(DIR, `cet${lvl}`);
  for (const d of fs.readdirSync(base)) {
    if (targets.length && !targets.includes(d)) continue;
    const p = path.join(base, d, 'answers.json');
    if (fs.existsSync(p)) dirs.push([`cet${lvl}/${d}`, p]);
  }
}
for (const [name, p] of dirs) {
  const r = fixAnswers(p);
  console.log(name.padEnd(16), r);
}
