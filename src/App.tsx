import { lazy, Suspense, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import SelectionMenu from './components/SelectionMenu';
import Onboarding from './components/Onboarding';
import type { Level } from './types';
import { applyTheme } from './theme';
import { getSettings, load, save, saveSettings, KEYS } from './services/storage';
import { recordVisit } from './services/tasks';
import { startExamSync } from './services/exam-sync';

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
  // S4 首启引导：null = 判定中；true = 全新用户弹引导；false = 不弹
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  // S2 任务卡「去完成」直开的试卷：挂载 Papers 时作为初始 openId
  const [paperFocus, setPaperFocus] = useState<string | null>(null);
  // 引导完成后重挂 Dashboard，让倒计时与任务卡立刻读到新配置
  const [dashKey, setDashKey] = useState(0);

  useEffect(() => {
    applyTheme(getSettings().theme);
    // 首启判定：已有学习进度 / 考试记录 / 活动数据 / 用户词，即视为老用户——静默标记跳过
    const hasData =
      load<unknown[]>(KEYS.progress, []).length > 0 ||
      load<unknown[]>(KEYS.exams, []).length > 0 ||
      load<unknown[]>(KEYS.words, []).length > 0 ||
      Object.keys(load<Record<string, unknown>>(KEYS.activity, {})).length > 0;
    if (load<boolean>(KEYS.onboarded, false)) {
      setOnboarding(false);
    } else if (hasData) {
      save(KEYS.onboarded, true);
      setOnboarding(false);
    } else {
      setOnboarding(true);
    }
  }, []);

  // 「一键继续上次」：记录最近访问的任务页（总览不算任务页，见 recordVisit）
  useEffect(() => {
    recordVisit(page);
  }, [page]);

  // 考试时间同步插件：启动 3s 后同步一次，之后按 Settings.examSyncHours 周期轮询
  useEffect(() => startExamSync(), []);

  // 离开试卷页时清掉直开目标，避免之后再从侧栏进试卷页时重复打开同一套卷
  useEffect(() => {
    if (page !== 'papers') setPaperFocus(null);
  }, [page]);

  const finishOnboarding = (cfg: { examLevel: Level; examDate: string; targetScore: number }) => {
    saveSettings({ ...getSettings(), ...cfg });
    save(KEYS.onboarded, true);
    setOnboarding(false);
    setDashKey((k) => k + 1);
  };

  const skipOnboarding = () => {
    save(KEYS.onboarded, true);
    setOnboarding(false);
  };

  const openPaperFromTask = (paperId: string) => {
    setPaperFocus(paperId);
    setPage('papers');
  };

  return (
    <div className="app">
      {/* Electron 桌面端：隐藏了原生标题栏，顶部留一条拖拽区（纯浏览器无此需要） */}
      {window.cetAPI ? <div className="titlebar-drag" aria-hidden="true" /> : null}
      <Sidebar page={page} onNavigate={setPage} />
      <main className="main">
        <Suspense fallback={<div className="muted" style={{ padding: 24 }}>加载中…</div>}>
          {page === 'dashboard' && (
            <Dashboard key={dashKey} onNavigate={setPage} onOpenPaper={openPaperFromTask} />
          )}
          {page === 'vocabulary' && <Vocabulary />}
          {page === 'practice' && <Practice />}
          {page === 'papers' && <Papers key={paperFocus ?? 'papers'} initialOpenId={paperFocus} />}
          {page === 'mistakes' && <Mistakes />}
          {page === 'exam' && <MockExam />}
          {page === 'aireader' && <AIReader />}
          {page === 'settings' && <Settings />}
        </Suspense>
      </main>
      <SelectionMenu />
      {onboarding && <Onboarding onFinish={finishOnboarding} onSkip={skipOnboarding} />}
    </div>
  );
}
