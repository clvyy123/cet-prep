import { useRef, useState } from 'react';
import { chat, buildSystemPrompt, isAIReady } from '../services/ai';
import { parseDocument, irToText, describeIR, isMarkdown, type DocumentIR } from '../services/parsers';
import { Card, Tag, PageHeader } from '../components/ui';
import MarkdownView from '../components/MarkdownView';
import Icon from '../components/Icon';

/** 一次一个需求：当前请求 + 对应 AI 输出（不做聊天记录堆叠） */
interface Task {
  query: string;
  output: string;
  err: string;
}

export default function AIReader() {
  const [custom, setCustom] = useState('');
  const [task, setTask] = useState<Task | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // 「自定义」需求面板：展开后用户可自行输入解析需求（总结 / 翻译 / 重点标注等）
  const [customOpen, setCustomOpen] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const outBodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 最近一次导入文档解析出的统一中间表示（驱动结构大纲；手工编辑后失效置空）
  const [ir, setIr] = useState<DocumentIR | null>(null);
  // 粘贴/输入的文本嗅探：是否像 Markdown（仅提示，不解析；输入框保持纯文本）
  const [pastedMd, setPastedMd] = useState(false);

  // 内置文章数据已移除，仅支持粘贴自定义文本
  const text = custom;
  const title = '自定义文章';

  const ready = isAIReady();

  /** 「语法解析」预设提示词：自动识别重点语法结构并输出简明解释 */
  const GRAMMAR_PROMPT =
    '请识别并解析这篇文章中的重点语法结构，逐条覆盖以下类型（如文中没有可跳过）：\n' +
    '1. 时态与语态（如完成时、进行时、被动语态）\n' +
    '2. 从句（定语从句、状语从句、名词性从句，说明引导词及从句修饰/充当的成分）\n' +
    '3. 非谓语动词（不定式、动名词、分词及其逻辑主语）\n' +
    '4. 虚拟语气、倒装、强调等特殊句式\n' +
    '5. 固定搭配与短语动词\n' +
    '每条先用原文引用例句（截取相关片段即可），再用中文简明解释语法要点，控制在 2–3 句内。';

  /** 发起当前需求：覆盖上一个需求及其输出（单任务视图） */
  const ask = async (userText: string) => {
    if (!text.trim() || busy || !userText.trim()) return;
    const sys = buildSystemPrompt(title || '未命名文章', text);
    setTask({ query: userText, output: '', err: '' });
    setBusy(true);
    setInput('');
    try {
      // 单轮请求：系统提示（含文章）+ 当前需求，不带历史对话
      await chat([sys, { role: 'user', content: userText }], (delta) => {
        setTask((t) => (t ? { ...t, output: t.output + delta } : t));
        // 只滚动输出容器自身，禁止 scrollIntoView 连带把整页（.main）滚走
        const body = outBodyRef.current;
        if (body) body.scrollTop = body.scrollHeight;
      });
    } catch (e) {
      setTask((t) => (t ? { ...t, err: (e as Error).message } : t));
    } finally {
      setBusy(false);
    }
  };

  const applyArticle = (v: string) => {
    setCustom(v);
  };

  const onArticleChange = (v: string) => {
    applyArticle(v);
    // 文章变化后旧答案不再对应 → 清空当前需求结果；同时嗅探是否为 Markdown（自动识别，不阻断输入）
    if (task) setTask(null);
    setIr(null);
    setPastedMd(isMarkdown(undefined, v));
  };

  // 一键清除：文章 + 结果 + 输入框 + 提示（同时收起自定义需求面板）
  const hasContent = custom.trim() !== '' || task !== null || input.trim() !== '' || customQuery.trim() !== '';
  const clearAll = () => {
    if (busy) return;
    setCustom('');
    setTask(null);
    setInput('');
    setCustomOpen(false);
    setCustomQuery('');
    setIr(null);
    setPastedMd(false);
    if (textareaRef.current) textareaRef.current.focus();
  };

  /** 提交自定义需求：发送后收起面板并清空草稿 */
  const submitCustom = () => {
    if (!customQuery.trim()) return;
    ask(customQuery);
    setCustomOpen(false);
    setCustomQuery('');
  };

  // ---- 文档导入（走解析插件管道：自动识别 Markdown / 文本 / Word） ----
  const [importing, setImporting] = useState(false);
  const [hint, setHint] = useState<{ tone: 'muted' | 'err'; text: string } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = (tone: 'muted' | 'err', text: string) => {
    setHint({ tone, text });
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 5000);
  };

  const importFile = async () => {
    if (importing) return;
    const api = window.cetAPI;
    if (!api?.pickDocFile) {
      showHint('err', '当前环境不支持导入文档，请在桌面版中使用，或在上方输入框粘贴');
      return;
    }
    setImporting(true);
    try {
      const res = await api.pickDocFile();
      if (res.ok) {
        // 统一解析管道：插件注册表自动识别格式 → 结构化 IR → AI 引擎文本
        const parsed = parseDocument({ name: res.name, content: res.content });
        setIr(parsed.format === 'markdown' ? parsed : null);
        setPastedMd(false);
        setTask(null);
        applyArticle(irToText(parsed));
        const summary = describeIR(parsed);
        showHint(
          'muted',
          parsed.format === 'markdown'
            ? `已识别 Markdown 文档「${res.name}」：${summary}`
            : `已导入：${res.name}（按纯文本处理）`
        );
        if (parsed.warnings.length) showHint('err', parsed.warnings[0]);
      } else if (res.reason === 'cancel') {
        showHint('muted', '已取消选择');
      } else if (res.reason === 'type') {
        showHint('err', res.message || '文件格式暂不支持：目前支持 Markdown / 文本 / Word');
      } else if (res.reason === 'empty') {
        showHint('err', res.message || '文件内容为空');
      } else {
        showHint('err', `解析失败：${res.message || '未知错误'}`);
      }
    } catch (e) {
      showHint('err', `导入失败：${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="AI 阅读助手"
        subtitle="借助大模型解析长难句、翻译全文、总结要点，不懂就问"
        extra={
          ready ? (
            <Tag tone="green">
              <Icon name="check" size={13} />
              AI 已配置
            </Tag>
          ) : (
            <Tag tone="orange">未配置 AI</Tag>
          )
        }
      />

      <div className="grid-2">
        {/* 左侧：文章（纯文本输入 + 导入解析） */}
        <div>
          <Card className="mb-16">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>
                <span className="h-ico"><Icon name="doc" size={16} /></span>
                文章
              </h3>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                {ir && <Tag tone="blue">Markdown 已解析</Tag>}
                {!ir && pastedMd && <Tag tone="gray">Markdown 格式</Tag>}
                {hasContent && (
                  <button className="btn btn-sm" disabled={busy} onClick={clearAll} title="清除文章与结果">
                    <Icon name="trash" size={13} />
                    一键清除
                  </button>
                )}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              className="textarea"
              rows={6}
              placeholder="粘贴你想分析的任何英文文章…"
              value={custom}
              onChange={(e) => onArticleChange(e.target.value)}
            />
          </Card>
          <Card>
            <div className="passage-box" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {text ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
              ) : (
                <div
                  className="empty empty-link"
                  title="点击导入文档（Markdown / Word / 文本）"
                  onClick={importFile}
                >
                  <div className="empty-icon">
                    <Icon name="doc" size={28} />
                  </div>
                  <p className={hint?.tone === 'err' ? 'empty-status-err' : undefined}>
                    {importing ? '正在解析文档…' : hint ? hint.text : '点击导入文档'}
                  </p>
                  {!importing && !hint && (
                    <p className="empty-sub">支持 Markdown / Word / 文本，或在上方输入框粘贴文章</p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Markdown 结构大纲：解析插件产出的 IR 可视化（标题层级 + 元素统计） */}
          {ir && ir.format === 'markdown' && <MarkdownOutline ir={ir} />}
        </div>

        {/* 右侧：AI 辅导（单任务视图：一次只显示当前需求 + 其输出，Markdown 渲染） */}
        <div>
          <Card className="ai-panel" style={{ display: 'flex', flexDirection: 'column', maxHeight: 720 }}>
            <h3 style={{ marginTop: 0 }}>
              <span className="h-ico"><Icon name="bot" size={16} /></span>
              AI 辅导
            </h3>
            {!ready && (
              <div className="notice notice-err">
                尚未配置 AI 服务。请前往「设置」填写 API 地址与密钥（支持 DeepSeek / OpenAI 等兼容接口）。
              </div>
            )}
            <div className="row mb-16" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-sm" disabled={!ready || !text || busy} onClick={() => ask('请把整篇文章翻译成中文，翻译时保持逐段对应，语言自然流畅。')}>
                <Icon name="globe" size={15} />
                全文翻译
              </button>
              <button className="btn btn-sm" disabled={!ready || !text || busy} onClick={() => ask('请用中文总结这篇文章的主旨大意，并分点列出各段落要点。')}>
                <Icon name="notes" size={15} />
                总结全文
              </button>
              <button className="btn btn-sm" disabled={!ready || !text || busy} onClick={() => ask('请挑出文章中 5 个对备考四六级最有价值的词汇或短语，解释含义并给出例句。')}>
                <Icon name="bulb" size={15} />
                高频词提取
              </button>
              <button className="btn btn-sm" disabled={!ready || !text || busy} onClick={() => ask(GRAMMAR_PROMPT)}>
                <Icon name="filter" size={15} />
                语法解析
              </button>
              <button
                className={`btn btn-sm${customOpen ? ' btn-primary' : ''}`}
                disabled={!ready || !text || busy}
                onClick={() => setCustomOpen((v) => !v)}
                title="自行提出阅读或解析需求"
              >
                <Icon name="pen" size={15} />
                自定义
              </button>
            </div>

            {/* 自定义需求输入框：总结 / 翻译 / 重点标注等，按用户指令动态生成结果 */}
            {customOpen && (
              <div className="row mb-16">
                <input
                  className="input flex-1"
                  autoFocus
                  placeholder="输入你的需求，如：总结主旨 / 翻译第三段 / 标注长难句…"
                  value={customQuery}
                  onChange={(e) => setCustomQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCustom();
                    if (e.key === 'Escape') setCustomOpen(false);
                  }}
                />
                <button className="btn btn-primary" disabled={busy || !customQuery.trim()} onClick={submitCustom}>
                  解析
                </button>
              </div>
            )}

            <div ref={outBodyRef} className="flex-1" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {!task && (
                <div className="muted small" style={{ padding: '12px 0' }}>
                  选择上方快捷操作，或在下方输入需求，一次处理一项，例如：<br />
                  · 解释第一段的主旨<br />
                  · “XXX” 是什么意思，如何翻译这句话？<br />
                  · 这篇文章属于什么文体？结构如何？
                </div>
              )}
              {task && (
                <>
                  <div className="md-query mb-16">
                    <span className="dt-tag">当前需求</span>
                    <span className="small" style={{ color: 'var(--ink-2)' }}>{task.query}</span>
                  </div>
                  {task.err ? (
                    <div className="notice notice-err">请求失败：{task.err}</div>
                  ) : task.output ? (
                    <MarkdownView text={task.output} />
                  ) : null}
                  {busy && (
                    <span className="ai-loading"><span className="spinner" /> {task.output ? 'AI 输出中…' : 'AI 思考中'}</span>
                  )}
                </>
              )}
            </div>

            <div className="row mt-16">
              <input
                className="input flex-1"
                placeholder="向 AI 提问这篇文章…"
                value={input}
                disabled={!ready || busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') ask(input);
                }}
              />
              <button className="btn btn-primary" disabled={!ready || busy || !input.trim()} onClick={() => ask(input)}>
                发送
              </button>
            </div>
            <div className="row mt-16" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">输出基于当前文章上下文生成，Markdown 格式渲染，请核对原文。</span>
              <button className="btn btn-sm" disabled={!task || busy} onClick={() => setTask(null)}>清除结果</button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Markdown 结构大纲：标题层级树 + 元素统计（数据来自解析插件产出的统一 IR） */
function MarkdownOutline({ ir }: { ir: DocumentIR }) {
  type HeadingBlock = Extract<DocumentIR['blocks'][number], { type: 'heading' }>;
  const headings = ir.blocks.filter((b): b is HeadingBlock => b.type === 'heading');
  const s = ir.stats;
  const chips: string[] = [];
  if (s.headings) chips.push(`标题 ${s.headings}`);
  if (s.lists) chips.push(`列表 ${s.lists}`);
  if (s.listItems) chips.push(`条目 ${s.listItems}`);
  if (s.codeBlocks) chips.push(`代码块 ${s.codeBlocks}`);
  if (s.tables) chips.push(`表格 ${s.tables}`);
  if (s.links) chips.push(`链接 ${s.links}`);
  if (s.images) chips.push(`图片 ${s.images}`);
  if (s.emphasis) chips.push(`强调 ${s.emphasis}`);
  if (s.inlineCode) chips.push(`行内代码 ${s.inlineCode}`);

  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>
          <span className="h-ico"><Icon name="notes" size={16} /></span>
          结构大纲
        </h3>
        <span className="small muted">解析插件自动识别，AI 将基于此结构阅读</span>
      </div>
      {chips.length > 0 ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: headings.length ? 12 : 0 }}>
          {chips.map((c) => (
            <span key={c} className="dt-tag">{c}</span>
          ))}
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>未识别到结构元素</p>
      )}
      {headings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {headings.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: (h.level - 1) * 16 }}>
              <span className="dt-tag" style={{ minWidth: 28, justifyContent: 'center' }}>H{h.level}</span>
              <span className="small" style={{ color: h.level <= 2 ? 'var(--ink)' : 'var(--ink-2)' }}>{h.text}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
