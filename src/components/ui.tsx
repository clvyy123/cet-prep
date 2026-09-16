import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { MistakeItem } from '../types';
import { addMistake, hasMistake } from '../services/mistakes';
import Icon, { type IconName } from './Icon';

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

/** 「加入错题本」按钮（已添加后显示状态；初始即感知是否已存在） */
export function AddMistakeBtn({ item }: { item: Omit<MistakeItem, 'id' | 'addedAt' | 'mastered'> }) {
  const [added, setAdded] = useState(false);
  const [exists, setExists] = useState(() => hasMistake(item));

  if (added) {
    return (
      <Tag tone="green">
        <Icon name="check" size={13} />
        已加入错题本
      </Tag>
    );
  }
  if (exists) {
    return <Tag tone="gray">已在错题本中</Tag>;
  }
  return (
    <button
      className="btn btn-sm"
      onClick={() => {
        const ok = addMistake(item);
        if (ok) setAdded(true);
        else setExists(true);
      }}
      title="加入错题本，可在错题本中查看解析、原文依据、高频词与 AI 分析"
    >
      <Icon name="pin" size={15} />
      加入错题本
    </button>
  );
}

export function Tag({ children, tone = 'blue', wrap = false }: { children: ReactNode; tone?: 'blue' | 'green' | 'orange' | 'red' | 'gray' | 'purple'; wrap?: boolean }) {
  return <span className={`tag tag-${tone}${wrap ? ' tag-wrap' : ''}`}>{children}</span>;
}

export function ProgressBar({ value, max, tone = 'blue' }: { value: number; max: number; tone?: 'blue' | 'green' | 'orange' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div className={`progress-fill progress-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = 520,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  // 弹窗打开时按 Esc 关闭（且阻止冒泡到页面级返回监听）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** 官方解析的不同部分（【答案】【定位】【精析】【避错】【考点】等）在每个小标题前补换行，便于逐段阅读 */
export function formatAnalysis(text: string): string {
  return text.replace(/(【[^】]+】)/g, '\n$1').replace(/^\n+/, '').trim();
}

export function AnalysisBtn({ text, label = '解析' }: { text?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const formatted = formatAnalysis(text);
  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        <Icon name="bulb" size={15} />
        {label}
      </button>
      {open && (
        <Modal title="题目解析" onClose={() => setOpen(false)}>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, fontSize: 14 }}>{formatted}</div>
        </Modal>
      )}
    </>
  );
}

export function Empty({ icon = 'book', text }: { icon?: IconName; text: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <p>{text}</p>
    </div>
  );
}

export function PageHeader({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {extra && <div className="page-header-extra">{extra}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`tab ${active === t.key ? 'tab-active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.badge !== undefined && t.badge > 0 && <span className="tab-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** 按年份筛选试卷 */
export function YearFilter({ years, value, onChange }: { years: number[]; value: number | 'all'; onChange: (y: number | 'all') => void }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span className="small muted">年份</span>
      <button className={`btn btn-sm ${value === 'all' ? 'btn-primary' : ''}`} onClick={() => onChange('all')}>全部</button>
      {years.map((y) => (
        <button key={y} className={`btn btn-sm ${value === y ? 'btn-primary' : ''}`} onClick={() => onChange(y)}>{y}</button>
      ))}
    </div>
  );
}
