import { lazy, Suspense, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import SelectionMenu from './components/SelectionMenu';
import { applyTheme } from './theme';
import { getSettings } from './services/storage';

// 页面按需加载：papers/builtin-banks/词库等大数据只随对应页面的 chunk 解析，首屏不再全量加载
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Vocabulary = lazy(() => import('./pages/Vocabulary'));
const Practice = lazy(() => import('./pages/Practice'));
const Papers = lazy(() => import('./pages/Papers'));
const MockExam = lazy(() => import('./pages/MockExam'));
const AIReader = lazy(() => import('./pages/AIReader'));
const Settings = lazy(() => import('./pages/Settings'));
const Mistakes = lazy(() => import('./pages/Mistakes'));

export type PageKey =
  | 'dashboard'
  | 'vocabulary'
  | 'practice'
  | 'papers'
  | 'mistakes'
  | 'exam'
  | 'aireader'
  | 'settings';

export default function App() {
  const [page, setPage] = useState<PageKey>('dashboard');

  useEffect(() => {
    applyTheme(getSettings().theme);
  }, []);

  return (
    <div className="app">
      {/* Electron 桌面端：隐藏了原生标题栏，顶部留一条拖拽区（纯浏览器无此需要） */}
      {window.cetAPI ? <div className="titlebar-drag" aria-hidden="true" /> : null}
      <Sidebar page={page} onNavigate={setPage} />
      <main className="main">
        <Suspense fallback={<div className="muted" style={{ padding: 24 }}>加载中…</div>}>
          {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
          {page === 'vocabulary' && <Vocabulary />}
          {page === 'practice' && <Practice />}
          {page === 'papers' && <Papers />}
          {page === 'mistakes' && <Mistakes />}
          {page === 'exam' && <MockExam />}
          {page === 'aireader' && <AIReader />}
          {page === 'settings' && <Settings />}
        </Suspense>
      </main>
      <SelectionMenu />
    </div>
  );
}
