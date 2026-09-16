// 调试 listeningStems 对指定套题的提取过程
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync('scripts/build-banks.mjs', 'utf8');
// 提取 cleanStem + listeningStems 函数
const cleanFn = new Function(src.slice(src.indexOf('function cleanStem'), src.indexOf('function listeningStems')) + '\nreturn cleanStem;')();
const stemsFn = new Function(src.slice(src.indexOf('function listeningStems'), src.indexOf('// ---------- 文本清理')) + '\nreturn listeningStems;')();

const lv = 'cet4', key = '2021_12_1';
const anaPath = path.join('scripts/.download', lv, key, 'analysis.json');
const ana = JSON.parse(fs.readFileSync(anaPath, 'utf8')).analysis || {};

// 逐题测试 analysis 提取
console.log('=== 逐题 analysis 提取测试 ===');
for (let n = 1; n <= 25; n++) {
  const txt = ana.listening?.[n] || '';
  if (!txt) { console.log(`Q${n}: analysis无文本`); continue; }
  const m = txt.match(/(?:What|Why|How|Which|Whose|Who|Where|When|According|Do|Does|Is|Are|ow|hy|hat|hen|hich|hose|here)\b[^?!]{13,198}?[?!]/i);
  const engPart = txt.split(/[\u4e00-\u9fff]/)[0];
  const hasQ = /[?!]/.test(engPart);
  console.log(`Q${n}: 问句匹配=${m ? '✓"' + cleanFn(m[0]).slice(0, 50) + '"' : '✗'} | eng首段=${engPart.slice(0, 40)} | eng含问号=${hasQ} | 文本长=${txt.length}`);
}
