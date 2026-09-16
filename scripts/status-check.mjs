// 状态检查：列出所有套件的 answers/analysis 进度
import fs from 'node:fs';
const DIR = 'scripts/.download';
for (const lvl of ['4', '6']) {
  const base = DIR + '/cet' + lvl;
  console.log('===== cet' + lvl + ' =====');
  for (const d of fs.readdirSync(base).sort()) {
    const dir = base + '/' + d;
    if (!fs.statSync(dir).isDirectory()) continue;
    const hasA = fs.existsSync(dir + '/answers.json');
    const hasAn = fs.existsSync(dir + '/analysis.json');
    let aN = '-', anN = '-';
    if (hasA) {
      try { aN = String(Object.keys(JSON.parse(fs.readFileSync(dir + '/answers.json', 'utf8'))).length); } catch (e) { aN = 'ERR'; }
    }
    if (hasAn) {
      try {
        const j = JSON.parse(fs.readFileSync(dir + '/analysis.json', 'utf8'));
        const a = j.analysis || {};
        anN = Object.keys(a.listening || {}).length + '/' + Object.keys(a.banked || {}).length + '/' + Object.keys(a.long || {}).length + '/' + Object.keys(a.reading || {}).length;
      } catch (e) { anN = 'ERR'; }
    }
    console.log(d.padEnd(14), 'ans:' + aN.padStart(3), 'analysis(听/选/长/读):' + anN);
  }
}
