// 将生成的内置词库 TS 文件按字母序（不区分大小写）重排行序。
// 只调整数组元素顺序，不改 id / 不重新编号（学习进度按 id 存储在 localStorage）。
// 用法：node scripts/sort-words.mjs kaoyan toefl
// 每个文件改动前备份为 <name>.ts.bak-sort，结束后输出自检结果。
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('src/data/words');
const names = process.argv.slice(2);

if (names.length === 0) {
  console.error('用法：node scripts/sort-words.mjs <book> [book...]  例：kaoyan toefl');
  process.exit(1);
}

/** 还原 TS 单引号字符串里的转义，用于比较词形 */
function unesc(s) {
  return s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
}

for (const name of names) {
  const file = path.join(OUT_DIR, `${name}.ts`);
  if (!fs.existsSync(file)) {
    console.error(`缺少文件: ${file}`);
    process.exit(1);
  }
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  const entryIdx = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("{id:'")) entryIdx.push(i);
  }
  if (entryIdx.length === 0) {
    console.error(`${file}: 未找到词条行`);
    process.exit(1);
  }

  const before = entryIdx.length;
  const entries = entryIdx.map((i) => {
    const m = lines[i].match(/,word:'((?:[^'\\]|\\.)*)',/);
    if (!m) throw new Error(`${file} 第 ${i + 1} 行无法解析 word 字段`);
    // 生成脚本用 join(',\\n') 拼接，最后一个词条行没有尾逗号；
    // 重排后它会落到中间，必须统一规整：去掉行尾逗号，写回时按位置补回。
    const core = lines[i].replace(/,\s*$/, '');
    return { i, line: core, key: unesc(m[1]).toLowerCase() };
  });

  // 稳定排序：同为小写词形相等时保持原相对顺序
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const sorted = lines.slice();
  entryIdx.forEach((oldIdx, k) => {
    sorted[oldIdx] = entries[k].line + (k < entryIdx.length - 1 ? ',' : '');
  });

  // 自检：重新解析排序结果，确认单调不减且 id 无重复
  const check = entryIdx.map((i) => sorted[i].match(/,word:'((?:[^'\\]|\\.)*)',/)[1]);
  const keys = check.map((w) => unesc(w).toLowerCase());
  let sortedOk = true;
  for (let k = 1; k < keys.length; k++) if (keys[k] < keys[k - 1]) { sortedOk = false; break; }
  const ids = entryIdx.map((i) => sorted[i].match(/^\{id:'([^']*)'/)[1]);
  const dupIds = ids.length !== new Set(ids).size;
  const words = check.map((w) => unesc(w).toLowerCase());
  const dupWords = words.length !== new Set(words).size;

  if (!sortedOk || dupIds || dupWords) {
    console.error(`${name}: 自检失败 sorted=${sortedOk} dupIds=${dupIds} dupWords=${dupWords}，不落盘`);
    process.exit(1);
  }

  fs.copyFileSync(file, `${file}.bak-sort`);
  fs.writeFileSync(file, sorted.join('\n'), 'utf8');
  console.log(
    `${name}: ${before} 词条已按字母序重排（id 保持原编号）` +
      `${dupWords ? '' : '，词形无重复'} -> ${file}`
  );
}
