/**
 * 内置插件：Markdown 结构解析器（零依赖）。
 *
 * 职责：
 *  1. 判断输入是否为 Markdown（扩展名 + 内容嗅探双重判定）；
 *  2. 解析块级结构：ATX/Setext 标题层级、有序/无序嵌套列表、
 *     围栏/缩进代码块、引用块、表格、分隔线、段落；
 *  3. 解析行内元素：链接（行内/引用/自动）、图片、加粗、斜体、
 *     删除线、行内代码；
 *  4. 输出统一 IR（见 ./ir）。
 *
 * 设计取舍：面向「AI 阅读理解」而非完整 CommonMark 规范——
 * 结构识别准确优先，规范边缘情况（懒延续行、HTML 块等）从宽处理。
 */

import type { DocumentIR, InlineSeg, IRBlock, IRStats } from './ir';
import { emptyStats, mergeStats, segsToText } from './ir';

export const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd'];

// ============ 识别：是不是 Markdown ============

/** 内容嗅探信号（按强弱打分） */
export function markdownSniffScore(content: string): number {
  if (!content || content.includes('\0')) return 0;
  const lines = content.split('\n');
  let score = 0;
  let inFence = false;
  for (let i = 0; i < lines.length && i < 400; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      score += 2;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s+\S/.test(line)) score += 2;
    else if (i > 0 && /^\s*(={2,}|-{2,})\s*$/.test(line) && lines[i - 1].trim()) score += 2;
    else if (/^\s*[-+*]\s+\S/.test(line)) score += 1;
    else if (/^\s*\d+[.)]\s+\S/.test(line)) score += 1;
    else if (/^\s*>\s*\S/.test(line)) score += 1;
    else if (/\[[^\]]+\]\([^)]+\)/.test(line)) score += 1;
    else if (/^\|.*\|\s*$/.test(line) && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1] ?? '')) score += 2;
    if (score >= 6) break;
  }
  return score;
}

/** 判定输入是否为 Markdown：扩展名优先，无扩展名/陌生扩展名走内容嗅探 */
export function isMarkdown(fileName: string | undefined, content: string): boolean {
  if (fileName) {
    const ext = fileName.toLowerCase().replace(/^.*\./, '');
    if (fileName.includes('.') && MARKDOWN_EXTS.includes(ext)) return true;
    // 已知非 Markdown 的扩展名不做内容嗅探，避免误判
    if (fileName.includes('.') && ['txt', 'doc', 'docx', 'pdf', 'html', 'htm', 'json', 'csv'].includes(ext)) {
      return false;
    }
  }
  return markdownSniffScore(content) >= 3;
}

// ============ 插件形状（注册表契约，见 ./registry） ============

export interface ParseInput {
  name?: string;
  content: string;
}

export interface ParserPlugin {
  id: string;
  label: string;
  format: 'markdown' | 'plaintext';
  /** 是否接得住这个输入（注册表按序询问） */
  detect(input: ParseInput): boolean;
  parse(input: ParseInput): DocumentIR;
}

export const markdownPlugin: ParserPlugin = {
  id: 'builtin-markdown',
  label: 'Markdown',
  format: 'markdown',
  detect: (input) => isMarkdown(input.name, input.content),
  parse: (input) => parseMarkdown(input),
};

// ============ 行内解析 ============

export interface InlineStats {
  links: number;
  images: number;
  emphasis: number;
  inlineCode: number;
}

/**
 * 行内文本 → 结构化片段。
 * 策略：先把代码/图片/链接替换为占位符防止内部再被强调规则命中，
 * 最后统一还原为 InlineSeg 树。
 */
export function parseInline(raw: string, stats: InlineStats, refDefs: Map<string, { url: string; title?: string }>): InlineSeg[] {
  // 1) 行内代码（优先级最高，内部不做任何解析）
  const codes: string[] = [];
  let s = raw.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, inner) => {
    codes.push(String(inner).replace(/^ | $/g, ''));
    return `\u0000C${codes.length - 1}\u0000`;
  });

  // 2) 图片（先于链接，避免 ![alt](url) 被链接规则吃掉）
  const images: InlineSeg[] = [];
  s = s.replace(/!\[([^\]]*)\]\(\s*<?([^\s>)]*)>?(?:\s+"([^"]*)")?\s*\)/g, (_m, alt, url, title) => {
    stats.images++;
    images.push({ type: 'image', alt, url, title });
    return `\u0000I${images.length - 1}\u0000`;
  });

  // 3) 链接：行内式 → 自动链接 → 引用式
  const links: InlineSeg[] = [];
  s = s.replace(/\[([^\]]*)\]\(\s*<?([^\s>)]*)>?(?:\s+"([^"]*)")?\s*\)/g, (_m, text, url, title) => {
    stats.links++;
    links.push({ type: 'link', children: [{ type: 'text', text }], url, title });
    return `\u0000L${links.length - 1}\u0000`;
  });
  s = s.replace(/<((?:https?|ftp|mailto):[^>\s]+)>/g, (_m, url) => {
    stats.links++;
    links.push({ type: 'link', children: [{ type: 'text', text: url }], url });
    return `\u0000L${links.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]*)\]\[([^\]]*)\]/g, (_m, text, ref) => {
    const key = (ref || text).toLowerCase().trim();
    const def = refDefs.get(key);
    if (!def) return `[${text}][${ref}]`; // 未定义引用：还原原文，不计入链接
    stats.links++;
    links.push({ type: 'link', children: [{ type: 'text', text }], url: def.url, title: def.title });
    return `\u0000L${links.length - 1}\u0000`;
  });

  // 4) 强调：删除线 → 加粗 → 斜体（递归解析嵌套内容）
  const store: InlineSeg[] = [];
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, (_m, inner) => {
    store.push({ type: 'del', children: parseInline(inner, stats, refDefs) });
    return `\u0000P${store.length - 1}\u0000`;
  });
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/g, (_m, a, b) => {
    store.push({ type: 'strong', children: parseInline(a ?? b, stats, refDefs) });
    return `\u0000P${store.length - 1}\u0000`;
  });
  s = s.replace(/\*(?=\S)([^*\n]*?\S)\*|(?<![\w\\])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, (_m, a, b) => {
    store.push({ type: 'em', children: parseInline(a ?? b, stats, refDefs) });
    return `\u0000P${store.length - 1}\u0000`;
  });

  // 5) 还原占位符
  const segs: InlineSeg[] = [];
  for (const part of s.split(/(\u0000[CILP]\d+\u0000)/)) {
    const m = part.match(/^\u0000([CILP])(\d+)\u0000$/);
    if (!m) {
      if (part) segs.push({ type: 'text', text: unescapeMd(part) });
      continue;
    }
    const idx = Number(m[2]);
    switch (m[1]) {
      case 'C':
        stats.inlineCode++;
        segs.push({ type: 'code', text: codes[idx] });
        break;
      case 'I':
        segs.push(images[idx]);
        break;
      case 'L':
        segs.push(links[idx]);
        break;
      case 'P': {
        const seg = store[idx];
        if (seg) {
          stats.emphasis++;
          segs.push(seg);
        }
        break;
      }
    }
  }
  return segs;
}

function unescapeMd(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
}

// ============ 块级解析 ============

const RE = {
  fence: /^(\s{0,3})(```+|~~~+)\s*(\S*)\s*$/,
  atx: /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/,
  hr: /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/,
  ul: /^(\s*)([-+*])(\s+)(\S.*)$/,
  ol: /^(\s*)(\d{1,9})([.)])(\s+)(\S.*)$/,
  quote: /^\s{0,3}>\s?(.*)$/,
  tableSep: /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
  tableRow: /^\s*\|?.+\|\s*$/,
  refDef: /^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+["'(](.*?)["')])?\s*$/,
};

/** 去掉表格行两端管道后按 | 切格（忽略转义 \|） */
function splitTableRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (body[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

function parseAlignSep(line: string): ('l' | 'c' | 'r')[] | null {
  if (!RE.tableSep.test(line)) return null;
  return splitTableRow(line).map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'c' : r ? 'r' : 'l';
  });
}

function listMarker(line: string): { indent: number; ordered: boolean; start: number; content: string; markerLen: number } | null {
  const mu = line.match(RE.ul);
  if (mu) return { indent: mu[1].length, ordered: false, start: 1, content: mu[4], markerLen: mu[2].length + mu[3].length };
  const mo = line.match(RE.ol);
  if (mo) return { indent: mo[1].length, ordered: true, start: Number(mo[2]), content: mo[5], markerLen: mo[2].length + mo[3].length + mo[4].length };
  return null;
}

export function parseMarkdown(input: ParseInput): DocumentIR {
  const warnings: string[] = [];
  const raw = input.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');

  const stats: IRStats = emptyStats();
  const inlineStats: InlineStats = { links: 0, images: 0, emphasis: 0, inlineCode: 0 };
  const refDefs = new Map<string, { url: string; title?: string }>();

  // 第一遍：收集独立成行的链接引用定义 [label]: url
  for (const line of lines) {
    if (listMarker(line)) continue;
    const m = line.match(RE.refDef);
    if (m) refDefs.set(m[1].toLowerCase().trim(), { url: m[2], title: m[3] });
  }

  const blocks = parseBlocks(lines, 0);

  function parseBlocks(ls: string[], depth: number): IRBlock[] {
    const out: IRBlock[] = [];
    let i = 0;
    while (i < ls.length) {
      const line = ls[i];

      if (!line.trim()) {
        i++;
        continue;
      }

      // 引用定义行（已收集）：从正文剔除
      if (depth === 0 && RE.refDef.test(line) && !listMarker(line)) {
        i++;
        continue;
      }

      // 围栏代码块
      const fm = line.match(RE.fence);
      if (fm) {
        const fenceCh = fm[2][0];
        const minLen = Math.max(3, fm[2].length);
        const buf: string[] = [];
        i++;
        while (i < ls.length) {
          const close = ls[i].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
          if (close && close[1][0] === fenceCh && close[1].length >= minLen) break;
          buf.push(ls[i]);
          i++;
        }
        if (i >= ls.length) warnings.push('代码块缺少结束围栏，已按到文末处理');
        i++; // 跳过结束围栏（或越过文末）
        stats.codeBlocks++;
        out.push({ type: 'code', lang: fm[3] || '', text: buf.join('\n'), fenced: true });
        continue;
      }

      // 缩进代码块（4 空格 / 1 制表符，且前面是空行或文档开头）
      if (/^( {4}|\t)/.test(line) && (out.length === 0 || !ls[i - 1].trim())) {
        const buf: string[] = [];
        while (i < ls.length && (/^( {4}|\t)/.test(ls[i]) || !ls[i].trim())) {
          buf.push(ls[i].replace(/^(\t| {4})/, ''));
          i++;
        }
        while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
        if (buf.length) {
          stats.codeBlocks++;
          out.push({ type: 'code', lang: '', text: buf.join('\n'), fenced: false });
        }
        continue;
      }

      // ATX 标题
      const hm = line.match(RE.atx);
      if (hm && hm[2].trim()) {
        stats.headings++;
        const segs = parseInline(hm[2].trim(), inlineStats, refDefs);
        out.push({ type: 'heading', level: hm[1].length as 1 | 2 | 3, text: segsToText(segs), segs });
        i++;
        continue;
      }

      // Setext 标题（下一行是 === / --- 且当前行非分隔线）
      if (
        i + 1 < ls.length &&
        line.trim() &&
        !RE.hr.test(line) &&
        !RE.fence.test(line) &&
        /^\s{0,3}(={1,}|-{1,})\s*$/.test(ls[i + 1])
      ) {
        stats.headings++;
        const segs = parseInline(line.trim(), inlineStats, refDefs);
        out.push({ type: 'heading', level: ls[i + 1].includes('=') ? 1 : 2, text: segsToText(segs), segs });
        i += 2;
        continue;
      }

      // 分隔线
      if (RE.hr.test(line)) {
        out.push({ type: 'hr' });
        i++;
        continue;
      }

      // 引用块（> 开头；懒延续：紧随的非空普通行也并入）
      if (RE.quote.test(line)) {
        const buf: string[] = [];
        while (i < ls.length) {
          const qm = ls[i].match(RE.quote);
          if (qm) {
            buf.push(qm[1]);
            i++;
          } else if (ls[i].trim() && buf.length > 0 && !RE.fence.test(ls[i]) && !listMarker(ls[i])) {
            buf.push(ls[i].trim()); // 懒延续行
            i++;
          } else break;
        }
        stats.quotes++;
        out.push({ type: 'quote', blocks: parseBlocks(buf, depth + 1) });
        continue;
      }

      // 表格（当前行含 | 且下一行是对齐分隔行）
      if (line.includes('|') && i + 1 < ls.length) {
        const align = parseAlignSep(ls[i + 1]);
        if (align && RE.tableRow.test(line) && line.includes('|')) {
          const header = splitTableRow(line);
          i += 2;
          const rows: string[][] = [];
          while (i < ls.length && RE.tableRow.test(ls[i]) && ls[i].includes('|') && !RE.fence.test(ls[i])) {
            rows.push(splitTableRow(ls[i]));
            i++;
          }
          stats.tables++;
          out.push({ type: 'table', header, align, rows });
          continue;
        }
      }

      // 列表
      const first = listMarker(line);
      if (first) {
        const ctx = { ordered: first.ordered, start: first.start, items: [] as { segs: InlineSeg[]; children: IRBlock[] }[] };
        let counted = false;
        while (i < ls.length) {
          const cur = ls[i];
          if (!cur.trim()) {
            // 空行：下一行仍是列表项或深缩进续行 → 松散列表继续
            if (i + 1 < ls.length && (listMarker(ls[i + 1])?.indent ?? -1) >= first.indent) {
              i++;
              continue;
            }
            break;
          }
          const mk = listMarker(cur);
          if (mk) {
            if (mk.indent < first.indent) break; // 更浅：交回上层
            if (mk.indent === first.indent && mk.ordered === ctx.ordered) {
              // 同层新项
              const item = { segs: parseInline(mk.content, inlineStats, refDefs), children: [] as IRBlock[] };
              ctx.items.push(item);
              if (!counted) {
                stats.lists++;
                counted = true;
              }
              stats.listItems++;
              i++;
              // 收集本项的续行与嵌套子块（含嵌套列表/代码块）
              const sub: string[] = [];
              while (i < ls.length && ls[i].trim()) {
                const deeper = listMarker(ls[i]);
                if (deeper && deeper.indent <= first.indent) break; // 下一项/上层项
                if (
                  (deeper && deeper.indent > first.indent) ||
                  /^\s{2,}\S/.test(ls[i]) ||
                  RE.fence.test(ls[i]) ||
                  RE.quote.test(ls[i])
                ) {
                  sub.push(stripToContent(ls[i], first.indent + first.markerLen));
                  i++;
                } else break;
              }
              if (sub.length) item.children = parseBlocks(sub, depth + 1);
              continue;
            }
          }
          break;
        }
        out.push({ type: 'list', ordered: ctx.ordered, start: ctx.start, items: ctx.items });
        continue;
      }

      // 段落（合并连续普通行）
      const buf: string[] = [];
      while (i < ls.length && ls[i].trim() && !opensBlock(ls[i])) {
        buf.push(ls[i].trim());
        i++;
        if (i < ls.length && !ls[i].trim()) break;
      }
      if (buf.length) {
        const segs = parseInline(buf.join(' '), inlineStats, refDefs);
        out.push({ type: 'paragraph', text: segsToText(segs), segs });
      } else {
        i++; // 保险：绝不空转
      }
    }
    return out;
  }

  /** 该行是否会开启一个新块（段落合并的终止条件） */
  function opensBlock(line: string): boolean {
    return (
      RE.fence.test(line) ||
      RE.atx.test(line) ||
      RE.hr.test(line) ||
      RE.quote.test(line) ||
      !!listMarker(line)
    );
  }

  /** 列表续行去掉到项内容列的缩进，保留相对层级（缩进代码/嵌套列表靠它对齐） */
  function stripToContent(line: string, cols: number): string {
    let n = 0;
    let idx = 0;
    while (idx < line.length && n < cols) {
      if (line[idx] === '\t') n += 4 - (n % 4);
      else n++;
      idx++;
    }
    return line.slice(idx);
  }

  // 标题：首个 heading，否则文件名去扩展名
  const firstHeading = blocks.find((b): b is Extract<IRBlock, { type: 'heading' }> => b.type === 'heading');
  const nameBase = input.name ? input.name.replace(/\.[^.]+$/, '') : '';
  const title = firstHeading?.text || nameBase || '';

  mergeStats(stats, {
    headings: 0,
    lists: 0,
    listItems: 0,
    codeBlocks: 0,
    tables: 0,
    quotes: 0,
    links: inlineStats.links,
    images: inlineStats.images,
    emphasis: inlineStats.emphasis,
    inlineCode: inlineStats.inlineCode,
  });

  return {
    format: 'markdown',
    plugin: markdownPlugin.id,
    title,
    blocks,
    stats,
    warnings,
  };
}
