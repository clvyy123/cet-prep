import { useEffect, useRef, useState } from 'react';
import type {
  BankedCloze,
  LongReading,
  MistakeItem,
  ReadingPassage,
  TranslationItem,
  WritingItem,
} from '../types';
import { addActivity } from '../services/storage';
import { buildBanks, yearsOf, yearOf } from '../services/import';
import { addMistake } from '../services/mistakes';
import { Card, Tabs, Tag, PageHeader, AddMistakeBtn, Empty, ProgressBar, AnalysisBtn, YearFilter } from '../components/ui';
import Icon, { type IconName } from '../components/Icon';

type TypeKey = 'banked' | 'longreading' | 'reading' | 'translation' | 'writing';

const TABS: { key: TypeKey; label: string; desc: string }[] = [
  { key: 'banked', label: '选词填空', desc: '15 选 10 · 词性判断与上下文理解' },
  { key: 'longreading', label: '长篇阅读', desc: '段落信息匹配 · 快速定位能力' },
  { key: 'reading', label: '仔细阅读', desc: '四选一阅读 · 精读与推断' },
  { key: 'translation', label: '翻译', desc: '汉译英 · 高频话题' },
  { key: 'writing', label: '写作', desc: '议论文/记叙文 · 限时写作' },
];

export default function Practice() {
  const [type, setType] = useState<TypeKey>('banked');
  const [year, setYear] = useState<number | 'all'>('all');
  const [active, setActive] = useState<string | null>(null);
  const [banks] = useState(() => buildBanks());

  // 答题详情页按 Esc 返回列表
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // 列表与题目详情滚动位置分离：进入详情保存列表位置并滚到顶部，返回时恢复
  const savedScroll = useRef(0);
  useEffect(() => {
    const main = document.querySelector('.main');
    if (!main) return;
    if (active) {
      savedScroll.current = main.scrollTop;
      main.scrollTo(0, 0);
    } else {
      main.scrollTo(0, savedScroll.current);
    }
  }, [active]);

  const items = banks[type];
  const years = yearsOf(items);
  const filtered = year === 'all' ? items : items.filter((i) => yearOf(i.id) === year);

  if (active && items.some((i) => i.id === active)) {
    const item = items.find((i) => i.id === active);
    return (
      <div className="page">
        <PageHeader
          title={item?.title ?? ''}
          subtitle={TABS.find((t) => t.key === type)?.label}
          extra={
            <button className="btn" onClick={() => setActive(null)}>
              <Icon name="arrowLeft" size={15} />
              返回列表
            </button>
          }
        />
        {type === 'banked' && <BankedView item={item as BankedCloze} />}
        {type === 'longreading' && <LongReadingView item={item as LongReading} />}
        {type === 'reading' && <ReadingView item={item as ReadingPassage} />}
        {type === 'translation' && <TranslationView item={item as TranslationItem} />}
        {type === 'writing' && <WritingView item={item as WritingItem} />}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="真题练习"
        subtitle="覆盖四六级五大题型，客观题自动判分并附解析"
      />
      <Tabs
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        active={type}
        onChange={(k) => {
          setType(k as TypeKey);
          setActive(null);
        }}
      />
      <div className="mt-16 mb-16">
        <YearFilter years={years} value={year} onChange={setYear} />
      </div>
      <div className="grid-3">
        {filtered.length === 0 ? (
          <Card>
            <Empty icon="folder" text={items.length === 0 ? '暂无内置题目数据。' : '该年份暂无题目。'} />
          </Card>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="quick-item" onClick={() => setActive(item.id)}>
              <div className="qi-icon"><Icon name={typeIcon(type)} size={18} /></div>
              <div className="qi-title">{item.title}</div>
              <div className="qi-desc">
                <Tag tone={item.level === 4 ? 'blue' : 'purple'}>
                  {item.level === 4 ? '四级' : '六级'}
                </Tag>
                <span className="muted"> {meta(type, item)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const TYPE_ICON: Record<TypeKey, IconName> = {
  banked: 'cloze',
  longreading: 'link',
  reading: 'book',
  translation: 'globe',
  writing: 'pen',
};

function typeIcon(t: TypeKey): IconName {
  return TYPE_ICON[t];
}

function meta(t: TypeKey, item: unknown): string {
  switch (t) {
    case 'banked':
      return `${(item as BankedCloze).answers.length} 空`;
    case 'longreading':
      return `${(item as LongReading).statements.length} 题`;
    case 'reading':
      return `${(item as ReadingPassage).questions.length} 题`;
    case 'translation':
      return '汉译英';
    case 'writing':
      return '限时作文';
  }
}

/* ============ 选词填空 ============ */
function BankedView({ item }: { item: BankedCloze }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [activeBlank, setActiveBlank] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const used = Object.values(answers);
  const correct = item.answers.filter((a, i) => answers[i] === a).length;

  // 错题条目：提交与「加入错题本」按钮共用，避免两处重复构造
  const mistakeItem: Omit<MistakeItem, 'id' | 'addedAt' | 'mastered'> = {
    sourceType: 'practice',
    sourceId: item.id,
    sourceTitle: item.title,
    kind: 'banked',
    questionId: 'banked',
    question: `选词填空（15 选 ${item.answers.length}）`,
    yourAnswer:
      Object.entries(answers)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([i, w]) => `${Number(i) + 1}. ${w}`)
        .join('　') || '（未作答）',
    correctAnswer: item.answers.map((a, i) => `${i + 1}. ${a}`).join('　'),
    analysis: item.analysis,
    passage: item.passage,
    passageTitle: item.title,
  };

  const parts = item.passage.split('____');
  const pick = (w: string) => {
    if (submitted) return;
    if (activeBlank === null || used.includes(w)) return;
    setAnswers((a) => ({ ...a, [activeBlank]: w }));
    setActiveBlank(null);
  };

  const submit = () => {
    setSubmitted(true);
    addActivity({ practiced: item.answers.length, correct, wrong: item.answers.length - correct });
    // 自动收集错题：只要存在答错的空，整篇录入错题本（已存在自动去重）
    if (correct < item.answers.length) addMistake(mistakeItem);
  };

  const redo = () => {
    setAnswers({});
    setActiveBlank(null);
    setSubmitted(false);
  };

  const blankStatus = (i: number): string => {
    if (!submitted) return '';
    if (answers[i] === item.answers[i]) return 'correct';
    return answers[i] ? 'wrong' : 'miss';
  };

  return (
    <div className="banked-page">
      <div className="banked-main">
        <div className="row mb-8" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">答题进度：已填 {Object.keys(answers).length} / {item.answers.length} 空</span>
          {!submitted && <span className="small muted">{correct} 空正确</span>}
        </div>

        <div className="passage-box banked-passage">
          {parts.map((p, i) => (
            <span key={i}>
              {p}
              {i < parts.length - 1 && (
                <>
                <button
                  className={`blanks blank-${blankStatus(i)}`}
                  style={{ cursor: submitted ? 'default' : 'pointer', border: 'none' }}
                  onClick={() => {
                    if (submitted) return;
                    if (answers[i]) {
                      const n = { ...answers };
                      delete n[i];
                      setAnswers(n);
                    } else {
                      setActiveBlank(activeBlank === i ? null : i);
                    }
                  }}
                  title={submitted ? `答案：${item.answers[i]}` : '点击选择单词'}
                >
                  {submitted ? (
                    blankStatus(i) === 'correct' ? (
                      <>✓ {answers[i]}</>
                    ) : blankStatus(i) === 'wrong' ? (
                      <>✗ {answers[i]} <b>{item.answers[i]}</b></>
                    ) : (
                      <>{item.answers[i]}</>
                    )
                  ) : answers[i] ? (
                    `${i + 1}. ${answers[i]}`
                  ) : (
                    `${i + 1}. ______`
                  )}
                </button>
                {submitted && <AnalysisBtn text={item.analysisList?.[i]} />}
              </>
              )}
            </span>
          ))}
        </div>

        {submitted && (
          <Card>
            <h3 style={{ marginTop: 0 }}>
              <span className="h-ico"><Icon name="chart" size={16} /></span>
              得分：{correct} / {item.answers.length}
            </h3>
            <div className="analysis-box">
              <div className="ab-title">参考答案</div>
              <div>
                {item.answers.map((a, i) => `${i + 1}. ${a}`).join('　')}
              </div>
            </div>
            {item.analysisList?.some(Boolean) && (
              <div className="analysis-box">
                <div className="ab-title">逐题解析</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {item.answers.map((a, i) => (
                    <span key={i} className="row" style={{ gap: 6 }}>
                      {i + 1}. <AnalysisBtn text={item.analysisList?.[i]} />
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-16">
              <AddMistakeBtn item={mistakeItem} />
            </div>
          </Card>
        )}
      </div>

      <div className="banked-dock">
        <div className="words-bank">
          {item.words.map((w) => (
            <button
              key={w}
              className={`word-chip ${used.includes(w) ? 'used' : ''}`}
              onClick={() => pick(w)}
              disabled={submitted}
            >
              {w}
            </button>
          ))}
        </div>
        <div className="dock-row">
          <div className="dock-progress">
            <ProgressBar value={Object.keys(answers).length} max={item.answers.length} tone={submitted ? (correct === item.answers.length ? 'green' : 'orange') : 'blue'} />
          </div>
          {!submitted ? (
            <button className="btn btn-primary" onClick={submit}>
              提交并查看解析
            </button>
          ) : (
            <button className="btn" onClick={redo}>
              ↻ 重做一遍
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============ 长篇阅读 ============ */
function LongReadingView({ item }: { item: LongReading }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  // 底部当前题干索引（一次只显示一题）
  const [lgIdx, setLgIdx] = useState(0);

  const letters = item.paragraphs.map((_, i) => String.fromCharCode(65 + i));
  const cur = item.statements[lgIdx];
  const correct = item.statements.filter((s) => answers[s.id] === s.answer).length;

  const submit = () => {
    setSubmitted(true);
    addActivity({ practiced: item.statements.length, correct, wrong: item.statements.length - correct });
    // 自动收集错题：答错的题逐条录入错题本（已存在自动去重）
    item.statements.forEach((s) => {
      if (answers[s.id] !== s.answer) {
        addMistake({
          sourceType: 'practice',
          sourceId: item.id,
          sourceTitle: item.title,
          kind: 'longreading',
          questionId: s.id,
          question: s.text,
          yourAnswer: answers[s.id] || '（未作答）',
          correctAnswer: s.answer,
          passage: item.paragraphs.join('\n'),
          passageTitle: item.title,
        });
      }
    });
  };

  const redo = () => {
    setAnswers({});
    setSubmitted(false);
    setLgIdx(0);
  };

  const pick = (letter: string) => {
    if (!cur) return;
    setAnswers((a) => ({ ...a, [cur.id]: a[cur.id] === letter ? '' : letter }));
  };

  const clear = () => {
    if (!cur || submitted) return;
    const n = { ...answers };
    delete n[cur.id];
    setAnswers(n);
  };

  return (
    <div>
      <Card className="mb-16">
        <div className="row mb-8" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">答题进度：已答 {Object.keys(answers).length} / {item.statements.length} 题</span>
          {!submitted && <span className="small muted">{correct} 题正确</span>}
        </div>
        <ProgressBar value={Object.keys(answers).length} max={item.statements.length} tone={submitted ? (correct === item.statements.length ? 'green' : 'orange') : 'blue'} />
      </Card>

      {/* 顶部：选项按钮栏（字母 + 段落整句，整体可点击作答） */}
      <div className="long-options">
        {item.paragraphs.map((p, i) => {
          const letter = letters[i];
          const sel = !!cur && answers[cur.id] === letter;
          const used = sel || Object.values(answers).includes(letter);
          const text = p.replace(/^[A-O]\)\s*/, '');
          return (
            <button
              key={i}
              type="button"
              className={`long-opt${sel ? ' selected' : used ? ' used' : ''}`}
              disabled={submitted}
              onClick={() => pick(letter)}
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
          <button type="button" className="long-arrow" disabled={lgIdx <= 0} onClick={() => setLgIdx(Math.max(0, lgIdx - 1))} title="上一题" aria-label="上一题">
            <Icon name="arrowUp" size={15} />
          </button>
          {item.statements.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`long-chip${i === lgIdx ? ' active' : ''}${answers[s.id] ? ' done' : ''}`}
              onClick={() => setLgIdx(i)}
              title={`${s.num ?? 36 + i}. ${s.text}`}
            >
              {s.num ?? 36 + i}
            </button>
          ))}
          <button type="button" className="long-arrow" disabled={lgIdx >= item.statements.length - 1} onClick={() => setLgIdx(Math.min(item.statements.length - 1, lgIdx + 1))} title="下一题" aria-label="下一题">
            <Icon name="arrowDown" size={15} />
          </button>
        </div>
        {cur && (
          <div className="long-stmt">
            <div className="stmt">
              {cur.num != null && <b style={{ color: 'var(--primary)' }}>{cur.num}.</b>} {cur.text}
              {submitted && (
                <span className="small" style={{ marginLeft: 8 }}>
                  {answers[cur.id] === cur.answer ? (
                    <Tag tone="green">
                      <Icon name="check" size={13} />
                      {cur.answer}
                    </Tag>
                  ) : answers[cur.id] ? (
                    <Tag tone="red">
                      <Icon name="x" size={13} />
                      应为 {cur.answer}
                    </Tag>
                  ) : (
                    <Tag tone="gray">未作答 · 答案 {cur.answer}</Tag>
                  )}
                </span>
              )}
            </div>
            <div className="long-chosen">
              {answers[cur.id] ? (
                <>
                  <Tag tone="blue">已选 {answers[cur.id]})</Tag>
                  {!submitted && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>清除</button>
                  )}
                </>
              ) : (
                <span className="muted">未作答 · 点击上方选项按钮选择</span>
              )}
            </div>
          </div>
        )}
        {submitted && cur && (
          <div className="mt-16">
            {cur.analysis && <AnalysisBtn text={cur.analysis} />}
            <AddMistakeBtn
              item={{
                sourceType: 'practice',
                sourceId: item.id,
                sourceTitle: item.title,
                kind: 'longreading',
                questionId: cur.id,
                question: cur.text,
                yourAnswer: answers[cur.id] || '（未作答）',
                correctAnswer: cur.answer,
                passage: item.paragraphs.join('\n'),
                passageTitle: item.title,
              }}
            />
          </div>
        )}
        <div className="mt-16" style={{ textAlign: 'right' }}>
          {!submitted ? (
            <button className="btn btn-primary" onClick={submit}>提交判分</button>
          ) : (
            <button className="btn" onClick={redo}>↻ 重做一遍</button>
          )}
        </div>
      </div>

      {submitted && (
        <Card>
          <h3 style={{ marginTop: 0 }}>
            <span className="h-ico"><Icon name="chart" size={16} /></span>
            得分：{correct} / {item.statements.length}
          </h3>
        </Card>
      )}
    </div>
  );
}

/* ============ 仔细阅读 ============ */
function ReadingView({ item }: { item: ReadingPassage }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const correct = item.questions.filter((q) => answers[q.id] === q.answer).length;

  const submit = () => {
    setSubmitted(true);
    addActivity({ practiced: item.questions.length, correct, wrong: item.questions.length - correct });
    // 自动收集错题：答错的题逐题录入错题本（已存在自动去重）
    item.questions.forEach((q) => {
      if (answers[q.id] !== q.answer) {
        addMistake({
          sourceType: 'practice',
          sourceId: item.id,
          sourceTitle: item.title,
          kind: 'reading',
          questionId: q.id,
          question: q.question,
          options: q.options,
          yourAnswer: answers[q.id] || '（未作答）',
          correctAnswer: q.answer,
          analysis: q.analysis,
          passage: item.passage,
          passageTitle: item.title,
        });
      }
    });
  };

  const redo = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <div>
      <Card className="mb-16">
        <div className="row mb-8" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">答题进度：已答 {Object.keys(answers).length} / {item.questions.length} 题</span>
          {!submitted && <span className="small muted">{correct} 题正确</span>}
        </div>
        <ProgressBar value={Object.keys(answers).length} max={item.questions.length} tone={submitted ? (correct === item.questions.length ? 'green' : 'orange') : 'blue'} />
      </Card>

      <div className="passage-box">{item.passage.split(/\n{2,}/).map((para, i) => <p className="para" key={i}>{para}</p>)}</div>
      {item.questions.map((q, qi) => (
        <Card className="mb-16" key={q.id}>
          <div className="practice-q">{qi + 1}. {q.question || '（题干见听力原文）'}</div>
          <div className="mt-16">
            {q.options.map((opt, oi) => {
              const key = String.fromCharCode(65 + oi);
              let cls = 'practice-option';
              if (submitted) {
                if (key === q.answer) cls += ' correct';
                else if (answers[q.id] === key) cls += ' wrong';
              } else if (answers[q.id] === key) {
                cls += ' selected';
              }
              return (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  onClick={() => {
                    if (!submitted) setAnswers((a) => ({ ...a, [q.id]: key }));
                  }}
                >
                  <span className="opt-key">{key}</span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
          {submitted && (
            <div className="mt-16">
              {q.analysis && <AnalysisBtn text={q.analysis} />}
              <AddMistakeBtn
                item={{
                  sourceType: 'practice',
                  sourceId: item.id,
                  sourceTitle: item.title,
                  kind: 'reading',
                  questionId: q.id,
                  question: q.question,
                  options: q.options,
                  yourAnswer: answers[q.id] || '（未作答）',
                  correctAnswer: q.answer,
                  analysis: q.analysis,
                  passage: item.passage,
                  passageTitle: item.title,
                }}
              />
            </div>
          )}
        </Card>
      ))}
      <div className="row">
        {!submitted ? (
          <button className="btn btn-primary" onClick={submit}>
            提交判分
          </button>
        ) : (
          <>
            <span>得分 {correct} / {item.questions.length}</span>
            <button className="btn" onClick={redo}>
              ↻ 重做一遍
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============ 翻译 ============ */
function TranslationView({ item }: { item: TranslationItem }) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  return (
    <div>
      <Card className="mb-16">
        <h3 style={{ marginTop: 0 }}>请将下列段落翻译成英文</h3>
        <div className="passage-box" style={{ background: 'var(--primary-light)', border: 'none' }}>
          {item.prompt}
        </div>
        <textarea
          className="textarea"
          rows={8}
          placeholder="在此输入你的译文…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row mt-16">
          {!submitted ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                setSubmitted(true);
                addActivity({ practiced: 1 });
              }}
            >
              提交并对照参考译文
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => {
                setText('');
                setSubmitted(false);
              }}
            >
              ↻ 重做一遍
            </button>
          )}
        </div>
      </Card>

      {submitted && (
        <Card>
          <h3 style={{ marginTop: 0 }}>
            <span className="h-ico"><Icon name="notes" size={16} /></span>
            参考译文
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
          <div className="analysis-box">
            <div className="ab-title">自查建议</div>
            <div>
              对照参考译文检查：1) 时态与主谓一致；2) 关键词是否译出；3) 语序是否符合英文表达习惯。
              可到「AI 阅读」粘贴译文请求点评。
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ============ 写作 ============ */
function WritingView({ item }: { item: WritingItem }) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  return (
    <div>
      <Card className="mb-16">
        <h3 style={{ marginTop: 0 }}>题目</h3>
        <div className="passage-box" style={{ background: 'var(--primary-light)', border: 'none' }}>
          {item.prompt}
        </div>
        <div className="analysis-box">
          <div className="ab-title">写作要求</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {item.requirements.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        <textarea
          className="textarea mt-16"
          rows={10}
          placeholder="在此开始写作…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row mt-16">
          {!submitted ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                setSubmitted(true);
                addActivity({ practiced: 1 });
              }}
            >
              提交并查看范文
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => {
                setText('');
                setSubmitted(false);
              }}
            >
              ↻ 重做一遍
            </button>
          )}
        </div>
      </Card>

      {submitted && (
        <Card>
          <h3 style={{ marginTop: 0 }}>
            <span className="h-ico"><Icon name="sparkle" size={16} /></span>
            参考范文
          </h3>
          <div className="passage-box" style={{ whiteSpace: 'pre-wrap' }}>
            {item.sample}
          </div>
          <div className="analysis-box">
            <div className="ab-title">自查建议</div>
            <div>检查：1) 是否切题并涵盖所有要点；2) 段落结构是否清晰；3) 句型与词汇是否多样。</div>
          </div>
        </Card>
      )}
    </div>
  );
}
