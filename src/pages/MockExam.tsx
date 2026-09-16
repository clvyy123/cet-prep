import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExamAnswers, ExamMode, ExamResult, ExamType, MockExam as MockExamType, WritingItem, TranslationItem, MistakeKind } from '../types';
import { buildMockExamFromBank, gradeExam, loadExams, sectionMax } from '../services/exam';
import { addActivity } from '../services/storage';
import { speak, stopSpeak } from '../services/tts';
import { Card, Tag, PageHeader, Modal, ProgressBar, AddMistakeBtn, AnalysisBtn, YearFilter } from '../components/ui';
import Icon from '../components/Icon';
import { BUILTIN_BANKS, type BuiltinBank } from '../data/builtin-banks';
import { yearsOf, yearOf } from '../services/import';

type Phase = 'setup' | 'exam' | 'result' | 'review';

export default function MockExam() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [exam, setExam] = useState<MockExamType | null>(null);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [review, setReview] = useState<ExamResult | null>(null);

  const start = (bank: BuiltinBank, m: ExamMode) => {
    setExam(buildMockExamFromBank(bank, m));
    setPhase('exam');
  };

  if (phase === 'review' && review) {
    return <ReviewView record={review} onBack={() => setPhase('setup')} />;
  }

  if (phase === 'exam' && exam) {
    return (
      <ExamView
        exam={exam}
        onFinish={(r) => {
          setResult(r);
          setPhase('result');
        }}
        onAbort={() => setPhase('setup')}
      />
    );
  }

  if (phase === 'result' && result) {
    return (
      <ResultView
        result={result}
        onBack={() => setPhase('setup')}
        onReview={(r) => {
          setReview(r);
          setPhase('review');
        }}
      />
    );
  }

  return (
    <SetupView
      onStart={(bank, m) => start(bank, m)}
      onReview={(r) => {
        setReview(r);
        setPhase('review');
      }}
    />
  );
}

/* ============ 配置页（真题套卷选择） ============ */
function SetupView({
  onStart,
  onReview,
}: {
  onStart: (bank: BuiltinBank, m: ExamMode) => void;
  onReview: (r: ExamResult) => void;
}) {
  // localStorage 里存着整卷快照，解析开销大：只在挂载时读一次
  const history = useMemo(() => loadExams(), []);
  const banks = BUILTIN_BANKS;
  const [year, setYear] = useState<number | 'all'>('all');
  const years = useMemo(() => yearsOf(banks.map((b) => ({ id: b.meta.id }))), []);
  const filteredBanks = year === 'all' ? banks : banks.filter((b) => yearOf(b.meta.id) === year);

  return (
    <div className="page">
      <PageHeader title="真题模拟" subtitle="选择一套完整真题，按真实考试流程限时作答，自动判分并给出 710 分制估分" />

      <div className="grid-2 mb-16">
        <Card>
          <h3 style={{ marginTop: 0 }}>
            <span className="h-ico"><Icon name="target" size={16} /></span>
            选择套卷
          </h3>
          {banks.length > 0 && (
            <div className="mb-16">
              <YearFilter years={years} value={year} onChange={setYear} />
            </div>
          )}
          {banks.length === 0 ? (
            <div className="muted">暂无可用的内置真题套卷。</div>
          ) : (
            <div className="bank-list">
              {filteredBanks.length === 0 ? (
                <div className="muted">该年份暂无套卷。</div>
              ) : (
                filteredBanks.map((b) => {
                  const t: ExamType = b.meta.level === 4 ? 'cet4' : 'cet6';
                  const c = b.meta.counts;
                  return (
                    <div key={b.meta.id} className="bank-card">
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <div className="row">
                          <Tag tone={t === 'cet4' ? 'blue' : 'purple'}>{t === 'cet4' ? '四级' : '六级'}</Tag>
                          <b>{b.meta.label}</b>
                        </div>
                      </div>
                      <div className="small muted mt-16">
                        写作 {c.writing} · 听力 {c.listening} · 选词 {c.banked} · 长篇 {c.long} · 阅读 {c.reading} · 翻译 {c.translation}
                      </div>
                      <div className="row mt-16" style={{ gap: 8 }}>
                        <button className="btn btn-primary" onClick={() => onStart(b, 'full')}>
                          <Icon name="play" size={15} />
                          整卷模拟
                        </button>
                        <button className="btn" onClick={() => onStart(b, 'no-listening')}>
                          <Icon name="doc" size={15} />
                          不含听力
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
          <div className="analysis-box mt-16">
            <b>考试流程</b>（125 分钟）：
            <div>① 写作（30 分钟）→ ② 听力（25 分钟）→ ③ 阅读理解（40 分钟）→ ④ 翻译（30 分钟）</div>
            <div className="small muted">客观题自动判分；写作与翻译提交后自评（0–15 分档）。</div>
            <div className="small muted">听力部分内置真题音频，可点击播放；未覆盖的套卷使用系统朗读。</div>
          </div>
        </Card>

        <Card>
          <h3 style={{ marginTop: 0 }}>
            <span className="h-ico"><Icon name="trend" size={16} /></span>
            历史成绩
          </h3>
          {history.length === 0 ? (
            <div className="muted">还没有考试记录，快来开始第一次模拟吧！</div>
          ) : (
            <div>
              {history.slice(0, 8).map((h) => (
                <div key={h.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <b>{h.totalScore}</b>
                    <span className="muted small"> / 710</span>
                  </div>
                  <div className="row">
                    <Tag tone={h.type === 'cet4' ? 'blue' : 'purple'}>{h.type === 'cet4' ? '四级' : '六级'}</Tag>
                    <span className="muted small">{new Date(h.date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    <button
                      className="btn btn-sm"
                      disabled={!h.exam || !h.answers}
                      onClick={() => onReview(h)}
                      title={h.exam ? '查看试卷与解析' : '该记录为旧版本，无试卷快照'}
                    >
                      <Icon name="doc" size={15} />
                      查看试卷
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="small muted mt-16">及格线参考：四级 425 分 · 六级 425 分</div>
        </Card>
      </div>
    </div>
  );
}

/* ============ 考试页 ============ */
function ExamView({ exam, onFinish, onAbort }: { exam: MockExamType; onFinish: (r: ExamResult) => void; onAbort: () => void }) {
  const [secIdx, setSecIdx] = useState(0);
  const [answers, setAnswers] = useState<ExamAnswers>({
    listening: {},
    reading: { banked: {}, long: {}, passages: {} },
  });
  const [selfScore, setSelfScore] = useState<Record<string, number>>({});
  const [writingText, setWritingText] = useState('');
  const [translationText, setTranslationText] = useState('');
  const [totalLeft, setTotalLeft] = useState(exam.sections.reduce((s, x) => s + x.minutes, 0) * 60);
  // 每个板块独立计时，切换板块时恢复该板块剩余时间（而非重置为完整时间）
  const [secLeftMap, setSecLeftMap] = useState<Record<number, number>>(() =>
    Object.fromEntries(exam.sections.map((s, i) => [i, s.minutes * 60]))
  );
  const [submitOpen, setSubmitOpen] = useState(false);
  // 防止时间到的 effect 重复触发（secLeft===0 时 effect 会持续命中）
  const secEndedRef = useRef(false);
  const totalEndedRef = useRef(false);

  const secLeft = secLeftMap[secIdx] ?? 0;
  const setSecLeft = (updater: number | ((s: number) => number)) => {
    setSecLeftMap((prev) => {
      const cur = prev[secIdx] ?? 0;
      const nv = typeof updater === 'function' ? updater(cur) : updater;
      return { ...prev, [secIdx]: nv };
    });
  };

  useEffect(() => {
    const t = setInterval(() => {
      setTotalLeft((s) => Math.max(0, s - 1));
      setSecLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secIdx]);

  useEffect(() => {
    if (secLeft !== 0) {
      secEndedRef.current = false;
      return;
    }
    if (secEndedRef.current) return;
    secEndedRef.current = true;
    // 不使用 alert（会阻塞计时器），直接自动进入下一板块或弹出交卷
    nextSection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secLeft]);

  useEffect(() => {
    if (totalLeft !== 0) {
      totalEndedRef.current = false;
      return;
    }
    if (totalEndedRef.current) return;
    totalEndedRef.current = true;
    doSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalLeft]);

  // 考试中按 Esc：有交卷弹窗先关弹窗，否则中止考试返回
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (submitOpen) setSubmitOpen(false);
      else if (confirm('确定退出本次考试吗？已作答内容不会保存。')) onAbort();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitOpen, onAbort]);

  const current = exam.sections[secIdx];

  // 稳定引用：让 memo 化的 ListeningSection 不随每秒计时重渲染
  const setListeningAnswer = useCallback(
    (qid: string, v: string) => setAnswers((a) => ({ ...a, listening: { ...a.listening, [qid]: v } })),
    []
  );

  const nextSection = () => {
    if (secIdx + 1 < exam.sections.length) {
      setSecIdx(secIdx + 1);
      // secLeft 由 secLeftMap[secIdx] 自动提供该板块剩余时间
    } else {
      setSubmitOpen(true);
    }
  };

  const prevSection = () => {
    if (secIdx > 0) {
      setSecIdx(secIdx - 1);
    }
  };

  const doSubmit = () => {
    const finalAnswers: ExamAnswers = {
      ...answers,
      writing: { selfScore: selfScore.writing ?? 8, content: writingText },
      translation: { selfScore: selfScore.translation ?? 8, content: translationText },
    };
    const r = gradeExam(exam, finalAnswers, exam.type);
    addActivity({ practiced: 1 });
    onFinish(r);
  };

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="page">
      <Card className="mb-16" style={{ padding: '14px 20px' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="section-nav">
            {exam.sections.map((s, i) => (
              <button
                key={s.key}
                className={`section-chip ${i === secIdx ? 'active' : ''} ${i < secIdx ? 'done' : ''}`}
                onClick={() => {
                  if (i < secIdx || i === secIdx) {
                    // 仅切换板块，secLeft 由 secLeftMap 保留该板块剩余时间，避免重置计时器
                    setSecIdx(i);
                  }
                }}
              >
                {i + 1}. {s.name}
              </button>
            ))}
          </div>
          <div className="row">
            <div className="text-right">
              <div className="small muted">当前板块</div>
              <div className={`exam-timer ${secLeft <= 60 ? 'warn' : ''}`}>{fmt(secLeft)}</div>
            </div>
            <div className="text-right" style={{ marginLeft: 12 }}>
              <div className="small muted">总剩余</div>
              <div className={`exam-timer ${totalLeft <= 300 ? 'warn' : ''}`}>{fmt(totalLeft)}</div>
            </div>
            <button className="btn btn-red" onClick={() => setSubmitOpen(true)}>交卷</button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>{secIdx + 1}. {current.name}
          <Tag tone="gray">满分 {sectionMax(exam, current.key)} 题 / 建议 {current.minutes} 分钟</Tag>
        </h3>

        {current.key === 'writing' && (
          <WritingSection item={exam.items.writing[0]} value={writingText} onChange={setWritingText} />
        )}
        {current.key === 'listening' && (
          <ListeningSection
            sets={exam.items.listening}
            answers={answers.listening}
            setAnswer={setListeningAnswer}
          />
        )}
        {current.key === 'reading' && (
          <ReadingSection exam={exam} answers={answers} setAnswers={setAnswers} />
        )}
        {current.key === 'translation' && (
          <TranslationSection item={exam.items.translation[0]} value={translationText} onChange={setTranslationText} />
        )}
      </Card>

      {submitOpen && (
        <Modal title="交卷评分" onClose={() => setSubmitOpen(false)}>
          {exam.mode === 'full' && (
            <p className="small muted inline-ico">
              <Icon name="warning" size={15} />
              交卷后听力将停止播放。
            </p>
          )}
          <div className="field">
            <label>写作自评（0–15 分）</label>
            <SelfScoreSlider value={selfScore.writing ?? 8} onChange={(v) => setSelfScore((s) => ({ ...s, writing: v }))} />
          </div>
          <div className="field">
            <label>翻译自评（0–15 分）</label>
            <SelfScoreSlider value={selfScore.translation ?? 8} onChange={(v) => setSelfScore((s) => ({ ...s, translation: v }))} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setSubmitOpen(false)}>返回检查</button>
            <button className="btn btn-primary" onClick={doSubmit}>确认交卷</button>
          </div>
        </Modal>
      )}

      {/* 悬浮板块切换（固定右下角） */}
      <div className="exam-float-nav">
        <button className="btn" disabled={secIdx === 0} onClick={prevSection}>
          ← 上一板块
        </button>
        <button className="btn btn-primary" onClick={nextSection}>
          {secIdx + 1 >= exam.sections.length ? '进入评分' : '下一板块 →'}
        </button>
      </div>
    </div>
  );
}

function SelfScoreSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <input
        type="range"
        min={0}
        max={15}
        value={value}
        style={{ width: '100%' }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">0 差</span>
        <b>{value} 分</b>
        <span className="small muted">15 优</span>
      </div>
    </div>
  );
}

// memo：计时器每秒触发 ExamView 重渲染，正文板块 props 不变时跳过（大段文章渲染开销大）
const WritingSection = memo(function WritingSection({
  item,
  value,
  onChange,
}: {
  item: WritingItem;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="passage-box" style={{ background: 'var(--primary-light)', border: 'none' }}>{item.prompt}</div>
      <div className="analysis-box">
        <div className="ab-title">写作要求</div>
        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
          {item.requirements.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
      <textarea className="textarea mt-16" rows={12} placeholder="在此完成你的作文…" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
});

const TranslationSection = memo(function TranslationSection({
  item,
  value,
  onChange,
}: {
  item: TranslationItem;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="passage-box" style={{ background: 'var(--primary-light)', border: 'none' }}>{item.prompt}</div>
      <textarea className="textarea mt-16" rows={8} placeholder="在此输入你的译文…" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
});

const ListeningSection = memo(function ListeningSection({
  sets,
  answers,
  setAnswer,
}: {
  sets: MockExamType['items']['listening'];
  answers: Record<string, string>;
  setAnswer: (qid: string, v: string) => void;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopAll = () => {
    stopSpeak();
    audioRef.current?.pause();
    setPlaying(null);
  };

  useEffect(() => () => stopAll(), []);

  const toggleSet = (id: string, transcript: string, audioUrl?: string) => {
    if (playing === id) {
      stopAll();
      return;
    }
    stopAll();
    setPlaying(id);
    if (audioUrl) {
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = audioUrl;
      audioRef.current.onended = () => setPlaying(null);
      audioRef.current.play();
    } else {
      const chunks = transcript.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).filter((t) => t.trim());
      const next = (i: number) => {
        if (i >= chunks.length) {
          setPlaying(null);
          return;
        }
        speak(chunks[i], { onEnd: () => next(i + 1) });
      };
      next(0);
    }
  };

  return (
    <div>
      {sets.length === 0 && <div className="muted">本套卷没有听力内容。</div>}
      {sets.map((s) => (
        <div key={s.id} className="mb-16" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b className="inline-ico">
              <Icon name="headphones" size={15} />
              {s.title}
            </b>
            <button className="btn btn-sm" onClick={() => toggleSet(s.id, s.transcript, s.audioUrl)}>
              {playing === s.id ? (
                <>
                  <Icon name="stop" size={14} />
                  停止播放
                </>
              ) : s.audioUrl ? (
                <>
                  <Icon name="play" size={14} />
                  播放真题音频
                </>
              ) : (
                <>
                  <Icon name="play" size={14} />
                  朗读听力
                </>
              )}
            </button>
          </div>
          {s.questions.map((q, qi) => (
            <div key={q.id} className="mt-16">
              <div className="small" style={{ fontWeight: 600 }}>{qi + 1}. {q.question || '（题干见听力原文）'}</div>
              <div className="mt-16">
                {q.options.map((opt, oi) => {
                  const key = String.fromCharCode(65 + oi);
                  const cls = answers[q.id] === key ? 'quiz-option selected' : 'quiz-option';
                  return (
                    <div key={key} className={cls} onClick={() => setAnswer(q.id, key)}>
                      <span className="opt-key">{key}</span>
                      <span>{opt}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

const ReadingSection = memo(function ReadingSection({
  exam,
  answers,
  setAnswers,
}: {
  exam: MockExamType;
  answers: ExamAnswers;
  setAnswers: (a: ExamAnswers) => void;
}) {
  const r = exam.items.reading;
  const b = r.banked;
  const lg = r.long;
  const set = (patch: Partial<ExamAnswers['reading']>) =>
    setAnswers({ ...answers, reading: { ...answers.reading, ...patch } });

  // 长篇阅读：底部当前题干索引（一次只显示一题）
  const [lgIdx, setLgIdx] = useState(0);

  // 选词填空空位数取自原文占位符（试卷不含答案时也能正常作答）；split 结果缓存，作答时不重复切原文
  const bankedParts = useMemo(() => (b ? b.passage.split('____') : null), [b]);
  const blankCount = bankedParts ? bankedParts.length - 1 : 0;
  const filledCount = Object.keys(answers.reading.banked).length;
  const bankedDone = blankCount > 0 && filledCount >= blankCount;
  const bankedWords = Object.values(answers.reading.banked);

  return (
    <div>
      {b && (
        <div className="mb-16">
          <h4 style={{ margin: '6px 0' }}>一、选词填空（{blankCount} 空）</h4>
          <div className={`banked-wrap${bankedDone ? ' done' : ''}`}>
            <div className="passage-box">
              {bankedParts!.map((p, i) => (
                <span key={i}>
                  {p}
                  {i < blankCount && (
                    <button
                      className="blanks"
                      title={answers.reading.banked[i] ? '点击移除该词' : ''}
                      onClick={() => {
                        if (!answers.reading.banked[i]) return;
                        const n = { ...answers.reading.banked };
                        delete n[i];
                        set({ banked: n });
                      }}
                    >
                      {answers.reading.banked[i] ?? `${i + 1}. ______`}
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="words-bank">
              {b.words.map((w) => (
                <button
                  key={w}
                  className={`word-chip ${bankedWords.includes(w) ? 'used' : ''}`}
                  onClick={() => {
                    if (!bankedWords.includes(w)) {
                      // 找到第一个未填的空位，避免移除中间空后填词覆盖现有答案
                      const nextIdx = Array.from({ length: blankCount }, (_, i) => i).find((i) => !answers.reading.banked[i]);
                      if (nextIdx !== undefined) {
                        set({ banked: { ...answers.reading.banked, [`${nextIdx}`]: w } });
                      }
                    }
                  }}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {lg && (
        <div className="mb-16">
          <h4 style={{ margin: '6px 0' }}>二、段落信息匹配</h4>
          {/* 顶部：选项按钮栏（字母 + 段落整句，整体可点击作答） */}
          <div className="long-options">
            {lg.paragraphs.map((p, i) => {
              const letter = String.fromCharCode(65 + i);
              const curId = lg.statements[lgIdx]?.id;
              const sel = !!curId && answers.reading.long[curId] === letter;
              const used = sel || Object.values(answers.reading.long).includes(letter);
              const text = p.replace(/^[A-O]\)\s*/, '');
              return (
                <button
                  key={i}
                  className={`long-opt${sel ? ' selected' : used ? ' used' : ''}`}
                  onClick={() => {
                    const sid = lg.statements[lgIdx]?.id;
                    if (!sid) return;
                    const prev = answers.reading.long[sid];
                    set({ long: { ...answers.reading.long, [sid]: prev === letter ? '' : letter } });
                  }}
                >
                  <span className="long-opt-key">{sel ? '✓ ' : ''}{letter}</span>
                  <span className="long-opt-text">{text}</span>
                </button>
              );
            })}
          </div>
          {/* 底部：题号小方块 + 上下箭头 + 当前题干 */}
          <div className="long-dock">
            <div className="long-nav">
              <button className="long-arrow" disabled={lgIdx <= 0} onClick={() => setLgIdx(Math.max(0, lgIdx - 1))} title="上一题">↑</button>
              {lg.statements.map((s, i) => (
                <button
                  key={s.id}
                  className={`long-chip${i === lgIdx ? ' active' : ''}${answers.reading.long[s.id] ? ' done' : ''}`}
                  onClick={() => setLgIdx(i)}
                  title={`${s.num ?? 36 + i}. ${s.text}`}
                >
                  {s.num ?? 36 + i}
                </button>
              ))}
              <button className="long-arrow" disabled={lgIdx >= lg.statements.length - 1} onClick={() => setLgIdx(Math.min(lg.statements.length - 1, lgIdx + 1))} title="下一题">↓</button>
            </div>
            {lg.statements[lgIdx] && (
              <div className="long-stmt">
                <div className="stmt">
                  {lg.statements[lgIdx].num != null && <b style={{ color: 'var(--primary)' }}>{lg.statements[lgIdx].num}.</b>}{' '}
                  {lg.statements[lgIdx].text}
                </div>
                <div className="long-chosen">
                  {answers.reading.long[lg.statements[lgIdx].id] ? (
                    <>
                      <Tag tone="blue">已选 {answers.reading.long[lg.statements[lgIdx].id]})</Tag>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const sid = lg.statements[lgIdx].id;
                          const n = { ...answers.reading.long };
                          delete n[sid];
                          set({ long: n });
                        }}
                      >
                        清除
                      </button>
                    </>
                  ) : (
                    <span className="muted">未作答 · 点击上方选项按钮选择</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {r.passages.map((p, pi) => (
        <div key={p.id} className="mb-16">
          <h4 style={{ margin: '6px 0' }}>{pi === 0 && b ? '三' : b && lg ? '四' : b ? '二' : '一'}、仔细阅读</h4>
          <div className="passage-box">{p.passage.split(/\n{2,}/).map((para, i) => <p className="para" key={i}>{para}</p>)}</div>
          {p.questions.map((q, qi) => (
            <div key={q.id} className="mb-16">
              <div className="small" style={{ fontWeight: 600 }}>{qi + 1}. {q.question || '（题干见听力原文）'}</div>
              {q.options.map((opt, oi) => {
                const key = String.fromCharCode(65 + oi);
                const cls = answers.reading.passages[p.id]?.[q.id] === key ? 'quiz-option selected' : 'quiz-option';
                return (
                  <div
                    key={key}
                    className={cls}
                    onClick={() =>
                      set({ passages: { ...answers.reading.passages, [p.id]: { ...answers.reading.passages[p.id], [q.id]: key } } })
                    }
                  >
                    <span className="opt-key">{key}</span>
                    <span>{opt}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

/* ============ 成绩页 ============ */

// 总分数字滚动（rAF 缓动，1.4s；过 425 变绿；reduced-motion 直达终态）
function BigScore({ value }: { value: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = String(value);
      if (value >= 425) el.classList.add('pass');
      return;
    }
    const t0 = performance.now();
    const D = 1400;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / D);
      el.textContent = String(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else if (value >= 425) {
        el.classList.add('pass');
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <div ref={ref} className="big-score">0</div>;
}

function ResultView({ result, onBack, onReview }: { result: ExamResult; onBack: () => void; onReview: (r: ExamResult) => void }) {
  const history = useMemo(() => loadExams(), []);
  const recent = history.slice(0, 6).reverse();
  const max = 710;

  // 成绩页按 Esc 返回
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const levelText = result.type === 'cet4' ? '大学英语四级' : '大学英语六级';
  const passed = result.totalScore >= 425;

  return (
    <div className="page">
      <PageHeader title="考试成绩" subtitle={levelText} extra={<button className="btn" onClick={onBack}>← 返回</button>} />

      <Card className="mb-16">
        <div className="result-hero">
          <BigScore value={result.totalScore} />
          <div className="score-sub">满分 710 分 · {passed ? '恭喜通过（≥425）' : '未达及格线 425 分，继续加油！'}</div>
          <div className="mt-16">
            <Tag tone={passed ? 'green' : 'red'}>
              <Icon name={passed ? 'check' : 'x'} size={13} />
              {passed ? '通过' : '未通过'}
            </Tag>
            <span className="muted small"> 客观题已自动判分 · 写作/翻译为自评</span>
          </div>
        </div>
      </Card>

      <div className="grid-3 mb-16">
        {result.sections.map((s) => (
          <Card key={s.key}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{s.name}</b>
              <b>{s.score710}</b>
            </div>
            <div className="small muted mb-16">满分 {s.cap}</div>
            <ProgressBar value={s.score710} max={s.cap} tone={s.key === 'reading' ? 'blue' : s.key === 'listening' ? 'green' : 'orange'} />
            <div className="small muted mt-16">
              {s.key === 'writing' || s.key === 'translation'
                ? `自评 ${s.correct} / ${s.max}`
                : `答对 ${s.correct} / ${s.max} 题`}
            </div>
          </Card>
        ))}
      </div>

      {recent.length >= 2 && (
        <Card>
          <h3 style={{ marginTop: 0 }}>
            <span className="h-ico"><Icon name="trend" size={16} /></span>
            最近成绩趋势
          </h3>
          <div className="chart">
            {recent.map((h) => (
              <div key={h.id} className="chart-col">
                <div
                  className="chart-bar"
                  style={{ height: `${Math.max(4, (h.totalScore / max) * 100)}%` }}
                />
                <div className="chart-label">{h.totalScore}</div>
                <div className="chart-label">{new Date(h.date).getMonth() + 1}/{new Date(h.date).getDate()}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-16 text-right" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {result.exam && (
          <button className="btn btn-primary" onClick={() => onReview(result)}>
            <Icon name="book" size={15} />
            查看答案与解析
          </button>
        )}
        <button className="btn" onClick={onBack}>完成</button>
      </div>
    </div>
  );
}

/* ============ 历史试卷回顾 ============ */
interface ReviewQuestion {
  id: string;
  question: string;
  options: string[];
  answer: string;
  analysis?: string;
}

interface ReviewMistakeSource {
  sourceType: 'exam' | 'practice';
  sourceId: string;
  sourceTitle: string;
  kind: MistakeKind;
  passage?: string;
  passageTitle?: string;
}

function QuestionReview({ q, chosen, mistake }: { q: ReviewQuestion; chosen?: string; mistake?: ReviewMistakeSource }) {
  const isRight = chosen === q.answer;
  return (
    <div className="mb-16">
      <div className="small" style={{ fontWeight: 600 }}>{q.question || '（题干见听力原文）'}</div>
      <div className="mt-16">
        {q.options.map((opt, oi) => {
          const key = String.fromCharCode(65 + oi);
          let cls = 'quiz-option';
          if (key === q.answer) cls += ' correct';
          else if (key === chosen) cls += ' wrong';
          return (
            <div key={key} className={cls}>
              <span className="opt-key">{key}</span>
              <span>{opt}</span>
              {key === q.answer && (
                <span className="small inline-ico" style={{ marginLeft: 'auto', color: 'var(--green)', fontWeight: 700 }}>
                  <Icon name="check" size={13} />
                  正确答案
                </span>
              )}
              {key === chosen && key !== q.answer && (
                <span className="small" style={{ marginLeft: 'auto', color: 'var(--red)', fontWeight: 700 }}>
                  你的答案
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="small mt-16">
        <Tag tone={isRight ? 'green' : chosen ? 'red' : 'gray'}>
          {isRight ? (
            <>
              <Icon name="check" size={13} />
              回答正确
            </>
          ) : chosen ? (
            <>
              <Icon name="x" size={13} />
              回答错误
            </>
          ) : (
            '未作答'
          )}
        </Tag>
        <span className="muted"> 正确答案：{q.answer}. {q.options[q.answer.charCodeAt(0) - 65] ?? ''}</span>
      </div>
      {q.analysis && (
        <div className="mt-16">
          <AnalysisBtn text={q.analysis} />
        </div>
      )}
      {mistake && (
        <div className="mt-16">
          <AddMistakeBtn
            item={{
              ...mistake,
              questionId: q.id,
              question: q.question,
              options: q.options,
              yourAnswer: chosen || '（未作答）',
              correctAnswer: q.answer,
              analysis: q.analysis,
            }}
          />
        </div>
      )}
    </div>
  );
}

function ReviewView({ record, onBack }: { record: ExamResult; onBack: () => void }) {
  const [secIdx, setSecIdx] = useState(0);
  const exam = record.exam;
  const answers = record.answers;
  const levelTag = record.type === 'cet4' ? '四级' : '六级';

  // 历史试卷回顾按 Esc 返回
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  if (!exam || !answers) {
    return (
      <div className="page">
        <PageHeader
          title="历史试卷"
          subtitle={`${levelTag} · ${new Date(record.date).toLocaleString('zh-CN')}`}
          extra={
            <button className="btn" onClick={onBack}>
              <Icon name="arrowLeft" size={15} />
              返回
            </button>
          }
        />
        <Card>
          <div className="empty">
            <div className="empty-icon"><Icon name="folder" size={28} /></div>
            <p>该记录为旧版本数据，未保存试卷快照，无法查看详情。</p>
          </div>
        </Card>
      </div>
    );
  }

  const current = exam.sections[secIdx];
  const secResult = record.sections.find((s) => s.key === current.key);

  return (
    <div className="page">
      <PageHeader
        title="历史试卷回顾"
        subtitle={`${levelTag} · ${new Date(record.date).toLocaleString('zh-CN')} · 总分 ${record.totalScore} / 710`}
        extra={<button className="btn" onClick={onBack}>← 返回</button>}
      />

      <Card className="mb-16" style={{ padding: '14px 20px' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="section-nav">
            {exam.sections.map((s, i) => (
              <button key={s.key} className={`section-chip ${i === secIdx ? 'active' : ''}`} onClick={() => setSecIdx(i)}>
                {i + 1}. {s.name}
              </button>
            ))}
          </div>
          {secResult && (
            <div className="row">
              <span className="small muted">客观题 {secResult.correct}/{secResult.max}</span>
              <Tag tone="blue">得分 {secResult.score710} / {secResult.cap}</Tag>
            </div>
          )}
        </div>
      </Card>

      {current.key === 'writing' && (
        <ReviewWriting item={exam.items.writing[0]} content={answers.writing?.content} selfScore={answers.writing?.selfScore} />
      )}
      {current.key === 'listening' && (
        <ReviewListening sets={exam.items.listening} answers={answers.listening} record={record} />
      )}
      {current.key === 'reading' && <ReviewReading exam={exam} answers={answers.reading} record={record} />}
      {current.key === 'translation' && (
        <ReviewTranslation item={exam.items.translation[0]} content={answers.translation?.content} selfScore={answers.translation?.selfScore} />
      )}
    </div>
  );
}

function ReviewWriting({ item, content, selfScore }: { item: WritingItem; content?: string; selfScore?: number }) {
  return (
    <div>
      <Card className="mb-16">
        <h3 style={{ marginTop: 0 }}>写作题目</h3>
        <div className="passage-box" style={{ background: 'var(--primary-light)', border: 'none' }}>{item.prompt}</div>
        <div className="analysis-box">
          <div className="ab-title">写作要求</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {item.requirements.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      </Card>
      <Card className="mb-16">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <span className="h-ico"><Icon name="pen" size={16} /></span>
            我的作文
          </h3>
          <Tag tone="blue">自评 {selfScore ?? '-'} / 15 分</Tag>
        </div>
        <div className="passage-box mt-16" style={{ whiteSpace: 'pre-wrap' }}>
          {content || '（未作答）'}
        </div>
      </Card>
      <Card>
        <h3 style={{ marginTop: 0 }}>
          <span className="h-ico"><Icon name="sparkle" size={16} /></span>
          参考范文（官方解析）
        </h3>
        <div className="passage-box" style={{ whiteSpace: 'pre-wrap' }}>{item.sample}</div>
      </Card>
    </div>
  );
}

function ReviewListening({
  sets,
  answers,
  record,
}: {
  sets: MockExamType['items']['listening'];
  answers: Record<string, string>;
  record: ExamResult;
}) {
  const src: ReviewMistakeSource = {
    sourceType: 'exam',
    sourceId: record.id,
    sourceTitle: `${record.type === 'cet4' ? '四级' : '六级'}模拟考`,
    kind: 'listening',
  };
  return (
    <div>
      {sets.map((s) => (
        <Card key={s.id} className="mb-16">
          <h3 style={{ marginTop: 0 }}>
            <span className="h-ico"><Icon name="headphones" size={16} /></span>
            {s.title}
          </h3>
          <div className="small muted mb-16">听力原文：</div>
          <div className="passage-box">{s.transcript}</div>
          {s.questions.map((q) => (
            <QuestionReview key={q.id} q={q} chosen={answers[q.id]} mistake={{ ...src, passageTitle: s.title, passage: s.transcript }} />
          ))}
        </Card>
      ))}
    </div>
  );
}

function ReviewReading({
  exam,
  answers,
  record,
}: {
  exam: MockExamType;
  answers: ExamAnswers['reading'];
  record: ExamResult;
}) {
  const r = exam.items.reading;
  const b = r.banked;
  const lg = r.long;
  const bankedBlankCount = b ? b.passage.split('____').length - 1 : 0;
  const bankedHasAnswer = !!b && b.answers.length > 0;
  const src: ReviewMistakeSource = {
    sourceType: 'exam',
    sourceId: record.id,
    sourceTitle: `${record.type === 'cet4' ? '四级' : '六级'}模拟考`,
    kind: 'reading',
  };
  return (
    <div>
      {b && (
        <Card className="mb-16">
          <h3 style={{ marginTop: 0 }}>一、选词填空（15 选 {bankedBlankCount}）</h3>
          <div className="passage-box">
            {b.passage.split('____').map((seg, i) => (
              <span key={i}>
                {seg}
                {i < bankedBlankCount && (
                  <span
                    className={`blanks ${
                      bankedHasAnswer
                        ? answers.banked[i] === b.answers[i]
                          ? 'blank-correct'
                          : answers.banked[i]
                            ? 'blank-wrong'
                            : 'blank-miss'
                        : 'blank-miss'
                    }`}
                  >
                    {i + 1}. {answers.banked[i] ?? '—'}
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="analysis-box">
            <div className="ab-title">答案对照</div>
            {bankedHasAnswer ? (
              <div>
                {b.answers.map((a, i) => {
                  const mine = answers.banked[i];
                  const ok = mine === a;
                  return (
                    <div key={i}>
                      {i + 1}. 你的：<b>{mine || '—'}</b>{' '}
                      {ok ? <span style={{ color: 'var(--green)' }}>✓</span> : <span style={{ color: 'var(--red)' }}>✗ 正确：{a}</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted">本套试卷未包含答案，暂无法判定对错（绿色=正确 / 红色=错误）。</div>
            )}
          </div>
          {b.analysisList?.some(Boolean) && (
            <div className="analysis-box">
              <div className="ab-title">逐题解析</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {b.answers.map((a, i) => (
                  <span key={i} className="row" style={{ gap: 6 }}>
                    {i + 1}. <AnalysisBtn text={b.analysisList?.[i]} />
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-16">
            <AddMistakeBtn
              item={{
                ...src,
                kind: 'banked',
                questionId: 'banked',
                question: '选词填空（15 选 10）',
                yourAnswer:
                  Object.entries(answers.banked)
                    .sort((x, y) => Number(x[0]) - Number(y[0]))
                    .map(([i, w]) => `${Number(i) + 1}. ${w}`)
                    .join('　') || '（未作答）',
                correctAnswer: b.answers.map((a, i) => `${i + 1}. ${a}`).join('　'),
                analysis: b.analysis,
                passage: b.passage,
                passageTitle: b.title,
              }}
            />
          </div>
        </Card>
      )}

      {lg && (
        <Card className="mb-16">
          <h3 style={{ marginTop: 0 }}>二、段落信息匹配</h3>
          <div className="passage-box">
            {lg.paragraphs.map((p, i) => (
              <p className="para" key={i}>{p}</p>
            ))}
          </div>
          {lg.statements.map((s) => {
            const mine = answers.long[s.id];
            const ok = mine === s.answer;
            return (
              <div key={s.id}>
                <div className="match-row">
                  <div className="stmt">{s.num != null && <b style={{ color: 'var(--primary)' }}>{s.num}.</b>} {s.text}</div>
                  <Tag tone={ok ? 'green' : mine ? 'red' : 'gray'}>
                    {ok ? (
                      <>
                        <Icon name="check" size={13} />
                        {s.answer}
                      </>
                    ) : mine ? (
                      <>
                        <Icon name="x" size={13} />
                        你的 {mine} · 应为 {s.answer}
                      </>
                    ) : (
                      `应为 ${s.answer}`
                    )}
                  </Tag>
                </div>
                {s.analysis && (
                  <div className="mt-8">
                    <AnalysisBtn text={s.analysis} />
                  </div>
                )}
                <div className="mb-16">
                  <AddMistakeBtn
                    item={{
                      ...src,
                      kind: 'longreading',
                      questionId: s.id,
                      question: s.text,
                      yourAnswer: mine || '（未作答）',
                      correctAnswer: s.answer,
                      passage: lg.paragraphs.join('\n'),
                      passageTitle: lg.title,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {r.passages.map((p) => (
        <Card key={p.id} className="mb-16">
          <h3 style={{ marginTop: 0 }}>仔细阅读 · {p.title}</h3>
          <div className="passage-box">{p.passage.split(/\n{2,}/).map((para, i) => <p className="para" key={i}>{para}</p>)}</div>
          {p.questions.map((q) => (
            <QuestionReview
              key={q.id}
              q={q}
              chosen={answers.passages[p.id]?.[q.id]}
              mistake={{ ...src, passageTitle: p.title, passage: p.passage }}
            />
          ))}
        </Card>
      ))}
    </div>
  );
}

function ReviewTranslation({ item, content, selfScore }: { item: TranslationItem; content?: string; selfScore?: number }) {
  return (
    <div>
      <Card className="mb-16">
        <h3 style={{ marginTop: 0 }}>翻译题目</h3>
        <div className="passage-box" style={{ background: 'var(--primary-light)', border: 'none' }}>{item.prompt}</div>
      </Card>
      <Card className="mb-16">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            <span className="h-ico"><Icon name="globe" size={16} /></span>
            我的译文
          </h3>
          <Tag tone="blue">自评 {selfScore ?? '-'} / 15 分</Tag>
        </div>
        <div className="passage-box mt-16" style={{ whiteSpace: 'pre-wrap' }}>
          {content || '（未作答）'}
        </div>
      </Card>
      <Card>
        <h3 style={{ marginTop: 0 }}>
          <span className="h-ico"><Icon name="notes" size={16} /></span>
          参考译文（官方解析）
        </h3>
        <div className="passage-box">{item.reference}</div>
        <div className="analysis-box">
          <div className="ab-title"><Icon name="bulb" size={14} />关键词提示</div>
          <div>
            {item.keywords.map((k) => (
              <Tag key={k} tone="purple" >{k}</Tag>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
