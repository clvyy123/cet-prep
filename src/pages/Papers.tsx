import { useEffect, useMemo, useRef, useState } from 'react';
import type { Paper, PaperBlock, PaperQuestion, PaperSection } from '../types';
import { PAPERS } from '../data/papers';
import Icon from '../components/Icon';
import { Card, Empty, PageHeader, formatAnalysis } from '../components/ui';
import { KEYS, load, save } from '../services/storage';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];

export default function Papers({ initialOpenId }: { initialOpenId?: string | null }) {
  // initialOpenId：Dashboard 任务卡「去完成」直达某套卷（App.tsx 的 paperFocus）
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [revealed, setRevealed] = useState(false);
  const [analysisMode, setAnalysisMode] = useState(false); // 是否从「答案解析」入口进入
  const paper = PAPERS.find((p) => p.id === openId);

  // fromAnswers=true 时（「答案解析」入口）进卷即展开解析并暴露解析按钮；
  // 「进入试卷」是答题模式，不显示任何解析入口
  const openPaper = (id: string, fromAnswers = false) => {
    setOpenId(id);
    setRevealed(fromAnswers);
    setAnalysisMode(fromAnswers);
  };

  if (paper) {
    return (
      <PaperView
        paper={paper}
        revealed={revealed}
        analysisMode={analysisMode}
        onToggleReveal={() => setRevealed((v) => !v)}
        onBack={() => {
          setOpenId(null);
          setRevealed(false);
          setAnalysisMode(false);
        }}
      />
    );
  }
  return <PaperList onOpen={openPaper} />;
}

/* ============================ 一级：试卷列表 ============================ */

function PaperList({ onOpen }: { onOpen: (id: string) => void }) {
  const [month, setMonth] = useState<number | 'all'>('all');
  const [year, setYear] = useState<number | 'all'>('all');

  const years = useMemo(
    () => [...new Set(PAPERS.map((p) => p.year))].sort((a, b) => b - a),
    []
  );
  const months = useMemo(() => [...new Set(PAPERS.map((p) => p.month))].sort((a, b) => a - b), []);
  const list = PAPERS.filter(
    (p) => (year === 'all' || p.year === year) && (month === 'all' || p.month === month)
  );

  return (
    <>
      <PageHeader
        title="试卷"
        subtitle="按年份、月份筛选，进入整卷研读：卷面原文、音频原文、官方解析逐题对照"
        extra={<span className="paper-count">已导入 {PAPERS.length} 套</span>}
      />
      {/* S5 信任标记：把两轮权威源校对这项隐性资产变成用户可感知的信号（低调一行） */}
      <div className="trust-note">
        <Icon name="shield" size={14} />
        答案经 examcrafts + 懒笔记双源交叉校对 · 覆盖 2021.06 – 2026.06 共 {PAPERS.length} 套
      </div>
      <div className="paper-layout">
        <Card className="paper-filter">
          <div className="pf-title">
            <span className="h-ico"><Icon name="filter" size={16} /></span>
            筛选条件
          </div>
          <div className="pf-group">
            <div className="pf-label"><span className="h-ico"><Icon name="calendar" size={14} /></span>月份选择</div>
            <div className="pf-months">
              {months.map((m) => (
                <button
                  key={m}
                  className={`pf-month ${month === m ? 'is-on' : ''}`}
                  onClick={() => setMonth(month === m ? 'all' : m)}
                >
                  {m}月
                </button>
              ))}
            </div>
          </div>
          <div className="pf-group">
            <div className="pf-label"><span className="h-ico"><Icon name="calendar" size={14} /></span>年份选择</div>
            <div className="pf-years">
              {years.map((y) => (
                <button
                  key={y}
                  className={`pf-year ${year === y ? 'is-on' : ''}`}
                  onClick={() => setYear(year === y ? 'all' : y)}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <div className="paper-grid">
          {list.map((p) => (
            <PaperCard key={p.id} paper={p} onOpen={onOpen} />
          ))}
          {!list.length && <Empty icon="doc" text="该筛选条件下还没有试卷" />}
        </div>
      </div>
    </>
  );
}

function PaperCard({ paper, onOpen }: { paper: Paper; onOpen: (id: string, fromAnswers?: boolean) => void }) {
  // 同一 partNo 的多个听力 variant（第3套导入）只按一套计题
  const seenParts = new Set<string>();
  const questions = paper.sections.reduce((n, s) => {
    if (s.sourceSet) {
      if (seenParts.has(s.partNo)) return n;
      seenParts.add(s.partNo);
    }
    return n + s.blocks.reduce((m, b) => m + b.questions.length, 0);
  }, 0);
  return (
    <Card className="paper-card">
      <div className="pc-head">
        <h3>{paper.title}</h3>
        <span className="pc-badge">{paper.year}年</span>
      </div>
      <div className="pc-meta">
        <span className="pc-chip"><span className="h-ico"><Icon name="doc" size={13} /></span>{paper.setNo}</span>
        <span className="pc-chip"><span className="h-ico"><Icon name="calendar" size={13} /></span>{paper.month}月</span>
        <span className="pc-chip"><span className="h-ico"><Icon name="timer" size={13} /></span>{paper.minutes}分钟</span>
      </div>
      <div className="pc-stat">
        <span className="pc-stat-label">题量</span>
        <span className="pc-stat-num">{questions} 题</span>
      </div>
      <div className="pc-bar">
        <span style={{ width: '100%' }} />
      </div>
      <div className="pc-actions">
        <button className="btn btn-primary btn-sm" onClick={() => onOpen(paper.id)}>
          <span className="inline-ico"><Icon name="play" size={15} /></span>
          进入试卷
        </button>
        <button className="btn btn-sm" onClick={() => onOpen(paper.id, true)}>
          <span className="inline-ico"><Icon name="bulb" size={15} /></span>
          答案解析
        </button>
      </div>
    </Card>
  );
}

/* ============================ 二级：整卷 ============================ */

function PaperView({
  paper,
  revealed,
  analysisMode,
  onToggleReveal,
  onBack,
}: {
  paper: Paper;
  revealed: boolean;
  analysisMode: boolean;
  onToggleReveal: () => void;
  onBack: () => void;
}) {
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false); // 已交卷：批改对错并锁定作答
  // 作文 / 短文翻译作答：block.id → 正文。block.id 全局唯一（形如 `cet4-2024_12_1-writing`），
  // 无需再拼卷号。改动即时落盘，关掉应用再进来不丢字；交卷时另有一次显式落盘（见 doSubmit）。
  const [drafts, setDrafts] = useState<Record<string, string>>(() => load(KEYS.paperAnswers, {}));
  useEffect(() => {
    save(KEYS.paperAnswers, drafts);
  }, [drafts]);
  const [roll, setRoll] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  // 同一 partNo 有多个「听力 variant」（第3套从第1/2套导入）时随机显示一个；
  // 进卷随机一次，点「换一套」按序轮换。seed = 挂载随机基数 + roll，
  // shownSections 内部用稳定 hash，保证作答重渲染不重摇、且每次点击必切换。
  const [seedBase] = useState(() => Math.floor(Math.random() * 1013));
  const sections = useMemo(() => shownSections(paper, seedBase + roll), [paper, seedBase, roll]);
  const allNums = useMemo(
    () => sections.flatMap((s) => s.blocks.flatMap((b) => b.questions.map((q) => q.num))),
    [sections]
  );
  // 题号 → 标准答案。只认「当前显示的 sections」：同一 partNo 的听力 variant 题号重叠
  // 但答案不同，取 paper.sections 的首个匹配会配上没显示的那一套答案。
  // 段落匹配（36-45）有少量题在源站就没有答案，不参与判分。
  const answers = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sections)
      for (const b of s.blocks)
        for (const q of b.questions) {
          const a = (q.answer || '').trim();
          if (a && !m.has(q.num)) m.set(q.num, a);
        }
    return m;
  }, [sections]);
  const gradable = useMemo(() => allNums.filter((n) => answers.has(n)).length, [allNums, answers]);
  const right = useMemo(
    () => allNums.filter((n) => picked[n] && answers.get(n) === picked[n]).length,
    [allNums, picked, answers]
  );
  const done = Object.keys(picked).length;
  // 交卷后与「显示答案解析」共用同一套对错渲染，只是不展开解析正文
  const shown = revealed || submitted;

  // 交卷：客观题已在 picked 里，作文 / 短文翻译的正文此刻再显式落盘一次，
  // 保证「提交」这一动作本身就把答案数据写进存储（而不是只依赖输入时的即时保存）。
  const doSubmit = () => {
    save(KEYS.paperAnswers, drafts);
    setSubmitted(true);
  };

  // 题号目录跳转：只在卷面自己的滚动容器里滚，不去动整页（两栏滚动互不干扰）
  const jumpTo = (n: number) => {
    const box = mainRef.current;
    const el = box?.querySelector<HTMLElement>(`#pq-${n}`);
    if (!box || !el) return;
    const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTo({ top: box.scrollTop + delta - 8, behavior: 'smooth' });
  };

  return (
    <div className="paper-page">
      <div className="paper-topbar">
        <button className="btn btn-sm btn-ghost" onClick={onBack}>
          <span className="inline-ico"><Icon name="arrowLeft" size={15} /></span>
          返回列表
        </button>
        <div className="pt-title">
          <span className="pt-name">{paper.title}</span>
          <span className="pt-sub">{paper.level === 4 ? '四级' : '六级'} · {paper.minutes} 分钟 · {allNums.length} 题 · 答案双源校对</span>
        </div>
        {analysisMode && (
          <button className={`btn btn-sm ${revealed ? 'btn-primary' : ''}`} onClick={onToggleReveal}>
            <span className="inline-ico"><Icon name="bulb" size={15} /></span>
            {revealed ? '隐藏解析' : '显示答案解析'}
          </button>
        )}
      </div>

      <div className="paper-layout paper-layout-split">
        <div className="paper-main" ref={mainRef}>
          {sections.map((sec) => (
            <SectionView
              key={`${sec.partNo}-${sec.sourceSet || 'own'}`}
              section={sec}
              revealed={shown}
              locked={submitted}
              picked={picked}
              onPick={(n, v) => setPicked((p) => ({ ...p, [n]: v }))}
              drafts={drafts}
              onDraft={(blockId, v) => setDrafts((d) => ({ ...d, [blockId]: v }))}
              variantCount={variantCountOf(paper, sec)}
              // 「听力原文」开关只在「答案解析」入口或交卷后出现：答题时不剧透
              allowTranscript={analysisMode || shown}
              // 换听力变体 = 换题，原批改结果作废（保留已选项，只退出交卷态）
              onSwitchVariant={() => {
                setRoll((v) => v + 1);
                setSubmitted(false);
              }}
            />
          ))}
        </div>

        <aside className="paper-aside">
          <Card className="pa-card">
            <div className="pa-title">{paper.title}</div>
            <div className="pa-sub">{paper.level === 4 ? '大学英语四级' : '大学英语六级'} · {paper.setNo}</div>
          </Card>
          {sections.map((sec) => {
            const nums = sec.blocks.flatMap((b) => b.questions.map((q) => q.num));
            if (!nums.length) return null;
            return (
              <Card key={sec.partNo} className="pa-card">
                <div className="pa-sec-title">
                  <span className="pa-sec-no">{sec.partNo}</span>
                  {sec.partName}部分
                </div>
                <div className="pa-grid">
                  {nums.map((n) => {
                    const a = answers.get(n);
                    const mine = picked[n];
                    const mark = shown && mine && a ? (mine === a ? 'is-right' : 'is-wrong') : '';
                    return (
                      <button
                        key={n}
                        type="button"
                        title={`跳到第 ${n} 题`}
                        className={`pa-cell ${mine ? 'is-done' : ''} ${mark}`}
                        onClick={() => jumpTo(n)}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
          <div className="pa-actions">
            {submitted ? (
              <span
                className="pa-score"
                title={
                  gradable < allNums.length
                    ? `本卷共 ${allNums.length} 题，其中 ${allNums.length - gradable} 题源卷未给出标准答案，不计入判分`
                    : undefined
                }
              >
                得分 <b>{right}</b> / {gradable}
              </span>
            ) : (
              <span className="pa-progress">已作 {done} / {allNums.length}</span>
            )}
            {submitted ? (
              <button
                className="btn btn-sm"
                onClick={() => {
                  setPicked({});
                  setSubmitted(false);
                }}
              >
                重新作答
              </button>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => setPicked({})} disabled={!done}>
                  清空作答
                </button>
                {!analysisMode && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={doSubmit}
                    disabled={!done}
                  >
                    <span className="inline-ico"><Icon name="check" size={15} /></span>
                    提交
                  </button>
                )}
              </>
            )}
            {analysisMode && <button className="btn btn-primary btn-sm" onClick={onToggleReveal}>查看答案解析</button>}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** 同一 partNo 携带多个来源 variant（第3套导入的第1/2套听力）时随机取一个，其余原样保留。
 *  seed 决定选中项：稳定 hash(paper.id) + seed，轮换确定性、跨卷伪随机 */
function shownSections(paper: Paper, seed: number): PaperSection[] {
  const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const variantParts = new Set(
    paper.sections.filter((s) => s.sourceSet).map((s) => s.partNo)
  );
  if (!variantParts.size) return paper.sections;
  const out: PaperSection[] = [];
  const taken = new Map<string, number>();
  for (const s of paper.sections) {
    if (!variantParts.has(s.partNo)) {
      out.push(s);
      continue;
    }
    // 同一 partNo 的多个 variant 全部映射到同一个选中项（主栏/目录一致）
    if (!taken.has(s.partNo)) {
      const pool = paper.sections.filter((x) => x.partNo === s.partNo && x.sourceSet);
      taken.set(s.partNo, (hash(paper.id + s.partNo) + seed) % pool.length);
    }
    const pick = paper.sections.filter((x) => x.partNo === s.partNo && x.sourceSet)[taken.get(s.partNo)!];
    if (pick === s) out.push(pick);
  }
  return out;
}

/** 该 section 所在 partNo 的 variant 数（>1 时展示「换一套」） */
function variantCountOf(paper: Paper, sec: PaperSection): number {
  if (!sec.sourceSet) return 0;
  return paper.sections.filter((x) => x.partNo === sec.partNo && x.sourceSet).length;
}

function SectionView({
  section,
  revealed,
  locked,
  picked,
  onPick,
  drafts,
  onDraft,
  variantCount,
  allowTranscript,
  onSwitchVariant,
}: {
  section: PaperSection;
  revealed: boolean;
  locked: boolean;
  picked: Record<number, string>;
  onPick: (n: number, v: string) => void;
  drafts: Record<string, string>;
  onDraft: (blockId: string, v: string) => void;
  variantCount: number;
  allowTranscript: boolean;
  onSwitchVariant: () => void;
}) {
  return (
    <section className="ps">
      <div className="ps-head">
        <div className="ps-head-left">
          <h3>Part {section.partNo} <span className="ps-en">{section.partNameEn}</span></h3>
          <span className="ps-score">{section.score} 分</span>
          {!!section.sourceSet && (
            <span className="dt-tag ps-src"><Icon name="speaker" size={13} />听力来源 · {section.sourceSet}</span>
          )}
        </div>
        <div className="ps-head-right">
          {variantCount > 1 && (
            <button className="btn btn-sm btn-ghost" onClick={onSwitchVariant}>
              <span className="inline-ico"><Icon name="speaker" size={15} /></span>
              换一套听力
            </button>
          )}
          <span className="ps-time">{section.minutes} minutes</span>
        </div>
      </div>
      {section.audioUrl && (
        <div className="ps-audio">
          <div className="ps-audio-item">
            <span className="ps-audio-label">听力音频</span>
            <audio controls preload="none" src={section.audioUrl} />
          </div>
        </div>
      )}
      {section.blocks.map((b) => (
        <BlockView
          key={b.id}
          block={b}
          revealed={revealed}
          locked={locked}
          picked={picked}
          onPick={onPick}
          drafts={drafts}
          onDraft={onDraft}
          allowTranscript={allowTranscript}
        />
      ))}
    </section>
  );
}

function BlockView({
  block,
  revealed,
  locked,
  picked,
  onPick,
  drafts,
  onDraft,
  allowTranscript,
}: {
  block: PaperBlock;
  revealed: boolean;
  locked: boolean;
  picked: Record<number, string>;
  onPick: (n: number, v: string) => void;
  drafts: Record<string, string>;
  onDraft: (blockId: string, v: string) => void;
  allowTranscript: boolean;
}) {
  const nums = block.questions.map((q) => q.num);
  const range = nums.length ? (nums.length > 1 ? `${nums[0]} - ${nums[nums.length - 1]}` : `${nums[0]}`) : '';
  const showLabel = !!block.label && block.label !== block.group && block.label !== block.groupCn;
  // 原文折叠：听力原文（block.intro 存在）默认跟随解析开关——答题时不剧透，
  // 进「答案解析」或交卷后默认展开；篇章原文是卷面正文，默认展开。手动切换优先于默认值。
  const isListening = !!block.intro;
  // 听力原文的开关按钮只在允许剧透时出现（答案解析入口 / 交卷后）；
  // 由「进入试卷」进入且未交卷时不渲染，避免答题时点开偷看原文。
  const canToggleMaterial = !!block.material && (!isListening || allowTranscript);
  const [materialOpen, setMaterialOpen] = useState<boolean | null>(null);
  const openMaterial = materialOpen ?? (!isListening || revealed);
  // 作文 / 短文翻译：整块没有小题，靠 prompt 出题（与「答案解析」的判定条件同源）。
  // 答题区只在「作答中」或「已交卷」出现——从「答案解析」入口进来是读答案，不摆空输入框。
  const isPromptTask = block.questions.length === 0 && !!block.prompt;
  const showAnswerBox = isPromptTask && (!revealed || locked);

  return (
    <div className="pb">
      <div className="pb-head">
        <div className="pb-left">
          <span className="pb-group">{block.group}</span>
          <span className="pb-cn">{block.groupCn}</span>
          {showLabel && <span className="pb-label">{block.label}</span>}
        </div>
        {canToggleMaterial && (
          <button
            type="button"
            className={`dt-tag ps-src pb-src ${openMaterial ? 'is-on' : ''}`}
            aria-expanded={openMaterial}
            title={openMaterial ? `收起${isListening ? '听力原文' : '篇章原文'}` : `展开${isListening ? '听力原文' : '篇章原文'}`}
            onClick={() => setMaterialOpen(!openMaterial)}
          >
            <Icon name={openMaterial ? 'eyeOff' : 'eye'} size={13} />
            {isListening ? '听力原文' : '篇章原文'}
          </button>
        )}
      </div>

      {block.prompt && <div className="pb-prompt">{block.prompt}</div>}

      {block.material && openMaterial && (
        <div className="pb-material">
          <div className="pb-material-text">{block.material}</div>
        </div>
      )}

      {block.wordBank && (
        <div className="pb-bank">
          {Object.keys(block.wordBank)
            .sort()
            .map((k) => (
              <span key={k} className="pb-bank-item">
                <b>{k}</b>
                {block.wordBank![k]}
              </span>
            ))}
        </div>
      )}

      {!!range && !!block.intro && <div className="pb-intro">{block.intro}</div>}

      {block.questions.map((q) => (
        <QuestionView key={q.num} q={q} revealed={revealed} locked={locked} picked={picked[q.num]} onPick={onPick} bank={!!block.wordBank} />
      ))}

      {showAnswerBox && (
        <div className="pb-answer">
          <div className="pb-answer-head">
            <span className="pb-answer-label">{block.sample ? '我的作文' : '我的译文'}</span>
            <span className="pb-answer-hint">
              {locked
                ? '已交卷 · 作答已保存'
                : (drafts[block.id] || '').trim()
                  ? `已作答 ${(drafts[block.id] || '').trim().length} 字 · 自动保存`
                  : '边写边存，离开后再回来不丢'}
            </span>
          </div>
          <textarea
            className="textarea pb-answer-text"
            rows={14}
            readOnly={locked}
            spellCheck={false}
            placeholder={block.sample ? '在此撰写你的作文…' : '在此完成你的译文…'}
            value={drafts[block.id] || ''}
            onChange={(e) => onDraft(block.id, e.target.value)}
          />
        </div>
      )}

      {revealed && block.questions.length === 0 && (block.sample || block.prompt) && (
        <WritingAnalysis block={block} />
      )}
    </div>
  );
}

function WritingAnalysis({ block }: { block: PaperBlock }) {
  return (
    <div className="pq-ana">
      {block.review && (
        <>
          <div className="ana-label">审题</div>
          <p className="ana-text">{block.review}</p>
        </>
      )}
      {!!block.terms?.length && (
        <>
          <div className="ana-label">难词译注</div>
          <div className="ana-vocab">
            {block.terms.map((v, i) => (
              <span key={i}>{v}</span>
            ))}
          </div>
        </>
      )}
      {block.reference && (
        <>
          <div className="ana-label">参考译文</div>
          <p className="ana-text ana-en">{block.reference}</p>
        </>
      )}
      {block.notes && (
        <>
          <div className="ana-label">译点精析</div>
          <p className="ana-text">{block.notes}</p>
        </>
      )}
      {block.sample && (
        <>
          <div className="ana-label">参考范文</div>
          <p className="ana-text ana-en">{block.sample}</p>
        </>
      )}
      {block.sampleNote && (
        <>
          <div className="ana-label">范文点评</div>
          <p className="ana-text">{block.sampleNote}</p>
        </>
      )}
      {block.sampleCn && (
        <>
          <div className="ana-label">范文译文</div>
          <p className="ana-text">{block.sampleCn}</p>
        </>
      )}
      {!!block.vocab?.length && (
        <>
          <div className="ana-label">亮点词汇</div>
          <div className="ana-vocab">
            {block.vocab.map((v, i) => (
              <span key={i}>{v}</span>
            ))}
          </div>
        </>
      )}
      {!!block.patterns?.length && (
        <>
          <div className="ana-label">写作句型</div>
          <div className="ana-patterns">
            {block.patterns.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function QuestionView({
  q,
  revealed,
  locked,
  picked,
  onPick,
  bank,
}: {
  q: PaperQuestion;
  revealed: boolean;
  locked: boolean;
  picked?: string;
  onPick: (n: number, v: string) => void;
  bank: boolean;
}) {
  const letters = Object.keys(q.options).sort();
  // 选词填空与长篇阅读的选项就是字母本身（词库 / 段落编号），只渲染字母格
  const letterOnly = bank || letters.length === 0;
  const isRight = picked === q.answer;

  return (
    <div className={`pq ${revealed ? 'is-revealed' : ''} ${locked ? 'is-locked' : ''}`} id={`pq-${q.num}`}>
      <div className="pq-head">
        <span className="pq-num">{q.num}</span>
        <div className="pq-stems">
          {q.stem && <div className="pq-stem">{q.stem}</div>}
          {revealed && !!q.stemCn && <div className="pq-stem-cn">{q.stemCn}</div>}
        </div>
        {revealed && !!q.answer && <span className={`pq-answer ${isRight ? 'is-right' : ''}`}>{q.answer}</span>}
      </div>

      <div className={`pq-opts ${letterOnly ? 'is-bank' : ''}`}>
        {(letterOnly ? LETTERS.slice(0, 15) : letters).map((L) => {
          const text = q.options[L];
          const cn = q.optionCn[L];
          const on = picked === L;
          const correct = revealed && q.answer === L;
          const wrong = revealed && on && !!q.answer && q.answer !== L;
          return (
            <button
              key={L}
              type="button"
              disabled={locked}
              className={`pq-opt ${on ? 'is-picked' : ''} ${correct ? 'is-correct' : ''} ${wrong ? 'is-wrong' : ''}`}
              onClick={() => onPick(q.num, L)}
            >
              <span className="pq-key">{L}</span>
              {letterOnly ? null : (
                <span className="pq-opt-text">
                  {text}
                  {revealed && cn && <em className="pq-opt-cn">{cn}</em>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 官方解析：与听力练习页同一套 .analysis-box 呈现，【答案】【定位】【排除】分段展示 */}
      {revealed && !!q.analysis && (
        <details className="analysis-box" open>
          <summary className="ab-title">官方解析</summary>
          <p className="ana-text">{formatAnalysis(q.analysis)}</p>
        </details>
      )}
    </div>
  );
}
