import { useEffect, useMemo, useState } from 'react';
import type { PageKey } from '../App';
import type { DayPlan, Word, WordProgress } from '../types';
import { WORDS, BOOK_META } from '../data/words';
import { getActivity, getRecentActivity, load, KEYS, ensureSeeded, getAllWords, dateKey, getSettings, saveSettings } from '../services/storage';
import { isDue } from '../services/srs';
import { loadExams } from '../services/exam';
import {
  ensureTodayPlan,
  togglePlanTask,
  recordPlanComplete,
  weekPlanDone,
  getLastVisit,
  PAGE_LABELS,
} from '../services/tasks';
import { EXAM_BY_LEVEL, daysUntilExam } from '../data/exam-dates';
import { Card, Tag, ProgressBar } from '../components/ui';
import ExamCalendar from '../components/ExamCalendar';
import Icon, { type IconName } from '../components/Icon';

const QUICK: { key: PageKey; icon: IconName; title: string; desc: string }[] = [
  { key: 'vocabulary', icon: 'book', title: '单词记忆', desc: '学习新词 · 间隔复习' },
  { key: 'practice', icon: 'pen', title: '真题练习', desc: '五大题型真题精练' },
  { key: 'exam', icon: 'timer', title: '模拟考试', desc: '限时全真模拟 · 估分' },
  { key: 'aireader', icon: 'sparkle', title: 'AI 阅读', desc: 'AI 解析长难句' },
  { key: 'settings', icon: 'gear', title: '设置', desc: 'AI 配置 · 数据管理' },
];

export default function Dashboard({
  onNavigate,
  onOpenPaper,
}: {
  onNavigate: (p: PageKey) => void;
  onOpenPaper: (paperId: string) => void;
}) {
  const [words, setWords] = useState<Word[]>(WORDS);
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  // S2 今日任务计划（按天快照，见 services/tasks.ts）
  const [plan, setPlan] = useState<DayPlan | null>(null);

  useEffect(() => {
    ensureSeeded();
    setWords(getAllWords());
    setProgress(load<Record<string, WordProgress>>(KEYS.progress, {}));
  }, []);

  useEffect(() => {
    let alive = true;
    ensureTodayPlan().then((p) => {
      if (alive) setPlan(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  const settings = useMemo(() => getSettings(), []);
  // 考试日期覆盖值（'' = 跟随官方考次常量）：日历选期后立即生效并落盘，
  // 不复用 settings 的 useMemo（挂载期快照），避免选择后 UI 不刷新
  const [calOpen, setCalOpen] = useState(false);
  const [examDateOv, setExamDateOv] = useState(settings.examDate);
  const exams = useMemo(() => loadExams(), []);
  const activity = useMemo(() => getActivity(), []);
  const week = useMemo(() => getRecentActivity(7), []);
  const weekDone = useMemo(() => weekPlanDone(7), []);

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

  const todayTotal = todayAct.learned + todayAct.reviewed;

  // ============ S1 考试倒计时 ============
  const session = EXAM_BY_LEVEL[settings.examLevel];
  const customDate = examDateOv.split('-').map(Number);
  const examDateValid = customDate.length === 3 && customDate.every((n) => Number.isFinite(n) && n > 0);
  const examDateStr = examDateValid ? examDateOv : session.date;
  const [examY, examM, examD] = examDateStr.split('-').map(Number);
  const daysLeft = daysUntilExam(examDateStr, d);

  // 日历选期：选中的就是官方日期时落盘空串（跟随常量），不把考次死值写进 settings
  const applyExamDate = (dateStr: string) => {
    const eff = dateStr === session.date ? '' : dateStr;
    setExamDateOv(eff);
    saveSettings({ ...getSettings(), examDate: eff });
    setCalOpen(false);
  };

  // ============ S2 今日任务卡 ============
  // 单词任务随学习进度自动打卡：新词 + 复习累计达到「到期数 + 配额」即完成
  const wordTargetSum = plan ? plan.word.due + plan.word.quota : 0;
  const wordDone = !!plan && wordTargetSum > 0 && todayTotal >= wordTargetSum;
  const listenDone = !!plan?.listening?.done;
  const readDone = !!plan?.reading?.done;
  const doneCount = (wordDone ? 1 : 0) + (listenDone ? 1 : 0) + (readDone ? 1 : 0);
  const allDone = !!plan && doneCount === 3;

  // 三项全完成 → 记入当日「收工」历史（本周计划完成度的数据源），幂等
  useEffect(() => {
    if (!plan || plan.allDone) return;
    if (wordDone && listenDone && readDone) setPlan(recordPlanComplete(plan));
  }, [plan, wordDone, listenDone, readDone]);

  const onToggleTask = (kind: 'listening' | 'reading') => {
    if (!plan) return;
    setPlan(togglePlanTask(plan, kind));
  };

  // 「一键继续上次」：优先回到最近访问的任务页；没有记录则落在本日第一个未完成任务
  const lastVisit = useMemo(() => getLastVisit(), []);
  const continueLabel = allDone
    ? '已收工 · 再学一点'
    : lastVisit
      ? `继续上次 · ${PAGE_LABELS[lastVisit.page]}`
      : '开始今日任务';
  const onContinue = () => {
    if (allDone) {
      onNavigate('vocabulary');
      return;
    }
    if (lastVisit) {
      onNavigate(lastVisit.page);
      return;
    }
    if (!wordDone) onNavigate('vocabulary');
    else if (plan?.listening && !plan.listening.done) onOpenPaper(plan.listening.paperId);
    else if (plan?.reading && !plan.reading.done) onOpenPaper(plan.reading.paperId);
    else onNavigate('vocabulary');
  };

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

  // ============ S3 分数走势（数据在 loadExams() 里已齐） ============
  const trend = useMemo(() => exams.slice(0, 8).reverse(), [exams]); // 时间正序
  const TW = 340;
  const TH = 150;
  const TP = { l: 36, r: 14, t: 16, b: 28 };
  const trendXs = trend.map((_, i) => TP.l + (i * (TW - TP.l - TP.r)) / Math.max(1, trend.length - 1));
  const trendY = (v: number) => TP.t + (1 - v / 710) * (TH - TP.t - TP.b);
  const trendPts = trend.map((e, i) => `${trendXs[i].toFixed(1)},${trendY(e.totalScore).toFixed(1)}`).join(' ');
  const showTargetLine = settings.targetScore !== 425;

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

      {/* S1 考试倒计时 + 本周计划完成度 */}
      <Card className="mb-16">
        <div className="cd-banner">
          <div className="cd-main">
            <button
              type="button"
              className="cd-ico cd-ico-btn"
              title="点击选择考试日期"
              aria-label="选择考试日期"
              onClick={() => setCalOpen(true)}
            >
              <Icon name="calendar" size={20} />
            </button>
            <div>
              <div className="cd-label">距 {session.name}</div>
              <div className="cd-row">
                <span className="cd-num">{daysLeft}</span>
                <span className="cd-unit">天</span>
                {daysLeft === 0 && (
                  <Tag tone="orange">
                    <Icon name="flame" size={13} />
                    今天开考
                  </Tag>
                )}
              </div>
              <div className="small muted cd-date">
                {examY} 年 {examM} 月 {examD} 日 · {session.time}
                {examDateValid ? ' · 自定义日期' : ''}
              </div>
            </div>
          </div>
          <div className="cd-week">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">本周计划完成度</span>
              <span className="small muted num">
                {weekDone.done} / {weekDone.total} 天
              </span>
            </div>
            <ProgressBar value={weekDone.done} max={weekDone.total} tone={weekDone.done >= weekDone.total ? 'green' : 'blue'} />
            <div className="small muted cd-week-hint">
              {weekDone.done >= weekDone.total ? '本周全部达成，稳！' : '完成当日三项任务即记 1 天'}
            </div>
          </div>
        </div>
        {calOpen && (
          <ExamCalendar
            value={examDateStr}
            officialDate={session.date}
            onResetExam={() => applyExamDate(session.date)}
            onClose={() => setCalOpen(false)}
          />
        )}
      </Card>

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
        {/* S2 今日任务卡：替代原「今日目标」（写死 30 词、只覆盖单词） */}
        <Card>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ marginTop: 0 }}>今日任务</h3>
            {plan?.allDone ? (
              <Tag tone="green">
                <Icon name="check" size={13} />
                今日收工
              </Tag>
            ) : (
              <span className="small muted num">{doneCount} / 3 项</span>
            )}
          </div>
          <ProgressBar value={doneCount} max={3} tone={allDone ? 'green' : 'blue'} />

          {!plan ? (
            <div className="small muted mt-16">正在生成今日任务…</div>
          ) : (
            <div className="task-list mt-8">
              {/* ① 单词：动态取 SRS 到期数 + 新词配额 */}
              <div className={`task-row${wordDone ? ' is-done' : ''}`}>
                <div className="task-ico">
                  <Icon name="book" size={17} />
                </div>
                <div className="task-info">
                  <div className="task-title">单词 · 新词 + 复习</div>
                  <div className="task-desc">
                    {plan.word.due > 0
                      ? `到期 ${plan.word.due} 词 + 新词配额 ${plan.word.quota} 词`
                      : `新词配额 ${plan.word.quota} 词 · 暂无到期复习`}
                    ，已完成 {todayTotal}
                  </div>
                </div>
                <div
                  className={`task-check${wordDone ? ' is-done' : ''}`}
                  title="单词任务随学习进度自动打卡"
                >
                  <Icon name="check" size={14} />
                </div>
                <button className="btn btn-sm" onClick={() => onNavigate('vocabulary')}>
                  去完成
                </button>
              </div>

              {/* ② 听力：从 79 个带音频 section 按天轮转 */}
              {plan.listening ? (
                <div className={`task-row${listenDone ? ' is-done' : ''}`}>
                  <div className="task-ico">
                    <Icon name="headphones" size={17} />
                  </div>
                  <div className="task-info">
                    <div className="task-title">听力 1 段</div>
                    <div className="task-desc">
                      {plan.listening.paperTitle} · {plan.listening.label}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`task-check${listenDone ? ' is-done' : ''}`}
                    aria-pressed={listenDone}
                    title={listenDone ? '点击取消打卡' : '完成今日听力后打卡'}
                    onClick={() => onToggleTask('listening')}
                  >
                    <Icon name="check" size={14} />
                  </button>
                  <button className="btn btn-sm" onClick={() => onOpenPaper(plan.listening!.paperId)}>
                    去完成
                  </button>
                </div>
              ) : (
                <div className="task-row is-none">
                  <div className="task-ico">
                    <Icon name="headphones" size={17} />
                  </div>
                  <div className="task-info">
                    <div className="task-title">听力 1 段</div>
                    <div className="task-desc">带音频的听力资源加载中或暂不可用</div>
                  </div>
                </div>
              )}

              {/* ③ 阅读：从真题池 Part III 按天轮转一篇 */}
              {plan.reading ? (
                <div className={`task-row${readDone ? ' is-done' : ''}`}>
                  <div className="task-ico">
                    <Icon name="pen" size={17} />
                  </div>
                  <div className="task-info">
                    <div className="task-title">阅读 1 篇</div>
                    <div className="task-desc">
                      {plan.reading.paperTitle} · {plan.reading.label}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`task-check${readDone ? ' is-done' : ''}`}
                    aria-pressed={readDone}
                    title={readDone ? '点击取消打卡' : '完成今日阅读后打卡'}
                    onClick={() => onToggleTask('reading')}
                  >
                    <Icon name="check" size={14} />
                  </button>
                  <button className="btn btn-sm" onClick={() => onOpenPaper(plan.reading!.paperId)}>
                    去完成
                  </button>
                </div>
              ) : (
                <div className="task-row is-none">
                  <div className="task-ico">
                    <Icon name="pen" size={17} />
                  </div>
                  <div className="task-info">
                    <div className="task-title">阅读 1 篇</div>
                    <div className="task-desc">真题池加载中或暂不可用</div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="row mt-16" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="small muted">
              {todayAct.correct + todayAct.wrong > 0
                ? `今日练习正确率：${Math.round((todayAct.correct / (todayAct.correct + todayAct.wrong)) * 100)}%（${todayAct.correct}/${todayAct.correct + todayAct.wrong}）`
                : '今日还未做练习，去真题练习或单词测验吧！'}
            </span>
            <button className="btn btn-primary btn-sm" onClick={onContinue}>
              <Icon name="play" size={14} />
              {continueLabel}
            </button>
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
        <div className={trend.length >= 2 ? 'grid-2' : ''}>
          <Card className={trend.length >= 2 ? '' : 'mb-16'}>
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

          {trend.length >= 2 && (
            <Card>
              <h3 style={{ marginTop: 0 }}>
                <span className="h-ico"><Icon name="trend" size={16} /></span>
                分数走势
              </h3>
              <div className="trend-box">
                <svg viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label="模考总分走势折线图">
                  {/* 满分与及格参考线 */}
                  <text className="trend-lb" x={4} y={trendY(710) + 3}>710</text>
                  <text className="trend-lb" x={4} y={trendY(425) + 3}>425</text>
                  <line className="trend-ref" x1={TP.l} y1={trendY(425)} x2={TW - TP.r} y2={trendY(425)} />
                  {showTargetLine && (
                    <>
                      <line className="trend-goal" x1={TP.l} y1={trendY(settings.targetScore)} x2={TW - TP.r} y2={trendY(settings.targetScore)} />
                      <text className="trend-lb trend-lb-goal" x={4} y={trendY(settings.targetScore) + 3}>{settings.targetScore}</text>
                    </>
                  )}
                  <polyline className="trend-line" points={trendPts} />
                  {trend.map((e, i) => (
                    <circle key={e.id} className="trend-dot" cx={trendXs[i]} cy={trendY(e.totalScore)} r={3} />
                  ))}
                  {/* 时间轴：首末两个日期 */}
                  {trend.length > 0 && (
                    <>
                      <text className="trend-lb" x={TP.l} y={TH - 8} textAnchor="middle">
                        {new Date(trend[0].date).getMonth() + 1}/{new Date(trend[0].date).getDate()}
                      </text>
                      <text className="trend-lb" x={trendXs[trend.length - 1]} y={TH - 8} textAnchor="middle">
                        {new Date(trend[trend.length - 1].date).getMonth() + 1}/{new Date(trend[trend.length - 1].date).getDate()}
                      </text>
                    </>
                  )}
                </svg>
              </div>
              <div className="small muted">
                最近 {trend.length} 次模考总分 · 虚线为 425 分及格线
                {showTargetLine ? ` · 实点线为目标 ${settings.targetScore} 分` : ''}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
