/**
 * 解析插件注册表 —— 解析管道的统一入口。
 *
 * 管道集成方式：拿到「文件名 + 原始文本」后调 parseDocument()，
 * 注册表按插件优先级依次 detect()，命中的插件产出统一 IR。
 * 设计目标：
 *  - 永不抛错：单插件解析异常 → 记 warning 并降级到纯文本插件；
 *  - 无插件认领 → 纯文本兜底（优雅降级）；
 *  - 新格式支持 = 新增一个 ParserPlugin 并注册进 PLUGINS，管道零改动。
 */

import type { DocumentIR } from './ir';
import { markdownPlugin, type ParseInput, type ParserPlugin } from './markdown';
import { plaintextPlugin } from './plaintext';

export type { ParseInput, ParserPlugin };
export { markdownSniffScore, isMarkdown, MARKDOWN_EXTS, markdownPlugin } from './markdown';

/** 插件优先级：Markdown 在前，纯文本兜底永远最后。后续新格式插件插到 plaintext 之前。 */
const PLUGINS: ParserPlugin[] = [markdownPlugin, plaintextPlugin];

export interface ParseResult extends DocumentIR {
  /** 是否发生了降级（预期插件失败转投纯文本等） */
  degraded: boolean;
}

/** 解析结果摘要（UI 提示用） */
export function describeIR(ir: DocumentIR): string {
  const s = ir.stats;
  const parts: string[] = [];
  if (s.headings) parts.push(`标题 ${s.headings}`);
  if (s.lists) parts.push(`列表 ${s.lists}`);
  if (s.codeBlocks) parts.push(`代码块 ${s.codeBlocks}`);
  if (s.tables) parts.push(`表格 ${s.tables}`);
  if (s.links) parts.push(`链接 ${s.links}`);
  if (s.images) parts.push(`图片 ${s.images}`);
  if (s.emphasis) parts.push(`强调 ${s.emphasis}`);
  return parts.length ? parts.join(' · ') : '未识别到结构元素';
}

/**
 * 统一入口：文件 → 统一中间表示。
 * input.name 用于格式判定与标题回退；input.content 为 UTF-8 文本。
 */
export function parseDocument(input: ParseInput): ParseResult {
  // 找第一个认领该输入的插件（纯文本兜底永远在最后，必然命中）
  const plugin = PLUGINS.find((p) => safeDetect(p, input)) ?? plaintextPlugin;
  try {
    const ir = plugin.parse(input);
    return { ...ir, degraded: false };
  } catch (e) {
    // 插件级异常：降级到纯文本，记录原因，不阻断管道
    const fallback = plaintextPlugin.parse(input);
    return {
      ...fallback,
      plugin: `${fallback.plugin} (fallback from ${plugin.id})`,
      warnings: [`「${plugin.label}」解析失败，已按纯文本处理：${(e as Error).message || e}`],
      degraded: true,
    };
  }
}

function safeDetect(p: ParserPlugin, input: ParseInput): boolean {
  try {
    return p.detect(input);
  } catch {
    return false;
  }
}
