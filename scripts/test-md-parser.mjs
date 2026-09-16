/**
 * 解析插件功能自检：把 src/services/parsers 打包为可运行的 mjs，
 * 对 Markdown 结构识别做断言（标题/列表/代码块/链接/强调/表格/降级）。
 * 运行：node scripts/test-md-parser.mjs
 */
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.qa', 'md-parser');
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/services/parsers/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(outDir, 'parsers.mjs'),
  logLevel: 'silent',
});

const { parseDocument, irToText, isMarkdown, markdownSniffScore } = await import(
  `file://${path.join(outDir, 'parsers.mjs').replace(/\\/g, '/')}`
);

let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

const sample = `# 英语学习笔记

一些**加粗**和*斜体*，还有 \`inline code\` 与 [链接](https://example.com "示例")，
以及图片 ![alt text](img.png)。

## 第一章

- 无序项 A
- 无序项 B
  1. 嵌套有序 1
  2. 嵌套有序 2
- 无序项 C

1. 第一步
2. 第二步

### 代码示例

\`\`\`js
const x = 1; // 不是标题 # 也不是 **强调**
\`\`\`

> 引用一行
> 引用两行

| 单词 | 词性 | 释义 |
|:-----|:----:|-----:|
| apple | n. | 苹果 |
| run | v. | 跑 |

---

Setext 一级
==========

Setext 二级
-----------

参考式链接见 [Google][g]。

[g]: https://google.com "搜索"
`;

const ir = parseDocument({ name: 'notes.md', content: sample });

// 格式识别
check('识别为 markdown 格式', ir.format === 'markdown');
check('插件 id', ir.plugin === 'builtin-markdown');
check('标题取首个 H1', ir.title === '英语学习笔记');

// 块级
const h = ir.blocks.filter((b) => b.type === 'heading');
check('标题 5 个（ATX 3 + setext 2）', h.length === 5, `实际 ${h.length}: ${h.map((x) => x.level).join(',')}`);
check('H1 层级', h[0].level === 1 && h[0].text === '英语学习笔记');
check('setext 一级/二级', h.at(-2)?.level === 1 && h.at(-1)?.level === 2);
const lists = ir.blocks.filter((b) => b.type === 'list');
check('列表 2 个（无序+有序）', lists.length === 2, `实际 ${lists.length}`);
check('无序列表 3 项', lists[0]?.items.length === 3);
check('嵌套有序子列表 2 项', lists[0]?.items[1].children[0]?.type === 'list' && lists[0]?.items[1].children[0].items.length === 2);
check('有序列表 start=1 2 项', lists[1]?.ordered && lists[1]?.items.length === 2);
const codes = ir.blocks.filter((b) => b.type === 'code');
check('代码块 1 个且 lang=js', codes.length === 1 && codes[0].lang === 'js');
check('代码块内不做行内解析', codes[0].text.includes('**强调**'));
check('引用块存在', ir.blocks.some((b) => b.type === 'quote'));
const tables = ir.blocks.filter((b) => b.type === 'table');
check('表格 1 个 3 列 2 行', tables.length === 1 && tables[0].header.length === 3 && tables[0].rows.length === 2);
check('表格对齐 l/c/r', tables[0].align.join('') === 'lcr', `实际 ${tables[0].align.join('')}`);
check('分隔线存在', ir.blocks.some((b) => b.type === 'hr'));

// 行内与统计
const p0 = ir.blocks.find((b) => b.type === 'paragraph');
const segTypes = p0.segs.map((s) => s.type).join(',');
check('行内含 strong/em/code/link/image', ['strong', 'em', 'code', 'link', 'image'].every((t) => segTypes.includes(t)), segTypes);
check('引用式链接解析', ir.stats.links >= 2, `实际 ${ir.stats.links}`);
check('强调统计（加粗+斜体）', ir.stats.emphasis === 2, `实际 ${ir.stats.emphasis}`);
check('图片统计', ir.stats.images === 1);
check('链接文本带 url（irToText）', irToText(ir).includes('[链接] (https://example.com)') || irToText(ir).includes('链接 (https://example.com)'));

// 判定函数
check('.md 扩展名判定', isMarkdown('a.md', '随便什么'));
check('无扩展名内容嗅探', isMarkdown(undefined, '# 标题\n\n- 列表\n- 列表\n'));
check('txt 不误判', !isMarkdown('a.txt', '这是普通文字没有结构'));
check('二进制不误判', markdownSniffScore('abc\0def###') === 0);

// 降级
const plain = parseDocument({ name: 'plain.txt', content: '普通文本第一段。\n\n普通文本第二段。' });
check('txt 走纯文本插件', plain.format === 'plaintext' && plain.plugin === 'builtin-plaintext');
check('纯文本分 2 段', plain.blocks.length === 2);
const weird = parseDocument({ name: 'odd.md', content: '```\n未闭合围栏\n# 里面的不算标题' });
check('未闭合围栏不抛错且降级警告', weird.format === 'markdown' && weird.warnings.length === 1);
check('异常输入不抛错', parseDocument({ name: 'x.md', content: '' }).format === 'plaintext' || parseDocument({ name: 'x.md', content: '' }).blocks.length === 0);

console.log(failed ? `\\n${failed} 项失败` : '\\n全部通过');
process.exit(failed ? 1 : 0);
