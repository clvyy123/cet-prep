import { useEffect, useRef, useState } from 'react';
import type { DictEntry } from '../services/dictionary';
import { lookupWord, pickWord } from '../services/dictionary';
import { chat, isAIReady } from '../services/ai';
import { speak } from '../services/tts';
import { Modal, Tag } from './ui';
import Icon from './Icon';

interface SelState {
  text: string;
  x: number;
  y: number;
  rectH: number;
}

/**
 * 全局文本选区工具条：
 * 在正文（真题练习 / 模拟考试 / 听力原文 / AI 阅读等）中选中英文文本后，
 * 弹出 词典 / 翻译 操作。
 */
export default function SelectionMenu() {
  const [sel, setSel] = useState<SelState | null>(null);
  const [dict, setDict] = useState<{ word: string; entry: DictEntry | null; loading: boolean } | null>(null);
  const [trans, setTrans] = useState<{ text: string; output: string; loading: boolean } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clear = () => setSel(null);

    const handler = () => {
      // 点击工具条内部不处理
      if (barRef.current && barRef.current.contains(document.activeElement)) return;
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.rangeCount === 0) {
        clear();
        return;
      }
      const text = s.toString().replace(/\s+/g, ' ').trim();
      if (!text || text.length > 300) {
        clear();
        return;
      }
      // 必须包含足够的英文字母（至少 2 个，避免选中单字母或纯中文时误弹）
      const enCount = (text.match(/[a-zA-Z]/g) ?? []).length;
      if (enCount < 2) {
        clear();
        return;
      }
      // 排除输入框 / 编辑区
      const node = s.anchorNode?.parentElement;
      if (node && node.closest('textarea, input, [contenteditable="true"]')) {
        clear();
        return;
      }
      const rect = s.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        clear();
        return;
      }
      setSel({ text, x: rect.left + rect.width / 2, y: rect.top, rectH: rect.height });
    };

    document.addEventListener('mouseup', handler);
    document.addEventListener('keyup', handler);
    document.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('mouseup', handler);
      document.removeEventListener('keyup', handler);
      document.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const close = () => {
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  const onDict = () => {
    const word = pickWord(sel?.text ?? '');
    if (!word) return;
    setDict({ word, entry: null, loading: true });
    close();
    lookupWord(word).then((entry) => setDict({ word, entry, loading: false }));
  };

  const translateText = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (!isAIReady()) {
      alert('翻译功能需要先配置 AI 服务：请前往「设置 → AI 阅读服务」填写 API 地址与密钥。');
      return;
    }
    setTrans({ text: t, output: '', loading: true });
    chat(
      [
        { role: 'system', content: '你是一名专业的中英翻译。请将用户给出的英文内容准确翻译成中文，语言自然通顺，直接输出译文，不要附加解释。' },
        { role: 'user', content: t },
      ],
      (delta) => setTrans((prev) => (prev ? { ...prev, output: prev.output + delta } : prev))
    )
      .catch((e) => setTrans((prev) => (prev ? { ...prev, output: `错误：${(e as Error).message}` } : prev)))
      .finally(() => setTrans((prev) => (prev ? { ...prev, loading: false } : prev)));
  };

  const onTranslate = () => {
    const text = sel?.text ?? '';
    close();
    translateText(text);
  };

  const above = (sel?.y ?? 100) > 90;

  return (
    <>
      {sel && (
        <div
          ref={barRef}
          className="sel-menu"
          data-above={above ? '1' : '0'}
          style={{
            left: sel.x,
            top: sel.y - 6,
            transform: above ? 'translate(-50%, -100%)' : `translate(-50%, ${sel.rectH + 6}px)`,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button className="sel-btn" onClick={onDict}>
            <Icon name="book" size={15} />
            词典
          </button>
          <button className="sel-btn" onClick={onTranslate}>
            <Icon name="globe" size={15} />
            翻译
          </button>
        </div>
      )}

      {dict && (
        <Modal title={`词典 · ${dict.word}`} onClose={() => setDict(null)} width={620}>
          <div>
            {/* ===== 查词结果 ===== */}
            {dict.loading ? (
              <div className="ai-loading"><span className="spinner" /> 查询中…</div>
            ) : dict.entry ? (
              <div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 style={{ margin: '0 0 4px' }}>{dict.entry.word}</h3>
                  <Tag tone={dict.entry.source === 'online' ? 'blue' : 'green'}>
                    {dict.entry.source === 'online' ? '在线词典' : '内置词库'}
                  </Tag>
                </div>
                {dict.entry.phonetic && <div className="muted" style={{ marginBottom: 10 }}>音标 /{dict.entry.phonetic}/</div>}
                {dict.entry.meanings.map((m, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <b style={{ color: 'var(--primary)' }}>{m.pos ?? '释义'}</b>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 22 }}>
                      {m.definitions.map((d, j) => (
                        <li key={j}>{d}</li>
                      ))}
                    </ul>
                  </div>
                ))}
                {dict.entry.examples && dict.entry.examples.length > 0 && (
                  <div className="analysis-box">
                    <div className="ab-title">例句</div>
                    {dict.entry.examples.map((ex, i) => (
                      <div key={i} style={{ fontStyle: 'italic', margin: '2px 0' }}>“{ex}”</div>
                    ))}
                  </div>
                )}
                <div className="small muted mt-16">
                  在线释义来自免费词典服务；如需将该词加入学习，可使用「单词记忆」页学习或批量导入。
                </div>
              </div>
            ) : (
              <div className="muted">
                在线词典未收录「{dict.word}」，内置词库中也没有该词。
                可使用「翻译」理解含义。
              </div>
            )}
          </div>
        </Modal>
      )}

      {trans && (
        <Modal title="翻译" onClose={() => setTrans(null)} width={560}>
          <div className="analysis-box" style={{ whiteSpace: 'pre-wrap' }}>{trans.text}</div>
          <div className="mt-16" style={{ whiteSpace: 'pre-wrap', minHeight: 60 }}>
            {trans.output || (trans.loading && <span className="ai-loading"><span className="spinner" /> 翻译中…</span>)}
          </div>
          <div className="mt-16 row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => speak(trans.text)}>
              <Icon name="speaker" size={15} />
              朗读原文
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
