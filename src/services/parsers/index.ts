/**
 * 解析插件统一出口：AIReader（及其他消费方）只 import 这一个文件。
 */
export type {
  DocumentIR,
  IRBlock,
  IRStats,
  InlineSeg,
} from './ir';
export {
  emptyStats,
  mergeStats,
  segsToText,
  irToText,
} from './ir';
export {
  parseDocument,
  describeIR,
  isMarkdown,
  markdownSniffScore,
  MARKDOWN_EXTS,
  /** 直接按 Markdown 解析（跳过格式判定），供 AI 输出渲染使用 */
  markdownPlugin,
  type ParseInput,
  type ParserPlugin,
  type ParseResult,
} from './registry';
