import { useEffect, useMemo, useRef, useState } from 'react';
import type { Book, Word, WordProgress } from '../types';
import { WORDS, WORD_MAP, BOOK_META, bookMeta } from '../data/words';
import { load, save, KEYS, addActivity, ensureSeeded, getAllWords, saveUserWords } from '../services/storage';
import { defaultProgress, reviewWord, isDue } from '../services/srs';
import { speak, stopSpeak } from '../services/tts';
import { Card, Tabs, Tag, ProgressBar, Empty } from '../components/ui';
import { EllipsisTip } from '../components/Tooltip';
import Icon from '../components/Icon';
import { addMistake } from '../services/mistakes';

const TAB = [
  { key: 'learn', label: '学习新词' },
  { key: 'review', label: '复习' },
  { key: 'quiz', label: '单词测验' },
  { key: 'bank', label: '词库管理' },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Vocabulary() {
  const [words, setWords] = useState<Word[]>([]);
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [tab, setTab] = useState('learn');
  const [book, setBook] = useState<Book | 'all'>('all');
  const [statsOpen, setStatsOpen] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureSeeded();
    setWords(getAllWords());
    setProgress(load<Record<string, WordProgress>>(KEYS.progress, {}));
  }, []);

  // 各词库单词数量
  const bookCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const w of words) c[w.book] = (c[w.book] ?? 0) + 1;
    return c;
  }, [words]);

  // 按分类确定学习范围
  const scoped = useMemo(
    () => (book === 'all' ? words : words.filter((w) => w.book === book)),
    [words, book]
  );

  // 点击统计面板外部时收起
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (statsRef.current && !statsRef.current.contains(e.target as Node)) {
        setStatsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const refresh = () => setProgress(load<Record<string, WordProgress>>(KEYS.progress, {}));

  const dueCount = useMemo(
    () =>
      words.filter(
        (w) => progress[w.id] && isDue(progress[w.id]) && progress[w.id].status !== 'mastered'
      ).length,
    [words, progress]
  );

  const learnedCount = useMemo(
    () => Object.values(progress).filter((p) => p.status !== 'new' || p.reviewCount > 0).length,
    [progress]
  );
  const masteredCount = useMemo(
    () => Object.values(progress).filter((p) => p.status === 'mastered').length,
    [progress]
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>单词记忆</h2>
        </div>
        <div className="page-header-extra">
          <div className="stat-collapse" ref={statsRef}>
            <button
              className={`stat-toggle${statsOpen ? ' open' : ''}`}
              onClick={() => setStatsOpen((v) => !v)}
            >
              <span className="stat-toggle-icon"><Icon name="chart" size={15} /></span>
              <span className="stat-toggle-summary">词库 {words.length} · 待复习 {dueCount}</span>
              <span className={`stat-toggle-caret${statsOpen ? ' open' : ''}`}>
                <Icon name="chevronDown" size={14} />
              </span>
            </button>
            {statsOpen && (
              <div className="stat-pop">
                <div className="stat-pop-title">学习数据</div>
                <div className="stat-grid-mini">
                  <div className="stat-mini">
                    <span className="stat-mini-icon"><Icon name="book" size={16} /></span>
                    <div>
                      <div className="num">{words.length}</div>
                      <div className="lbl">词库总量</div>
                    </div>
                  </div>
                  <div className="stat-mini">
                    <span className="stat-mini-icon"><Icon name="check" size={16} /></span>
                    <div>
                      <div className="num">{learnedCount}</div>
                      <div className="lbl">已学习</div>
                    </div>
                  </div>
                  <div className="stat-mini">
                    <span className="stat-mini-icon"><Icon name="trophy" size={16} /></span>
                    <div>
                      <div className="num">{masteredCount}</div>
                      <div className="lbl">已掌握</div>
                    </div>
                  </div>
                  <div className="stat-mini">
                    <span className="stat-mini-icon"><Icon name="timer" size={16} /></span>
                    <div>
                      <div className="num">{dueCount}</div>
                      <div className="lbl">今日待复习</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="book-scope">
        <span className="scope-label">学习范围：</span>
        <button className={`book-chip ${book === 'all' ? 'active' : ''}`} onClick={() => setBook('all')}>
          全部 <span className="chip-count">{words.length.toLocaleString()}</span>
        </button>
        {BOOK_META.map((b) => (
          <button
            key={b.key}
            className={`book-chip ${book === b.key ? 'active' : ''}`}
            onClick={() => setBook(b.key)}
          >
            {b.label} <span className="chip-count">{(bookCounts[b.key] ?? 0).toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className="vocab-tabs">
        <Tabs
          tabs={TAB.map((t) => (t.key === 'review' ? { ...t, badge: dueCount } : t))}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'learn' && <LearnMode words={scoped} progress={progress} refresh={refresh} />}
      {tab === 'review' && <ReviewMode words={scoped} progress={progress} refresh={refresh} />}
      {tab === 'quiz' && <QuizMode words={scoped} progress={progress} refresh={refresh} />}
      {tab === 'bank' && <BankMode words={scoped} progress={progress} setWords={setWords} refresh={refresh} />}
    </div>
  );
}

/* ============ 通用卡片组件 ============ */
function FlashCard({ word, flipped, onFlip }: { word: Word; flipped: boolean; onFlip: () => void }) {
  return (
    <div className="flashcard" onClick={onFlip}>
      <div className="fc-word">{word.word}</div>
      {!flipped ? (
        <>
          <button
            className="btn btn-sm mt-16"
            onClick={(e) => {
              e.stopPropagation();
              speak(word.word);
            }}
          >
            <Icon name="speaker" size={15} />
            播放发音
          </button>
          <div className="fc-tip">点击卡片查看释义</div>
        </>
      ) : (
        <>
          <div className="fc-pos">
            {word.pos} · <Tag tone={bookMeta(word.book).tone}>{bookMeta(word.book).label}</Tag>
          </div>
          <div className="fc-meaning">{word.meaning}</div>
          {word.example && (
            <div>
              <div className="fc-example">“{word.example}”</div>
              {word.exampleCn && <div className="fc-example-cn">{word.exampleCn}</div>}
            </div>
          )}
          <div className="fc-tip">认识就点「认识」，否则点「不认识」</div>
        </>
      )}
    </div>
  );
}

function ResultSummary({ title, text, onRestart }: { title: string; text: string; onRestart: () => void }) {
  return (
    <Card className="text-center" >
      <div className="done-badge"><Icon name="check" size={28} /></div>
      <h3 style={{ margin: '8px 0' }}>{title}</h3>
      <p className="muted">{text}</p>
      <button className="btn btn-primary mt-16" onClick={onRestart}>再来一轮</button>
    </Card>
  );
}

/* ============ 学习新词 ============ */
function LearnMode({
  words,
  progress,
  refresh,
}: {
  words: Word[];
  progress: Record<string, WordProgress>;
  refresh: () => void;
}) {
  const [queue, setQueue] = useState<Word[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    setQueue(words.filter((w) => !progress[w.id]).slice(0, 20));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

  if (done >= queue.length && queue.length > 0) {
    return (
      <ResultSummary
        title="本轮学习完成！"
        text={`共学习 ${queue.length} 个新单词，已计入今日学习记录。`}
        onRestart={() => {
          setQueue(shuffle(words.filter((w) => !progress[w.id])).slice(0, 20));
          setIdx(0);
          setDone(0);
          setFlipped(false);
        }}
      />
    );
  }

  if (queue.length === 0) {
    return (
      <Card>
        <Empty icon="sprout" text="太棒了！内置词库已全部学习完毕，可到「词库管理」导入更多单词。" />
      </Card>
    );
  }

  const word = queue[idx];

  const handle = (correct: boolean) => {
    if (!flipped) return;
    const p = progress[word.id] ?? defaultProgress();
    const np = reviewWord(p, correct);
    const next = { ...progress, [word.id]: np };
    save(KEYS.progress, next);
    addActivity({ learned: 1 });
    refresh();
    if (idx + 1 >= queue.length) {
      setDone(queue.length);
    } else {
      setIdx(idx + 1);
      setFlipped(false);
    }
    stopSpeak();
  };

  const remaining = queue.slice(idx, idx + 8);

  return (
    <div className="learn-layout">
      <div className="learn-main">
        <Card>
          <FlashCard word={word} flipped={flipped} onFlip={() => setFlipped(!flipped)} />
          {flipped && (
            <div className="review-actions">
              <button className="btn btn-red big-btn" onClick={() => handle(false)}>
                <Icon name="x" size={16} />
                不认识
              </button>
              <button className="btn btn-green big-btn" onClick={() => handle(true)}>
                <Icon name="check" size={16} />
                认识
              </button>
            </div>
          )}
        </Card>
      </div>

      <aside className="learn-side">
        <Card>
          <h3 style={{ marginTop: 0 }}>本轮进度</h3>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">第 {Math.min(idx + 1, queue.length)} 个</span>
            <span className="small muted">共 {queue.length} 个</span>
          </div>
          <ProgressBar value={idx} max={queue.length} />
        </Card>
        <Card>
          <h3 style={{ marginTop: 0 }}>接下来</h3>
          <div className="queue-list">
            {remaining.map((w, i) => (
              <div key={w.id} className={`queue-item ${i === 0 ? 'current' : ''}`}>
                <span className="q-idx">{String(idx + i + 1).padStart(2, '0')}</span>
                <span className="q-word">{w.word}</span>
              </div>
            ))}
          </div>
        </Card>
      </aside>
    </div>
  );
}

/* ============ 复习 ============ */
function ReviewMode({
  words,
  progress,
  refresh,
}: {
  words: Word[];
  progress: Record<string, WordProgress>;
  refresh: () => void;
}) {
  const [queue, setQueue] = useState<Word[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ total: 0, correct: 0, wrong: 0 });

  useEffect(() => {
    const due = words.filter(
      (w) => progress[w.id] && isDue(progress[w.id]) && progress[w.id].status !== 'mastered'
    );
    setQueue(due);
    setStats({ total: due.length, correct: 0, wrong: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

  if (queue.length === 0) {
    return (
      <Card>
        <Empty icon="coffee" text="目前没有到期的复习单词，休息一下或先学习新词吧。" />
      </Card>
    );
  }

  if (idx >= queue.length) {
    return (
      <ResultSummary
        title="复习完成！"
        text={`共复习 ${stats.total} 词，答对 ${stats.correct} 个，答错 ${stats.wrong} 个。`}
        onRestart={() => setIdx(0)}
      />
    );
  }

  const word = queue[idx];

  const handle = (correct: boolean) => {
    if (!flipped) return;
    const p = progress[word.id] ?? defaultProgress();
    const np = reviewWord(p, correct);
    save(KEYS.progress, { ...progress, [word.id]: np });
    addActivity({ reviewed: 1, ...(correct ? { correct: 1 } : { wrong: 1 }) });
    refresh();
    setStats((s) => ({
      ...s,
      correct: s.correct + (correct ? 1 : 0),
      wrong: s.wrong + (correct ? 0 : 1),
    }));
    setIdx(idx + 1);
    setFlipped(false);
    stopSpeak();
  };

  return (
    <div>
      <Card className="mb-16">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted small">
            复习 {idx + 1} / {queue.length}
          </span>
          <ProgressBar value={idx} max={queue.length} tone="orange" />
        </div>
        <div className="mt-16">
          <FlashCard word={word} flipped={flipped} onFlip={() => setFlipped(!flipped)} />
        </div>
        {flipped && (
          <div className="review-actions">
            <button className="btn btn-red big-btn" onClick={() => handle(false)}>
              <Icon name="x" size={16} />
              忘记了
            </button>
            <button className="btn btn-green big-btn" onClick={() => handle(true)}>
              <Icon name="check" size={16} />
              记得
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============ 单词测验 ============ */
type QuizType = 'en2cn' | 'cn2en' | 'listen' | 'spell';

const QUIZ_TYPE_LABEL: Record<QuizType, string> = {
  en2cn: '英译中',
  cn2en: '中译英',
  listen: '听音选义',
  spell: '拼写',
};

/** 测验按题型依次进行：英译中 → 中译英 → 听音选义 → 拼写 */
const ROUND_ORDER: QuizType[] = ['en2cn', 'cn2en', 'listen', 'spell'];

/** 遗忘指数 5 个等级 */
const FORGET_LABEL: Record<number, string> = {
  1: '很牢固',
  2: '较牢固',
  3: '一般',
  4: '易遗忘',
  5: '严重遗忘',
};
const FORGET_TONE: Record<number, 'green' | 'blue' | 'orange' | 'red'> = {
  1: 'green',
  2: 'blue',
  3: 'orange',
  4: 'orange',
  5: 'red',
};

interface QuizQ {
  word: Word;
  type: QuizType;
  options: string[];
  answer: string;
}

/** 按题型分组：同一题型的所有单词连续出现，共 4 轮 */
function buildQuiz(words: Word[]): QuizQ[] {
  const qs: QuizQ[] = [];
  for (const type of ROUND_ORDER) {
    // 每轮洗牌一次作为干扰项池，避免在内层循环里反复过滤 + 洗牌整表（O(n²)）
    const pool = shuffle(words);
    for (const word of words) {
      // 从池中取 3 个不同词形、不同释义的干扰项
      const distract: Word[] = [];
      for (const w of pool) {
        if (distract.length === 3) break;
        if (w.id === word.id || w.meaning === word.meaning) continue;
        distract.push(w);
      }
      // 只构造当前题型需要的选项
      if (type === 'cn2en') {
        qs.push({ word, type, options: shuffle([word.word, ...distract.map((w) => w.word)]), answer: word.word });
      } else if (type === 'spell') {
        qs.push({ word, type, options: [], answer: word.word });
      } else {
        qs.push({ word, type, options: shuffle([word.meaning, ...distract.map((w) => w.meaning)]), answer: word.meaning });
      }
    }
  }
  return qs;
}

function QuizMode({ words, progress, refresh }: { words: Word[]; progress: Record<string, WordProgress>; refresh: () => void }) {
  const [phase, setPhase] = useState<'select' | 'quiz' | 'result'>('select');
  const [forget, setForget] = useState<Record<string, number>>({});
  const [selSet, setSelSet] = useState<Set<string>>(new Set());
  const [quiz, setQuiz] = useState<QuizQ[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [hint, setHint] = useState(false);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<{ word: Word; level: number }[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [addedAll, setAddedAll] = useState(false);
  const masteryRef = useRef<Record<string, number>>({});
  // 保存 advance 中的 setTimeout id，组件卸载时清理
  const advanceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setForget(load<Record<string, number>>(KEYS.forget, {}));
  }, []);

  // 卸载时清理未完成的定时器，避免对已卸载组件 setState
  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  // 听音选义：进入题目自动播放发音
  useEffect(() => {
    if (phase === 'quiz' && quiz[qIdx]?.type === 'listen') {
      speak(quiz[qIdx].word.word);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qIdx]);

  const goSelect = () => {
    setForget(load<Record<string, number>>(KEYS.forget, {}));
    setPhase('select');
  };

  const startQuiz = () => {
    const chosen = words.filter((w) => selSet.has(w.id));
    setQuiz(buildQuiz(chosen));
    setQIdx(0);
    setSelected(null);
    setTyped('');
    setHint(false);
    setScore(0);
    setResult([]);
    setChecked({});
    setAddedAll(false);
    masteryRef.current = {};
    setPhase('quiz');
  };

  const togglePick = (id: string) => {
    setSelSet((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // 选择阶段：仅学习过或已在词库中的单词（用 WORD_MAP O(1) 判断是否内置词，避免 O(n²)）
  const pickList = useMemo(
    () => words.filter((w) => w.meaning.trim() && (progress[w.id] || !WORD_MAP[w.id])),
    [words, progress]
  );
  const pickSorted = useMemo(
    () => [...pickList].sort((a, b) => (forget[b.id] ?? 1) - (forget[a.id] ?? 1)),
    [pickList, forget]
  );

  // ===== 第一步：选择单词（仅学习过或已在词库中的单词；按遗忘指数从高到低排序） =====
  if (phase === 'select') {
    const list = pickList;
    const sorted = pickSorted;
    const selectedCount = selSet.size;
    return (
      <div>
        <Card className="mb-16">
          <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
            <div>
              <b>选择本次测验的单词</b>
              <div className="small muted" style={{ marginTop: 4 }}>
                仅显示已学习或已在词库中的单词；遗忘指数共 5 级（很牢固 → 严重遗忘），测验答错会提升遗忘指数，已按遗忘指数从高到低排序。
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm" onClick={() => setSelSet(new Set(sorted.map((w) => w.id)))}>全选</button>
              <button className="btn btn-sm" onClick={() => setSelSet(new Set())}>清空</button>
            </div>
          </div>
        </Card>

        {list.length === 0 ? (
          <Card>
            <Empty icon="notes" text="暂无单词可测验。请先在「学习新词」中学习。" />
          </Card>
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ maxHeight: 430, overflowY: 'auto' }}>
              {sorted.map((w) => {
                const level = forget[w.id] ?? 1;
                return (
                  <div key={w.id} className="quiz-pick-row" onClick={() => togglePick(w.id)}>
                    <input type="checkbox" className="quiz-check" checked={selSet.has(w.id)} readOnly />
                    <div className="quiz-result-word">
                      <b>{w.word}</b>
                      <span className="muted small">{w.pos} {w.meaning}</span>
                    </div>
                    <div className="quiz-mastery">
                      <div className="forget-bar" title={`遗忘指数 ${level}/5`}>
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span key={i} className={`forget-seg${level > i ? ' filled' : ''}`} />
                        ))}
                      </div>
                      <Tag tone={FORGET_TONE[level]}>{FORGET_LABEL[level]}</Tag>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <div className="row mt-16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" disabled={selectedCount === 0} onClick={startQuiz}>
            {selectedCount === 0 ? '请先勾选单词' : `开始测验（${selectedCount} 词 × 4 题型）`}
          </button>
        </div>
      </div>
    );
  }

  const q = quiz[qIdx];

  /** 答题结算：答对掌握程度 +1、遗忘指数 -1；答错遗忘指数 +1（1~5 级之间浮动） */
  const advance = (ok: boolean) => {
    if (ok) masteryRef.current[q.word.id] = (masteryRef.current[q.word.id] ?? 0) + 1;
    const next = { ...forget };
    const cur = next[q.word.id] ?? 1;
    const nv = ok ? Math.max(1, cur - 1) : Math.min(5, cur + 1);
    if (nv !== cur) {
      next[q.word.id] = nv;
      setForget(next);
      save(KEYS.forget, next);
    }
    setScore((s) => s + (ok ? 1 : 0));
    addActivity({ practiced: 1, ...(ok ? { correct: 1 } : { wrong: 1 }) });
    refresh();
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (qIdx + 1 >= quiz.length) {
        const unique = new Map<string, Word>();
        for (const qq of quiz) unique.set(qq.word.id, qq.word);
        setResult([...unique.values()].map((w) => ({ word: w, level: masteryRef.current[w.id] ?? 0 })));
        setPhase('result');
      } else {
        setQIdx(qIdx + 1);
        setSelected(null);
        setTyped('');
        setHint(false);
      }
    }, 900);
  };

  const choose = (opt: string) => {
    if (selected !== null) return;
    setSelected(opt);
    advance(opt === q.answer);
  };

  const submitSpell = () => {
    if (selected !== null || !typed.trim()) return;
    setSelected(typed.trim());
    advance(typed.trim().toLowerCase() === q.answer.toLowerCase());
  };

  const renderOptions = () =>
    q.options.map((opt) => {
      let cls = 'quiz-option';
      if (selected !== null) {
        if (opt === q.answer) cls += ' correct';
        else if (opt === selected) cls += ' wrong';
      }
      return (
        <div key={opt} className={cls} onClick={() => choose(opt)}>
          <span className="opt-key">{String.fromCharCode(65 + q.options.indexOf(opt))}</span>
          <span>{opt}</span>
        </div>
      );
    });

  const checkedCount = Object.values(checked).filter(Boolean).length;

  const addCheckedToMistakes = () => {
    let n = 0;
    for (const { word } of result) {
      if (!checked[word.id]) continue;
      const ok = addMistake({
        sourceType: 'quiz',
        sourceId: 'vocab-quiz',
        sourceTitle: '单词测验',
        kind: 'vocabulary',
        questionId: `word:${word.id}`,
        question: `单词测验 · ${word.word}`,
        correctAnswer: word.meaning,
        options: [word.word, word.meaning],
      });
      if (ok) n++;
    }
    alert(n > 0 ? `已将 ${n} 个单词加入错题本，可在「错题本」中复习。` : '所选单词均已在错题本中。');
    setAddedAll(true);
  };

  // ===== 第三步：结果页 =====
  if (phase === 'result') {
    const correctPct = quiz.length ? Math.round((score / quiz.length) * 100) : 0;
    return (
      <div>
        <Card className="mb-16">
          <div className="text-center">
            <div className="done-badge"><Icon name="check" size={28} /></div>
            <h3 style={{ margin: '8px 0' }}>测验完成</h3>
            <p className="muted">
              得分 {score} / {quiz.length}（正确率 {correctPct}%），共测验 {result.length} 个单词
            </p>
          </div>
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <button className="btn btn-primary mt-16" onClick={goSelect}>再来一轮</button>
          </div>
        </Card>

        <Card>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <b>单词掌握程度</b>
            <span className="small muted">每通过一种题型 +1 级，共 4 级 · 遗忘指数随答题升降</span>
          </div>
          {result.map(({ word, level }) => {
            const fLevel = forget[word.id] ?? 1;
            return (
              <div key={word.id} className="quiz-result-row">
                <input
                  type="checkbox"
                  className="quiz-check"
                  checked={!!checked[word.id]}
                  onChange={() => setChecked((c) => ({ ...c, [word.id]: !c[word.id] }))}
                  title="勾选加入错题本"
                />
                <div className="quiz-result-word">
                  <b>{word.word}</b>
                  <span className="muted small">{word.pos} {word.meaning}</span>
                </div>
                <div className="quiz-mastery">
                  <div className="mastery-bar">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} className={`mastery-seg${level > i ? ' filled' : ''}`} />
                    ))}
                  </div>
                  <span className="small muted">{level} / 4</span>
                  <Tag tone={FORGET_TONE[fLevel]}>{FORGET_LABEL[fLevel]}</Tag>
                </div>
              </div>
            );
          })}
        </Card>

        <div className="mistake-fab">
          <button
            className="btn btn-primary"
            disabled={checkedCount === 0 || addedAll}
            onClick={addCheckedToMistakes}
          >
            {addedAll ? (
              <>
                <Icon name="check" size={15} />
                已加入错题本
              </>
            ) : (
              <>
                <Icon name="pin" size={15} />
                一键加入错题本（{checkedCount}）
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ===== 第二步：按题型依次作答 =====
  const isRoundStart = qIdx === 0 || quiz[qIdx - 1].type !== q.type;
  const roundCount = quiz.filter((x) => x.type === q.type).length;

  return (
    <div>
      <Card className="mb-16">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted small">第 {qIdx + 1} / {quiz.length} 题 · 得分 {score}</span>
          <Tag tone="blue">{QUIZ_TYPE_LABEL[q.type]}</Tag>
        </div>
        <ProgressBar value={qIdx} max={quiz.length} tone="green" />
      </Card>

      {isRoundStart && (
        <div className={`quiz-round round-${q.type}`}>
          <b className="quiz-round-label"><Icon name="pin" size={14} />{QUIZ_TYPE_LABEL[q.type]}</b>
          <span className="small muted">本轮共 {roundCount} 题，完成本题型后进入下一题型</span>
        </div>
      )}

      <Card>
        <div className="vocab-quiz">
          {(q.type === 'en2cn' || q.type === 'cn2en') && (
            <>
              <div className="quiz-q">
                {q.type === 'en2cn'
                  ? <>选出「{q.word.word}」的正确释义</>
                  : <>「{q.word.meaning}」对应的英文单词是？</>}
              </div>
              {renderOptions()}
            </>
          )}

          {q.type === 'listen' && (
            <>
              <div className="quiz-q inline-ico">
                <Icon name="speaker" size={16} />
                请听发音，选择正确的释义
              </div>
              <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => speak(q.word.word)}>
                <Icon name="speaker" size={15} />
                重听
              </button>
              {renderOptions()}
            </>
          )}

          {q.type === 'spell' && (
            <>
              <div className="quiz-q inline-ico">
                <Icon name="pen" size={16} />
                根据释义拼写单词
              </div>
              <div className="quiz-meaning">{q.word.meaning}</div>
              <div className="row" style={{ gap: 12, marginTop: 6 }}>
                <span className="spell-meta inline-ico">
                  <Icon name="spell" size={14} />
                  共 {q.answer.length} 个字母
                </span>
                {hint && (
                  <span className="spell-meta hint">首字母：<b>{q.answer[0]}</b></span>
                )}
              </div>
              <div className="row" style={{ gap: 8, margin: '14px 0' }}>
                <input
                  className="input flex-1 spell-input"
                  placeholder="输入英文单词…"
                  value={typed}
                  disabled={selected !== null}
                  autoFocus
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitSpell();
                  }}
                />
                <button className="btn" onClick={() => speak(q.word.word)} title="播放发音" aria-label="播放发音">
                  <Icon name="speaker" size={15} />
                </button>
                <button className="btn" disabled={selected !== null || hint} onClick={() => setHint(true)} title="提示首字母" aria-label="提示首字母">
                  <Icon name="bulb" size={15} />
                </button>
                <button className="btn btn-primary" disabled={selected !== null || !typed.trim()} onClick={submitSpell}>
                  提交
                </button>
              </div>
            </>
          )}

          {selected !== null &&
            (q.type === 'spell' ? (
              <div className={`spell-feedback ${selected.toLowerCase() === q.answer.toLowerCase() ? 'ok' : 'bad'}`}>
                {selected.toLowerCase() === q.answer.toLowerCase() ? (
                  <span className="inline-ico">
                    <Icon name="check" size={15} />
                    拼写正确！
                  </span>
                ) : (
                  <>
                    <span className="inline-ico">
                      <Icon name="x" size={15} />
                      正确答案：
                    </span>
                    <b>{q.answer.split('').join(' ')}</b>
                    <span className="small muted">（{q.word.pos} {q.word.meaning}）</span>
                  </>
                )}
              </div>
            ) : (
              <div className="analysis-box">
                <div className="ab-title"><Icon name="bulb" size={14} />答案</div>
                <div className="inline-ico">
                  {selected === q.answer ? (
                    <>
                      <Icon name="check" size={15} />
                      回答正确！
                    </>
                  ) : (
                    <>
                      <Icon name="x" size={15} />
                      正确答案是「{q.answer}」
                    </>
                  )}
                  {' — '}{q.word.pos} {q.word.meaning}
                  {q.word.example ? ` · 例句：${q.word.example}` : ''}
                </div>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ 词库管理 ============ */
const BANK_INITIAL_LIMIT = 100;
const BANK_PAGE_SIZE = 200;

function BankMode({
  words,
  progress,
  setWords,
  refresh,
}: {
  words: Word[];
  progress: Record<string, WordProgress>;
  setWords: (w: Word[]) => void;
  refresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [letter, setLetter] = useState(''); // '' = 全部, 'a'-'z', '#' = 非字母开头
  const [limit, setLimit] = useState(BANK_INITIAL_LIMIT);

  // 输入防抖：避免每次按键都对 3 万+ 词库做全文过滤
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // 预计算词库中存在的首字母集合（用于禁用空字母按钮），仅依赖 words
  const availableLetters = useMemo(() => {
    const set = new Set<string>();
    for (const w of words) {
      const ch = w.word[0]?.toLowerCase();
      if (!ch) continue;
      if (ch >= 'a' && ch <= 'z') set.add(ch);
      else set.add('#');
    }
    return set;
  }, [words]);

  // 搜索词 / 筛选条件 / 首字母变化时重置列表分页
  useEffect(() => {
    setLimit(BANK_INITIAL_LIMIT);
  }, [debouncedQuery, filter, words, letter]);

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return words.filter((w) => {
      if (filter === 'mastered' && progress[w.id]?.status !== 'mastered') return false;
      if (filter === 'unlearned' && progress[w.id]) return false;
      if (q && !w.word.toLowerCase().includes(q) && !w.meaning.toLowerCase().includes(q)) return false;
      if (letter) {
        const ch = w.word[0]?.toLowerCase();
        if (letter === '#') {
          if (ch && ch >= 'a' && ch <= 'z') return false;
        } else if (ch !== letter) {
          return false;
        }
      }
      return true;
    });
  }, [words, filter, debouncedQuery, progress, letter]);

  const doExport = () => {
    const blob = new Blob([JSON.stringify(words, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cet-words.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetBank = () => {
    if (!confirm('确定重置词库为内置词库吗？已学习的进度将被清空。')) return;
    saveUserWords([]);
    save(KEYS.progress, {});
    setWords(WORDS);
    refresh();
  };

  return (
    <div>
      <div className="row mb-16">
        <input
          className="input flex-1"
          placeholder="搜索单词或释义…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select" style={{ width: 140 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部</option>
          <option value="unlearned">未学习</option>
          <option value="mastered">已掌握</option>
        </select>
        <button className="btn" onClick={doExport}>
          <Icon name="download" size={15} />
          导出
        </button>
      </div>

      <div className="letter-bar">
        <button
          className={`letter-chip${letter === '' ? ' active' : ''}`}
          onClick={() => setLetter('')}
        >
          全部
        </button>
        {'abcdefghijklmnopqrstuvwxyz'.split('').map((L) => (
          <button
            key={L}
            className={`letter-chip${letter === L ? ' active' : ''}`}
            disabled={!availableLetters.has(L)}
            onClick={() => setLetter(L)}
          >
            {L.toUpperCase()}
          </button>
        ))}
        {availableLetters.has('#') && (
          <button
            className={`letter-chip${letter === '#' ? ' active' : ''}`}
            onClick={() => setLetter('#')}
          >
            #
          </button>
        )}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
          {filtered.slice(0, limit).map((w) => {
            const p = progress[w.id];
            const bm = bookMeta(w.book);
            return (
              <div
                key={w.id}
                className="row"
                style={{
                  padding: '10px 20px',
                  borderBottom: '1px solid var(--border)',
                  justifyContent: 'space-between',
                }}
              >
                <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
                  <b
                    style={{
                      minWidth: 130,
                      maxWidth: 240,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={w.word}
                  >
                    {w.word}
                  </b>
                  <span className="muted small bank-pos">{w.pos}</span>
                  <EllipsisTip text={w.meaning} className="bank-meaning" />
                </div>
                <div className="row">
                  <Tag tone={bm.tone}>{bm.label}</Tag>
                  {!p && <Tag tone="gray">未学</Tag>}
                  {p && p.status === 'learning' && <Tag tone="orange">学习中</Tag>}
                  {p && p.status === 'mastered' && <Tag tone="green">已掌握</Tag>}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <Empty text="没有符合条件的单词" />}
        </div>
        {filtered.length > limit && (
          <div className="row" style={{ justifyContent: 'center', padding: 12 }}>
            <button className="btn btn-sm" onClick={() => setLimit((l) => l + BANK_PAGE_SIZE)}>
              加载更多（还有 {filtered.length - limit} 个）
            </button>
          </div>
        )}
      </Card>

      <div className="mt-16 text-right">
        <button className="btn btn-red btn-sm" onClick={resetBank}>重置为内置词库</button>
      </div>
    </div>
  );
}

