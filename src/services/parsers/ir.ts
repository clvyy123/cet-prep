/**
 * 统一中间表示（IR）—— 所有解析插件（Markdown / 纯文本 / 未来扩展）的统一输出形状。
 * AI 阅读引擎（AIReader → buildSystemPrompt）不直接接触原始文件格式，
 * 只消费由 IR 转换出的结构化文本。
 */

/** 行内元素：链接、强调、行内代码、图片等 */
export type InlineSeg =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'em'; children: InlineSeg[] }
  | { type: 'strong'; children: InlineSeg[] }
  | { type: 'del'; children: InlineSeg[] }
  | { type: 'link'; children: InlineSeg[]; url: string; title?: string }
  | { type: 'image'; alt: string; url: string; title?: string };

/** 块级元素：标题层级、列表、代码块、引用、表格、分隔线、段落 */
export type IRBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; segs: InlineSeg[] }
  | { type: 'paragraph'; text: string; segs: InlineSeg[] }
  | {
      type: 'list';
      ordered: boolean;
      start: number;
      /** 每个列表项：行内内容 + 可嵌套子块（更深层的列表 / 代码块等） */
      items: { segs: InlineSeg[]; children: IRBlock[] }[];
    }
  | { type: 'code'; lang: string; text: string; fenced: boolean }
  | { type: 'quote'; blocks: IRBlock[] }
  | { type: 'table'; header: string[]; align: ('l' | 'c' | 'r')[]; rows: string[][] }
  | { type: 'hr' };

/** 插件 id 与人类可读名 */
export type IRFormat = 'markdown' | 'plaintext';

/** 解析产物的结构统计（供 UI 展示 / 引擎参考） */
export interface IRStats {
  headings: number;
  lists: number;
  listItems: number;
  codeBlocks: number;
  tables: number;
  quotes: number;
  links: number;
  images: number;
  emphasis: number;
  inlineCode: number;
}

/** 统一中间表示：一个文档解析后的完整结构描述 */
export interface DocumentIR {
  format: IRFormat;
  /** 产出该 IR 的插件 id（'builtin-markdown' / 'builtin-plaintext'） */
  plugin: string;
  /** 文档标题：优先取首个 H1，否则取文件名去扩展名，再否则为空 */
  title: string;
  blocks: IRBlock[];
  stats: IRStats;
  /** 非致命问题（如段落中的非法引用定义），供 UI 弱提示，不阻断流程 */
  warnings: string[];
}

export function emptyStats(): IRStats {
  return {
    headings: 0,
    lists: 0,
    listItems: 0,
    codeBlocks: 0,
    tables: 0,
    quotes: 0,
    links: 0,
    images: 0,
    emphasis: 0,
    inlineCode: 0,
  };
}

/** 累计统计子块（引用 / 列表嵌套） */
export function mergeStats(target: IRStats, sub: IRStats): IRStats {
  for (const k of Object.keys(sub) as (keyof IRStats)[]) {
    target[k] += sub[k];
  }
  return target;
}

/** 行内片段 → 纯文本（用于标题文本、段落文本与 AI 引擎输入） */
export function segsToText(segs: InlineSeg[]): string {
  let out = '';
  for (const s of segs) {
    switch (s.type) {
      case 'text':
        out += s.text;
        break;
      case 'code':
        out += s.text;
        break;
      case 'em':
      case 'strong':
      case 'del':
        out += segsToText(s.children);
        break;
      case 'link':
        // 引擎需要知道链接指向：正文后补 (url)
        out += `${segsToText(s.children)} (${s.url})`;
        break;
      case 'image':
        out += `[图片:${s.alt || '无描述'}]`;
        break;
    }
  }
  return out;
}

/**
 * IR → 结构化文本，喂给 AI 阅读引擎（buildSystemPrompt）。
 * 保留结构骨架（标题层级、列表、代码围栏、表格、引用），
 * 让模型能理解文档组织而不只是平铺文字。
 */
export function irToText(ir: DocumentIR): string {
  return ir.blocks.map(renderBlock).join('\n\n').trim();
}

function renderBlock(b: IRBlock): string {
  switch (b.type) {
    case 'heading':
      return `${'#'.repeat(b.level)} ${b.text}`;
    case 'paragraph':
      return b.text;
    case 'list':
      return b.items
        .map((it, i) => renderListItem(it, b.ordered ? `${b.start + i}. ` : '- '))
        .join('\n');
    case 'code':
      return b.fenced ? `\`\`\`${b.lang}\n${b.text}\n\`\`\`` : b.text;
    case 'quote':
      return b.blocks.map((s) => renderBlock(s)).join('\n\n').split('\n').map((l) => `> ${l}`).join('\n');
    case 'table': {
      const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
      const lines = [row(b.header), `| ${b.align.map((a) => (a === 'c' ? ':-:' : a === 'r' ? '--:' : '---')).join(' | ')} |`];
      for (const r of b.rows) lines.push(row(r));
      return lines.join('\n');
    }
    case 'hr':
      return '---';
  }
}

function renderListItem(it: { segs: InlineSeg[]; children: IRBlock[] }, marker: string): string {
  const text = segsToText(it.segs);
  const head = `${marker}${text}`;
  if (!it.children.length) return head;
  const sub = it.children.map((c) => renderBlock(c)).join('\n\n');
  // 子块整体缩进两格，保持层级可读
  return `${head}\n${sub.split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n')}`;
}
