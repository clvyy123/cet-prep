import { useEffect, useMemo, useState } from 'react';
import type { MistakeItem, MistakeKind } from '../types';
import {
  loadMistakes,
  saveMistakes,
  removeMistake,
  toggleMastered,
  extractFrequentWords,
} from '../services/mistakes';
import { chat, isAIReady } from '../services/ai';
import { Card, Tag, PageHeader, Empty } from '../components/ui';
import Icon, { type IconName } from '../components/Icon';

const KIND_LABEL: Record<MistakeKind, string> = {
  reading: '仔细阅读',
  banked: '选词填空',
  longreading: '长篇阅读',
  listening: '听力',
  vocabulary: '单词测验',
};

type PanelKey = 'analysis' | 'words' | 'translation';

const PANELS: { key: PanelKey; icon: IconName; label: string }[] = [
  { key: 'analysis', icon: 'book', label: '解析' },
  { key: 'words', icon: 'spell', label: '高频词梳理' },
  { key: 'translation', icon: 'globe', label: '翻译' },
];

export default function Mistakes() {
  const [items, setItems] = useState<MistakeItem[]>(() => loadMistakes());
  const [filter, setFilter] = useState<'all' | 'open' | 'mastered'>('all');
  const [kind, setKind] = useState<'all' | MistakeKind>('all');
  const [expanded, setExpanded] = useState<Record<string, PanelKey | null>>({});
  const [aiOut, setAiOut] = useState<Record<string, Partial<Record<PanelKey, string>>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [review, setReview] = useState<MistakeItem | null>(null);

  const refresh = () => setItems(loadMistakes());

  const filtered = items.filter((m) => {
    if (filter === 'open' && m.mastered) return false;
    if (filter === 'mastered' && !m.mastered) return false;
    if (kind !== 'all' && m.kind !== kind) return false;
    return true;
  });

  const stats = {
    total: items.length,
    open: items.filter((m) => !m.mastered).length,
    mastered: items.filter((m) => m.mastered).length,
  };

  const runAI = async (item: MistakeItem) => {
    if (!isAIReady()) {
      alert('AI 功能需要先配置服务：请前往「设置 → AI 阅读服务」填写 API 地址与密钥。');
      return;
    }
    const system = '你是一名专业的中英翻译。请将用户给出的英文句子或段落准确翻译成中文，语言自然通顺；若包含选项，请一并翻译。';
    const userContent = `请翻译以下内容为中文：\n${item.question}${item.options ? `\n选项：\n${item.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}` : ''}`;
    const panel = 'translation';
    setBusyId(item.id);
    setAiOut((prev) => ({ ...prev, [item.id]: { ...prev[item.id], [panel]: '' } }));
    try {
      await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        (delta) =>
          setAiOut((prev) => ({
            ...prev,
            [item.id]: { ...(prev[item.id] ?? {}), [panel]: (prev[item.id]?.[panel] ?? '') + delta },
          }))
      );
    } catch (e) {
      setAiOut((prev) => ({
        ...prev,
        [item.id]: { ...(prev[item.id] ?? {}), [panel]: `错误：${(e as Error).message}` },
      }));
    } finally {
      setBusyId(null);
    }
  };

  const renderPanel = (item: MistakeItem, key: PanelKey) => {
    if (key === 'analysis') {
      return (
        <details className="analysis-box" open>
          <summary className="ab-title"><Icon name="book" size={14} />解析</summary>
          <div>{formatAnalysis(item.analysis)}</div>
        </details>
      );
    }
    if (key === 'words') {
      return <WordsPanel text={`${item.question}\n${(item.options ?? []).join(' ')}\n${item.passage ?? ''}`} />;
    }
    // translation
    return (
      <div className="analysis-box">
        <div className="ab-title"><Icon name="globe" size={14} />翻译</div>
        {aiOut[item.id]?.translation ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{aiOut[item.id].translation}</div>
        ) : busyId === item.id ? (
          <div className="ai-loading"><span className="spinner" /> AI 翻译中…</div>
        ) : (
          <button className="btn btn-sm" onClick={() => runAI(item)}>
            <Icon name="play" size={14} />
            开始翻译
          </button>
        )}
      </div>
    );
  };

  if (review) {
    return <ReviewView item={review} onBack={() => setReview(null)} />;
  }

  return (
    <div className="page">
      <PageHeader
        title="错题本"
        subtitle="来自练习与考试的错题 · 原文链接 / 解析 / 高频词 / AI 翻译，点击按钮展开"
        extra={
          <button
            className="btn btn-red"
            onClick={() => {
              if (confirm('确定清空全部错题吗？此操作不可恢复。')) {
                saveMistakes([]);
                refresh();
              }
            }}
          >
            <Icon name="trash" size={15} />
            清空错题
          </button>
        }
      />

      <Card className="stat-row cols-3 mb-16">
        <div className="stat-cell">
          <div className="stat-icon">
            <Icon name="bookmark" size={18} />
          </div>
          <div className="stat-info">
            <div className="num">{stats.total}</div>
            <div className="lbl">错题总数</div>
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-icon">
            <Icon name="timer" size={18} />
          </div>
          <div className="stat-info">
            <div className="num">{stats.open}</div>
            <div className="lbl">待巩固</div>
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-icon">
            <Icon name="check" size={18} />
          </div>
          <div className="stat-info">
            <div className="num">{stats.mastered}</div>
            <div className="lbl">已掌握</div>
          </div>
        </div>
      </Card>

      <div className="row mb-16">
        {(
          [
            { key: 'all', label: '全部' },
            { key: 'open', label: '待巩固' },
            { key: 'mastered', label: '已掌握' },
          ] as const
        ).map((f) => (
          <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-primary' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
        <div className="flex-1" />
        <select className="select" style={{ width: 160 }} value={kind} onChange={(e) => setKind(e.target.value as 'all' | MistakeKind)}>
          <option value="all">全部题型</option>
          {(Object.keys(KIND_LABEL) as MistakeKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Empty icon="folder" text="还没有错题。在「真题练习」或「历史试卷回顾」中点击「加入错题本」即可收录。" />
        </Card>
      ) : (
        filtered.map((item) => (
          <Card key={item.id} className="mb-16">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <Tag tone={item.sourceType === 'exam' ? 'blue' : item.sourceType === 'quiz' ? 'green' : 'orange'}>
                  {item.sourceType === 'exam' ? '模拟考试' : item.sourceType === 'quiz' ? '单词测验' : '真题练习'}
                </Tag>
                <Tag tone="purple">{KIND_LABEL[item.kind]}</Tag>
                <span className="small muted">{item.sourceTitle}</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className="small muted">{new Date(item.addedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>
                <button
                  className={`btn btn-sm ${item.mastered ? 'btn-green' : ''}`}
                  onClick={() => {
                    toggleMastered(item.id);
                    refresh();
                  }}
                >
                  {item.mastered ? (
                    <>
                      <Icon name="check" size={14} />
                      已掌握
                    </>
                  ) : (
                    '标记掌握'
                  )}
                </button>
                <button
                  className="btn btn-red btn-sm"
                  onClick={() => {
                    removeMistake(item.id);
                    refresh();
                  }}
                >
                  删除
                </button>
              </div>
            </div>

            <div className="mt-16" style={{ fontWeight: 600 }}>{item.question}</div>

            {item.options && item.options.length > 0 && (
              <div className="mt-16">
                {item.options.map((opt, oi) => {
                  const key = String.fromCharCode(65 + oi);
                  let cls = 'quiz-option';
                  if (key === item.correctAnswer) cls += ' correct';
                  else if (key === item.yourAnswer) cls += ' wrong';
                  return (
                    <div key={key} className={cls}>
                      <span className="opt-key">{key}</span>
                      <span>{opt}</span>
                      {key === item.correctAnswer && (
                        <span className="small inline-ico" style={{ marginLeft: 'auto', color: 'var(--green)', fontWeight: 700 }}>
                          <Icon name="check" size={13} />
                          正确答案
                        </span>
                      )}
                      {key === item.yourAnswer && key !== item.correctAnswer && (
                        <span className="small" style={{ marginLeft: 'auto', color: 'var(--red)', fontWeight: 700 }}>你的答案</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="row mt-16" style={{ gap: 10, flexWrap: 'wrap' }}>
              <Tag tone="gray" wrap>你的答案：{item.yourAnswer || '—'}</Tag>
              <Tag tone="green" wrap>正确答案：{item.correctAnswer}</Tag>
            </div>

            <div className="row mt-16" style={{ gap: 8, flexWrap: 'wrap' }}>
              {item.passage && (
                <button className="btn btn-sm btn-primary" onClick={() => setReview(item)}>
                  <Icon name="link" size={15} />
                  原文链接
                </button>
              )}
              {PANELS.map((p) => (
                <button
                  key={p.key}
                  className={`btn btn-sm ${expanded[item.id] === p.key ? 'btn-primary' : ''}`}
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [item.id]: prev[item.id] === p.key ? null : p.key }))
                  }
                >
                  <Icon name={p.icon} size={15} />
                  {p.label}
                </button>
              ))}
            </div>

            {expanded[item.id] && <div className="mt-16">{renderPanel(item, expanded[item.id]!)}</div>}
          </Card>
        ))
      )}
    </div>
  );
}

/* ============ 原文链接：答题回顾界面 ============ */
function ReviewView({ item, onBack }: { item: MistakeItem; onBack: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="page">
      <PageHeader
        title="原文链接 · 答题回顾"
        subtitle={item.passageTitle ?? item.sourceTitle}
        extra={
          <button className="btn" onClick={onBack}>
            <Icon name="arrowLeft" size={15} />
            返回错题本
          </button>
        }
      />

      {item.passage && (
        <Card className="mb-16">
          <div className="ab-title"><Icon name="doc" size={14} />原文</div>
          <div style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto' }}>{item.passage}</div>
        </Card>
      )}

      <Card>
        <h3 style={{ marginTop: 0 }}>
          <span className="h-ico"><Icon name="question" size={16} /></span>
          题目
        </h3>
        <div style={{ fontWeight: 600 }}>{item.question}</div>

        {item.options && item.options.length > 0 && (
          <div className="mt-16">
            {item.options.map((opt, oi) => {
              const key = String.fromCharCode(65 + oi);
              let cls = 'quiz-option';
              if (key === item.correctAnswer) cls += ' correct';
              else if (key === item.yourAnswer) cls += ' wrong';
              return (
                <div key={key} className={cls}>
                  <span className="opt-key">{key}</span>
                  <span>{opt}</span>
                  {key === item.correctAnswer && (
                    <span className="small inline-ico" style={{ marginLeft: 'auto', color: 'var(--green)', fontWeight: 700 }}>
                      <Icon name="check" size={13} />
                      正确答案
                    </span>
                  )}
                  {key === item.yourAnswer && key !== item.correctAnswer && (
                    <span className="small" style={{ marginLeft: 'auto', color: 'var(--red)', fontWeight: 700 }}>你的答案</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="row mt-16" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Tag tone="gray" wrap>你的答案：{item.yourAnswer || '—'}</Tag>
          <Tag tone="green" wrap>正确答案：{item.correctAnswer}</Tag>
        </div>

        <div className="mt-16">
          <details className="analysis-box" open>
            <summary className="ab-title"><Icon name="book" size={14} />解析</summary>
            <div>{formatAnalysis(item.analysis)}</div>
          </details>
        </div>
      </Card>
    </div>
  );
}

/* ============ 解析文本格式化：每个考点独立成行 ============ */
function formatAnalysis(text?: string) {
  if (!text) return <span className="muted">该题未附带解析。</span>;
  const blocks = text
    .split('\n')
    .flatMap((line) => line.split(/(?=【考点】)/))
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <>
      {blocks.map((b, i) => (
        <div key={i} style={{ marginBottom: 10, lineHeight: 1.7 }}>
          {b}
        </div>
      ))}
    </>
  );
}

/* ============ 高频词 / 易错词梳理 ============ */
function WordsPanel({ text }: { text: string }) {
  const words = useMemo(() => extractFrequentWords(text, 12), [text]);
  return (
    <div className="analysis-box">
      <div className="ab-title"><Icon name="spell" size={14} />高频词 / 易错词梳理</div>
      {words.length === 0 && <div className="muted">未提取到有效词汇。</div>}
      {words.map((w) => (
        <div key={w.word} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed var(--border)', gap: 12 }}>
          <b style={{ minWidth: 120 }}>
            {w.word} <span className="muted small">×{w.count}</span>
          </b>
          <span style={{ flex: 1 }}>{w.meaning ?? <span className="muted">（内置词库未收录）</span>}</span>
          {w.inBank ? <Tag tone="blue">词库</Tag> : <Tag tone="gray">超纲</Tag>}
        </div>
      ))}
      <div className="small muted mt-16">
        词频统计自本题与原文（已过滤常见虚词）。标注「词库」表示已收录于内置词表，可到「单词记忆」学习掌握。
      </div>
    </div>
  );
}
