import { useEffect, useMemo, useState } from 'react';
import { load, save, KEYS } from '../services/storage';
import { getCetExamTimes, EXAM_SYNC_EVENT, type CetExamTime } from '../services/exam-sync';
import Icon from './Icon';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** 日期标记类型：学习 / 休息 */
export type DayMark = 'study' | 'rest';
type MarkMap = Record<string, DayMark>;

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 'YYYY-MM-DD'（本地时区，与 storage.dateKey 同口径） */
function keyOf(y: number, m0: number, d: number) {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

/**
 * 日历面板（Dashboard 倒计时卡 · 点击日历图标后从卡片内向下展开）。
 * - 考试日期（官方考次 / 当前生效日期）为纯展示：点击无响应、无选中高亮，仅圆点标记
 * - 「学习日期 / 休息日期」两个模式按钮：激活其一后，点击日期按当前类型标记；
 *   再点同色日期取消，点异色日期切换类型；日期考试日与过去日期不可标记
 * - 标记持久化到 localStorage（KEYS.dayMarks），跨月持续可见
 */
export default function ExamCalendar({
  value,
  officialDate,
  onResetExam,
  onClose,
}: {
  /** 当前生效的考试日期 'YYYY-MM-DD'（不可交互） */
  value: string;
  /** 官方考次日期 'YYYY-MM-DD'（不可交互，圆点标记） */
  officialDate: string;
  /** 恢复官方考次日期（仅当前为自定义日期时出现） */
  onResetExam: () => void;
  /** 收起面板 */
  onClose: () => void;
}) {
  // 只维护「正在查看的年月」，考试日直接由 value/officialDate 派生
  const [view, setView] = useState(() => {
    const [y, m] = value.split('-').map(Number);
    return { y, m0: m - 1 };
  });
  // 当前激活的标记类型：null = 未激活（点击日期无响应）
  const [mode, setMode] = useState<DayMark | null>(null);
  const [marks, setMarks] = useState<MarkMap>(() => load<MarkMap>(KEYS.dayMarks, {}));
  // 官方公告爬取的四六级考试时间（exam-sync 插件）：数据更新时经事件同步刷新
  const [cetTimes, setCetTimes] = useState<CetExamTime[]>(() => getCetExamTimes());

  useEffect(() => {
    const onSync = () => setCetTimes(getCetExamTimes());
    window.addEventListener(EXAM_SYNC_EVENT, onSync);
    return () => window.removeEventListener(EXAM_SYNC_EVENT, onSync);
  }, []);

  const now = new Date();
  const todayKey = keyOf(now.getFullYear(), now.getMonth(), now.getDate());
  const minYM = now.getFullYear() * 12 + now.getMonth();
  const viewYM = view.y * 12 + view.m0;

  // 周一开头的月份网格：先补空白，再放当月天数
  const cells = useMemo(() => {
    const firstDow = (new Date(view.y, view.m0, 1).getDay() + 6) % 7;
    const days = new Date(view.y, view.m0 + 1, 0).getDate();
    const list: (number | null)[] = Array(firstDow).fill(null);
    for (let i = 1; i <= days; i++) list.push(i);
    return list;
  }, [view.y, view.m0]);

  const shift = (delta: number) => {
    const next = viewYM + delta;
    setView({ y: Math.floor(next / 12), m0: ((next % 12) + 12) % 12 });
  };

  const isCustom = value !== officialDate;
  const markCount = Object.keys(marks).length;

  /** 按当前激活类型标记：同型取消、异型切换；考试日/过去日期不可标记 */
  const toggleMark = (key: string) => {
    if (!mode) return;
    const next = { ...marks };
    if (next[key] === mode) delete next[key];
    else next[key] = mode;
    setMarks(next);
    save(KEYS.dayMarks, next);
  };

  const clearMarks = () => {
    setMarks({});
    save(KEYS.dayMarks, {});
  };

  const pickMode = (m: DayMark) => setMode((cur) => (cur === m ? null : m));

  return (
    <div className="cal-panel">
      <div className="cal-head">
        <div className="cal-title">
          {view.y} 年 {view.m0 + 1} 月
        </div>
        <div className="cal-nav">
          <button
            type="button"
            className="cal-nav-btn"
            aria-label="上个月"
            disabled={viewYM <= minYM}
            onClick={() => shift(-1)}
          >
            <Icon name="arrowLeft" size={15} />
          </button>
          <button
            type="button"
            className="cal-nav-btn"
            aria-label="下个月"
            onClick={() => shift(1)}
          >
            <Icon name="arrowRight" size={15} />
          </button>
          <button
            type="button"
            className="cal-nav-btn"
            aria-label="收起日历"
            title="收起"
            onClick={onClose}
          >
            <Icon name="chevronDown" size={15} />
          </button>
        </div>
      </div>

      {/* 标记模式：激活其一后才可点击日期标记；互斥，再点取消激活 */}
      <div className="cal-modes">
        <button
          type="button"
          className={`cal-mode-btn${mode === 'study' ? ' is-on-study' : ''}`}
          aria-pressed={mode === 'study'}
          onClick={() => pickMode('study')}
        >
          学习日期
        </button>
        <button
          type="button"
          className={`cal-mode-btn${mode === 'rest' ? ' is-on-rest' : ''}`}
          aria-pressed={mode === 'rest'}
          onClick={() => pickMode('rest')}
        >
          休息日期
        </button>
        {markCount > 0 && (
          <button type="button" className="cal-mode-btn is-clear" onClick={clearMarks}>
            清空标记（{markCount}）
          </button>
        )}
      </div>

      <div className="cal-grid" role="grid" aria-label="学习计划日历">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-wd">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e${i}`} />;
          const key = keyOf(view.y, view.m0, day);
          const past = key < todayKey;
          const isExamDay = key === value || key === officialDate;
          // 官方公告爬取的四六级考试日（笔试/口试）：红色高亮 + 类型角标，同样不可标记
          const cetHits = cetTimes.filter((t) => t.date === key);
          const isCet = cetHits.length > 0;
          // 同一天可能既有笔试又有口试（如笔试当天 ± 口试），角标去重后拼接
          const cetTypes = [...new Set(cetHits.map((t) => t.type))];
          const cetLabel = cetTypes.join('·');
          // 考试日与过去日期一律不可交互；其余日期仅在激活模式后可标记
          const locked = past || isExamDay || isCet;
          const mark = marks[key];
          const cls = [
            'cal-day',
            isExamDay ? 'is-exam' : '',
            isExamDay && key === officialDate ? 'is-official' : '',
            isCet ? 'is-cet' : '',
            mark === 'study' ? 'is-study' : '',
            mark === 'rest' ? 'is-rest' : '',
            key === todayKey ? 'is-today' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={key}
              type="button"
              className={cls}
              data-cet={isCet ? cetLabel : undefined}
              disabled={locked || !mode}
              onClick={() => toggleMark(key)}
              title={
                isCet
                  ? `${[...new Set(cetHits.map((t) => `${t.name}${t.type}`))].join('、')} · 考试日`
                  : isExamDay
                    ? '考试日期，不可标记'
                    : past
                      ? '已过去的日期不可标记'
                      : !mode
                        ? '先在上方选择「学习日期」或「休息日期」'
                        : mark
                          ? '再次点击取消标记'
                          : undefined
              }
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="cal-foot">
        <div className="cal-hint">
          {mode === 'study'
            ? '正在标记学习日期：点击日期标记，再点取消'
            : mode === 'rest'
              ? '正在标记休息日期：点击日期标记，再点取消'
              : '考试日不可选 · 选择上方类型后点击日期进行标记'}
          {cetTimes.length > 0 ? ' · 红底为四六级考试日（角标：笔 = 笔试，口 = 口试）' : ''}
        </div>
        {isCustom && (
          <button type="button" className="btn btn-sm" onClick={onResetExam}>
            恢复官方日期
          </button>
        )}
      </div>
    </div>
  );
}
