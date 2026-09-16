import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';

/**
 * EllipsisTip —— 自包含的「省略截断 + 悬浮完整提示」组件
 *
 * 样式与逻辑全部内聚于本文件（内联样式，无外部 CSS、无伪元素依赖），
 * 复制单个文件即可在任何 React 项目中独立使用与替换：
 *
 * - 仅当内容真的被截断（scrollWidth > clientWidth）时才出现提示；
 * - 气泡通过 portal 渲染到 document.body（fixed 定位），不受父级
 *   overflow / 滚动容器裁剪，深层嵌套列表中同样稳定；
 * - 自动上/下翻转 + 水平视口夹紧，任何位置的条目气泡都完整可见；
 * - 滚动 / 缩放窗口立即收起，杜绝气泡滞留在失效坐标上；
 * - 支持键盘聚焦触发与 Esc 关闭；prefers-reduced-motion 下无动画。
 *
 * 职责边界：布局类样式（宽度、间距、flex）由使用方通过 className/style
 * 提供；本组件只负责「截断行为 + 气泡外观」，与页面互不感知内部实现。
 * 配色优先读取主题 token（--ink/--surface），缺失时回退内置值。
 */

const GAP = 10; // 气泡与目标的间距
const EDGE = 8; // 气泡距视口边缘的最小距离
const BG = 'var(--ink, #17171c)';
const FG = 'var(--surface, #fff)';

interface TipPos {
  left: number;
  top: number;
  arrow: number;
  placement: 'top' | 'bottom';
}

export function EllipsisTip({
  text,
  className,
  style,
  maxWidth = 320,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
  maxWidth?: number;
}) {
  const elRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPos | null>(null);

  const place = useCallback(() => {
    const el = elRef.current;
    const tip = tipRef.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const left = Math.min(
      Math.max(r.left + r.width / 2 - t.width / 2, EDGE),
      Math.max(EDGE, vw - t.width - EDGE)
    );
    const placement: TipPos['placement'] =
      r.top - t.height - GAP - 8 >= 0 ? 'top' : 'bottom';
    const top = placement === 'top' ? r.top - t.height - GAP : r.bottom + GAP;
    const arrow = Math.min(
      Math.max(r.left + r.width / 2 - left, 16),
      Math.max(16, t.width - 16)
    );
    setPos({ left, top, arrow, placement });
  }, []);

  // 打开后先以 hidden 状态测量，再在绘制前定位，避免闪跳
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, text]);

  // 打开期间监听滚动/缩放：立即收起，避免气泡停留在失效坐标
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const show = () => {
    const el = elRef.current;
    setOpen(!!el && el.scrollWidth > el.clientWidth + 1);
  };
  const hide = () => setOpen(false);

  const reducedMotion =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  const arrowStyle: CSSProperties =
    pos?.placement === 'bottom'
      ? { top: -5, left: pos.arrow - 5 }
      : { bottom: -5, left: pos ? pos.arrow - 5 : 0 };

  return (
    <>
      <span
        ref={elRef}
        className={className}
        style={{
          ...style,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
      >
        {text}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              maxWidth: `min(${maxWidth}px, calc(100vw - ${EDGE * 2}px))`,
              width: 'max-content',
              boxSizing: 'border-box',
              padding: '7px 11px',
              borderRadius: 8,
              background: BG,
              color: FG,
              fontSize: 12.5,
              lineHeight: 1.6,
              boxShadow: '0 6px 20px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.10)',
              zIndex: 9999,
              pointerEvents: 'none',
              visibility: pos ? 'visible' : 'hidden',
              opacity: pos ? 1 : 0,
              transition: reducedMotion ? 'none' : 'opacity .14s ease-out',
            }}
          >
            {text}
            <span
              style={{
                position: 'absolute',
                width: 10,
                height: 10,
                background: BG,
                transform: 'rotate(45deg)',
                borderRadius: 2,
                ...arrowStyle,
              }}
            />
          </div>,
          document.body
        )}
    </>
  );
}
