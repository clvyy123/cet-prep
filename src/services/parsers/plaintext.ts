/**
 * 内置插件：纯文本兜底。
 * 任何没被其他插件认领的输入都走这里——优雅降级的最后一站。
 * 只做最保守的规整：去 BOM、统一换行、去行尾空白，结构一律视为段落。
 */

import type { DocumentIR, IRBlock } from './ir';
import { emptyStats } from './ir';
import type { ParseInput, ParserPlugin } from './markdown';

export const plaintextPlugin: ParserPlugin = {
  id: 'builtin-plaintext',
  label: '纯文本',
  format: 'plaintext',
  // 永远接得住：注册表把它放最后，前面没人要就归它
  detect: () => true,
  parse: (input) => parsePlaintext(input),
};

export function parsePlaintext(input: ParseInput): DocumentIR {
  const raw = input.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks: IRBlock[] = raw
    .split(/\n{2,}/) // 空行分段
    .map((p) => p.replace(/[ \t]+$/gm, '').trim())
    .filter((p) => p)
    .map((text) => ({ type: 'paragraph' as const, text, segs: [{ type: 'text' as const, text }] }));

  const firstHeading = input.name ? input.name.replace(/\.[^.]+$/, '') : '';

  return {
    format: 'plaintext',
    plugin: plaintextPlugin.id,
    title: firstHeading,
    blocks,
    stats: { ...emptyStats() },
    warnings: [],
  };
}
