import { useEffect, useMemo, useState } from 'react';
import type { PageKey } from '../App';
import type { Word, WordProgress } from '../types';
import { WORDS, BOOK_META } from '../data/words';
import { getActivity, getRecentActivity, load, KEYS, ensureSeeded, getAllWords, dateKey } from '../services/storage';
import { isDue } from '../services/srs';
import { loadExams } from '../services/exam';
import { Card, Tag, ProgressBar } from '../components/ui';
import Icon, { type IconName } from '../components/Icon';

const QUICK: { key: PageKey; icon: IconName; title: string; desc: string }[] = [
  { key: 'vocabulary', icon: 'book', title: '单词记忆', desc: '学习新词 · 间隔复习' },
  { key: 'practice', icon: 'pen', title: '真题练习', desc: '五大题型真题精练' },
  { key: 'exam', icon: 'timer', title: '模拟考试', desc: '限时全真模拟 · 估分' },
  { key: 'aireader', icon: 'sparkle', title: 'AI 阅读', desc: 'AI 解析长难句' },
  { key: 'settings', icon: 'gear', title: '设置', desc: 'AI 配置 · 数据管理' },
];

export default function Dashboard({ onNavigate }: { onNavigate: (p: PageKey) => void }) {
  const [words, setWords] = useState<Word[]>(WORDS);
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});

  useEffect(() => {
    ensureSeeded();
    setWords(getAllWords());
    setProgress(load<Record<string, WordProgress>>(KEYS.progress, {}));
  }, []);

  const exams = useMemo(() => loadExams(), []);
  const activity = useMemo(() => getActivity(), []);
  const week = useMemo(() => getRecentActivity(7), []);

  // 使用本地日期键（与 storage.dateKey 一致）
  const d = new Date();
  const today = dateKey(d);
  const todayAct = activity[today] ?? { learned: 0, reviewed: 0, practiced: 0, correct: 0, wrong: 0 };

  const mastered = Object.values(progress).filter((p) => p.status === 'mastered').length;
  const learned = Object.values(progress).filter((p) => p.status !== 'new' || p.reviewCount > 0).length;
  const due = words.filter((w) => progress[w.id] && isDue(progress[w.id]) && progress[w.id].status !== 'mastered').length;

  // 连续打卡天数：今天还没学习时从昨天开始倒推，避免刚过午夜 streak 归零
  let streak = 0;
  const cursor = new Date();
  const hasActivity = (k: string) => {
    const a = activity[k];
    return !!(a && (a.learned + a.reviewed + a.practiced) > 0);
  };
  // 今天有活动才计入今天，否则从昨天起算
  if (hasActivity(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  } else {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (hasActivity(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const avg = exams.length
    ? Math.round(exams.reduce((s, e) => s + e.totalScore, 0) / exams.length)
    : null;

  // 各词库的学习进度，作为「词库进度」数据表的行数据
  const bookStats = useMemo(
    () =>
      BOOK_META.map((b) => {
        const list = words.filter((w) => w.book === b.key);
        let learnedN = 0;
        let masteredN = 0;
        for (const w of list) {
          const p = progress[w.id];
          if (!p) continue;
          if (p.status === 'mastered') {
            masteredN++;
            learnedN++;
          } else if (p.status !== 'new' || p.reviewCount > 0) {
            learnedN++;
          }
        }
        return { key: b.key, label: b.label, total: list.length, learned: learnedN, mastered: masteredN };
      }).filter((b) => b.total > 0),
    [words, progress]
  );

  const todayGoal = 30; // 与设置默认一致，简单展示
  const todayTotal = todayAct.learned + todayAct.reviewed;

  const weekMax = Math.max(1, ...week.map((w) => w.act.learned + w.act.reviewed + w.act.practiced));
  const hasWeekActivity = week.some((w) => w.act.learned + w.act.reviewed + w.act.practiced > 0);

  const greeting =
    d.getHours() < 6 ? '夜深了' : d.getHours() < 12 ? '早上好' : d.getHours() < 18 ? '下午好' : '晚上好';

  const stats: { icon: IconName; num: string | number; lbl: string }[] = [
    { icon: 'bolt', num: todayAct.learned + todayAct.reviewed, lbl: '今日学习（新词 + 复习）' },
    { icon: 'trophy', num: mastered, lbl: `已掌握单词 / ${words.length}` },
    { icon: 'flame', num: streak, lbl: '连续打卡天数' },
    { icon: 'chart', num: avg ?? '—', lbl: `模拟考平均分（${exams.length} 次）` },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>{greeting}，备考人</h2>
          <p>
            {d.getMonth() + 1} 月 {d.getDate()} 日 · 今天已学习 {todayTotal} 个单词
            {due > 0 ? ` · 还有 ${due} 个单词待复习` : ''}
          </p>
        </div>
        {due > 0 && (
          <button className="btn btn-primary" onClick={() => onNavigate('vocabulary')}>
            去复习（{due}）
          </button>
        )}
      </div>

      <Card className="stat-row mb-16">
        {stats.map((s) => (
          <div key={s.lbl} className="stat-cell">
            <div className="stat-icon">
              <Icon name={s.icon} size={18} />
            </div>
            <div className="stat-info">
              <div className="num">{s.num}</div>
              <div className="lbl">{s.lbl}</div>
            </div>
          </div>
        ))}
      </Card>

      <div className="grid-2 mb-16">
        <Card>
          <h3 style={{ marginTop: 0 }}>今日目标</h3>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">单词学习 {todayTotal} / {todayGoal}</span>
            <span className="small muted">{Math.min(100, Math.round((todayTotal / todayGoal) * 100))}%</span>
          </div>
          <ProgressBar value={todayTotal} max={todayGoal} />
          <div className="small muted mt-16">
            {todayAct.correct + todayAct.wrong > 0
              ? `今日练习正确率：${Math.round((todayAct.correct / (todayAct.correct + todayAct.wrong)) * 100)}%（${todayAct.correct}/${todayAct.correct + todayAct.wrong}）`
              : '今日还未做练习，去真题练习或单词测验吧！'}
          </div>
          <div className="mt-16">
            <div className="small muted">已学习 {learned} 词</div>
            <ProgressBar value={learned} max={words.length} tone="green" />
          </div>
        </Card>

        <Card>
          <h3 style={{ marginTop: 0 }}>最近 7 天学习活跃度</h3>
          <div className="chart-wrap">
            <div className="chart">
              {week.map((w) => {
                const total = w.act.learned + w.act.reviewed + w.act.practiced;
                return (
                  <div key={w.date} className="chart-col">
                    <div className="chart-track">
                      <div
                        className={`chart-bar ${total === 0 ? 'is-empty' : ''}`}
                        style={{ height: `${Math.max(total === 0 ? 4 : 8, Math.round((total / weekMax) * 104))}px` }}
                      />
                    </div>
                    <div className="chart-label">{total > 0 ? total : ''}</div>
                    <div className="chart-label">{w.date.slice(5)}</div>
                  </div>
                );
              })}
            </div>
            {!hasWeekActivity && <div className="chart-hint">本周还没有学习记录</div>}
          </div>
        </Card>
      </div>

      <Card className="mb-16">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>词库进度</h3>
          <span className="small muted">
            共 {words.length.toLocaleString()} 词 · 已掌握 {mastered.toLocaleString()}
          </span>
        </div>
        <div className="data-table mt-16">
          <div className="dt-head">
            <span>词库</span>
            <span>总量</span>
            <span>已学</span>
            <span>已掌握</span>
            <span>掌握进度</span>
          </div>
          {bookStats.map((b) => {
            const pct = b.total ? Math.round((b.mastered / b.total) * 100) : 0;
            return (
              <div className="dt-row" key={b.key}>
                <span className="dt-name">
                  <span className="dt-tag">{b.label}</span>
                </span>
                <span className="dt-num">{b.total.toLocaleString()}</span>
                <span className="dt-num">{b.learned.toLocaleString()}</span>
                <span className="dt-num">{b.mastered.toLocaleString()}</span>
                <span className="dt-prog">
                  <span className="dt-bar">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <em>{pct}%</em>
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mb-16">
        <h3 style={{ marginTop: 0 }}>快捷入口</h3>
        <div className="quick-grid">
          {QUICK.map((q) => (
            <div key={q.key} className="quick-item" onClick={() => onNavigate(q.key)}>
              <div className="qi-icon">
                <Icon name={q.icon} size={19} />
              </div>
              <div className="qi-title">{q.title}</div>
              <div className="qi-desc">{q.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      {exams.length > 0 && (
        <Card>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>最近考试</h3>
            <button className="btn btn-sm" onClick={() => onNavigate('exam')}>查看全部 →</button>
          </div>
          <div className="data-table dt-3 mt-16">
            <div className="dt-head">
              <span>类型</span>
              <span>考试时间</span>
              <span>总分</span>
            </div>
            {exams.slice(0, 5).map((e) => (
              <div key={e.id} className="dt-row">
                <span className="dt-name">
                  <Tag tone={e.type === 'cet4' ? 'blue' : 'purple'}>{e.type === 'cet4' ? '四级' : '六级'}</Tag>
                </span>
                <span className="dt-num dt-left">{new Date(e.date).toLocaleString('zh-CN')}</span>
                <span className="dt-num">
                  <b>{e.totalScore}</b> <span className="muted">/ 710</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
