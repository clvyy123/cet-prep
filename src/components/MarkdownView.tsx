/**
 * Markdown 渲染视图：把 Markdown 文本渲染成排版化的 JSX。
 * 数据来源复用解析插件的 Markdown 解析器（同一套 IR，保证识别一致），
 * 不引入第三方渲染库，主题跟随全站 CSS 变量（见 styles.css 第 34 节）。
 *
 * 用途：AI 输出结果的格式化渲染（输入框保持纯文本，不走这里）。
 */
import type { CSSProperties } from 'react';
import type { InlineSeg, IRBlock } from '../services/parsers';
import { markdownPlugin } from '../services/parsers';

export default function MarkdownView({ text }: { text: string }) {
  const ir = markdownPlugin.parse({ content: text });
  return (
    <div className="md-view">
      {ir.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: IRBlock }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, block.level + 1)}` as 'h2'; // AI 输出里的 H1 降一级当小节标题
      return <Tag className={`md-h md-h${block.level}`}>{block.text}</Tag>;
    }
    case 'paragraph':
      return <p><InlineView segs={block.segs} /></p>;
    case 'list': {
      const items = block.items.map((it, i) => (
        <li key={i}>
          <InlineView segs={it.segs} />
          {it.children.length > 0 && (
            <div className="md-sub">{it.children.map((c, j) => <BlockView key={j} block={c} />)}</div>
          )}
        </li>
      ));
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'code':
      return (
        <pre>
          {block.lang && <span className="dt-tag md-lang">{block.lang}</span>}
          <code>{block.text}</code>
        </pre>
      );
    case 'quote':
      return <blockquote>{block.blocks.map((b, i) => <BlockView key={i} block={b} />)}</blockquote>;
    case 'table': {
      const style = (a: 'l' | 'c' | 'r'): CSSProperties => ({ textAlign: a === 'c' ? 'center' : a === 'r' ? 'right' : 'left' });
      return (
        <table>
          <thead>
            <tr>{block.header.map((c, i) => <th key={i} style={style(block.align[i] ?? 'l')}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} style={style(block.align[j] ?? 'l')}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'hr':
      return <hr />;
  }
}

function InlineView({ segs }: { segs: InlineSeg[] }) {
  return <>{segs.map((s, i) => <SegView key={i} seg={s} />)}</>;
}

function SegView({ seg }: { seg: InlineSeg }) {
  switch (seg.type) {
    case 'text':
      return <>{seg.text}</>;
    case 'code':
      return <code className="md-code">{seg.text}</code>;
    case 'em':
      return <em><InlineView segs={seg.children} /></em>;
    case 'strong':
      return <strong><InlineView segs={seg.children} /></strong>;
    case 'del':
      return <del><InlineView segs={seg.children} /></del>;
    case 'link':
      // Electron 主进程会拦截新窗口并用系统浏览器打开
      return <a href={seg.url} title={seg.title} target="_blank" rel="noreferrer"><InlineView segs={seg.children} /></a>;
    case 'image':
      return <span className="md-img" title={seg.url}>[图：{seg.alt || '无描述'}]</span>;
  }
}
