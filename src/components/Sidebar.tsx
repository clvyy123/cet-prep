import type { PageKey } from '../App';
import Icon, { type IconName } from './Icon';

const NAV: { key: PageKey; label: string; icon: IconName }[] = [
  { key: 'dashboard', label: '首页', icon: 'home' },
  { key: 'vocabulary', label: '单词记忆', icon: 'book' },
  { key: 'practice', label: '真题练习', icon: 'pen' },
  { key: 'papers', label: '试卷', icon: 'doc' },
  { key: 'mistakes', label: '错题本', icon: 'bookmark' },
  { key: 'exam', label: '模拟考试', icon: 'timer' },
  { key: 'aireader', label: 'AI 阅读', icon: 'sparkle' },
  { key: 'settings', label: '设置', icon: 'gear' },
];

export default function Sidebar({
  page,
  onNavigate,
}: {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img className="logo-mark" src="/app-icon.png" alt="CET备考助手" draggable={false} />
        <div className="logo-name">CET</div>
      </div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${page === item.key ? 'nav-active' : ''}`}
            onClick={() => onNavigate(item.key)}
            title={item.label}
            aria-current={page === item.key ? 'page' : undefined}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={21} />
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <Icon name="shield" size={15} />
        <div className="foot-line">本地存储</div>
      </div>
    </aside>
  );
}
