// 扫描各答案解析 txt 的模块覆盖：听力/选词/长篇/阅读/翻译/写作
import fs from 'node:fs';
const base = 'C:/Users/yy/Desktop/四级/答案解析/';
for (const lvl of ['四级', '六级']) {
  const dir = base + lvl;
  console.log('===== ' + lvl + ' =====');
  for (const f of fs.readdirSync(dir).sort()) {
    const t = fs.readFileSync(dir + '/' + f, 'utf8');
    const has = (re) => (t.match(re) || []).length > 0;
    const tags = [];
    if (has(/答案详解/g)) tags.push('详解');
    if (has(/答案解析\s*[（(]?[A-D]/g)) tags.push('解析格式');
    if (has(/Listening\s*Comprehension|Section [ABC]/g)) tags.push('听力');
    if (has(/形容词\s*[:：]|词性分析/g)) tags.push('选词表');
    if (has(/定位到文章/g)) tags.push('长篇定位');
    if (has(/Passage\s+One|Passage\s+Two/g)) tags.push('阅读');
    if (has(/参考译文|Translation/g)) tags.push('翻译');
    if (has(/参考范文/g)) tags.push('写作');
    if (has(/答案\s*[:：]\s*1/g) || has(/KEYS/g)) tags.push('KEYS');
    console.log(f.slice(0, 30).padEnd(32), 'len=' + String(t.length).padStart(6), tags.join(' '));
  }
}
