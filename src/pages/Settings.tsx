import { useEffect, useRef, useState } from 'react';
import { getSettings, saveSettings, exportAll, importAll, clearAllData } from '../services/storage';
import { testConnection } from '../services/ai';
import type { Level } from '../types';
import { applyThemeSmooth, THEMES, type ThemeSwitchOrigin } from '../theme';
import { Card, PageHeader, Tag } from '../components/ui';
import Icon from '../components/Icon';

export default function Settings() {
  const [ai, setAi] = useState(() => getSettings().ai);
  const [dailyGoal, setDailyGoal] = useState(() => getSettings().dailyGoal);
  const [examLevel, setExamLevel] = useState<Level>(() => getSettings().examLevel);
  const [targetScore, setTargetScore] = useState(() => getSettings().targetScore);
  const [ttsRate, setTtsRate] = useState(() => getSettings().ttsRate);
  const [examSyncHours, setExamSyncHours] = useState(() => getSettings().examSyncHours ?? 24);
  const [theme, setTheme] = useState(() => getSettings().theme);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  // 保存提示定时器，卸载时清理
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    };
  }, []);

  const save = () => {
    saveSettings({
      ...getSettings(),
      ai,
      dailyGoal: Math.max(5, Math.min(200, Number(dailyGoal) || 30)),
      ttsRate,
      examLevel,
      examSyncHours: Math.min(168, Math.max(1, Math.round(Number(examSyncHours) || 24))),
      targetScore: Math.max(200, Math.min(710, Math.round(Number(targetScore) || 425))),
    });
    setSaved(true);
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      savedTimerRef.current = null;
      setSaved(false);
    }, 1500);
  };

  // 切换视觉风格：立即生效并落盘，无需点保存；origin 决定新皮肤从哪儿漾开。
  // 落盘挪到过渡收尾后（onSettled）：localStorage 写不与过渡的快照捕获抢主线程。
  const pickTheme = (key: string, origin?: ThemeSwitchOrigin) => {
    setTheme(key);
    applyThemeSmooth(key, origin, () => saveSettings({ ...getSettings(), theme: key }));
  };

  const onTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const reply = await testConnection(ai);
      setTestMsg({ type: 'ok', text: `连接成功：${reply.slice(0, 60)}` });
    } catch (e) {
      setTestMsg({ type: 'err', text: `连接失败：${(e as Error).message}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="设置"
        subtitle="AI 服务、学习偏好与数据管理"
        extra={
          saved ? (
            <Tag tone="green">
              <Icon name="check" size={13} />
              已保存
            </Tag>
          ) : undefined
        }
      />

      <div className="grid-2">
        <Card>
          <h3 style={{ marginTop: 0 }}>
            <span className="h-ico"><Icon name="bot" size={16} /></span>
            AI 阅读服务
          </h3>
          <div className="field">
            <label>API 地址（Base URL）</label>
            <input
              className="input"
              placeholder="https://api.deepseek.com/v1"
              value={ai.baseUrl}
              onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
            />
            <div className="hint">OpenAI 兼容接口，如 DeepSeek、OpenAI、硅基流动等，本地仅保存于本机。</div>
          </div>
          <div className="field">
            <label>API Key</label>
            <input
              className="input"
              type="password"
              placeholder="sk-…"
              value={ai.apiKey}
              onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
            />
          </div>
          <div className="field">
            <label>模型名称</label>
            <input
              className="input"
              placeholder="deepseek-chat"
              value={ai.model}
              onChange={(e) => setAi({ ...ai, model: e.target.value })}
            />
            <div className="hint">请填写你账户可用模型的 ID。</div>
          </div>
          <div className="row">
            <button className="btn" onClick={onTest} disabled={testing}>
              {testing ? (
                '测试中…'
              ) : (
                <>
                  <Icon name="plug" size={15} />
                  测试连接
                </>
              )}
            </button>
            {testMsg && (
              <div className={`notice ${testMsg.type === 'ok' ? 'notice-ok' : 'notice-err'}`} style={{ margin: 0, flex: 1 }}>
                {testMsg.text}
              </div>
            )}
          </div>
        </Card>

        <div>
          <Card className="mb-16">
            <h3 style={{ marginTop: 0 }}>
              <span className="h-ico"><Icon name="palette" size={16} /></span>
              外观
            </h3>
            <div className="setting-row">
              <div>
                <div className="sr-label">视觉风格</div>
                <div className="sr-hint">切换后立即生效，全站同步</div>
              </div>
              <div className="theme-picker">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`brand-swatch ${theme === t.key ? 'brand-swatch-active' : ''}`}
                    onClick={(e) => pickTheme(t.key, { x: e.clientX, y: e.clientY })}
                    aria-pressed={theme === t.key}
                  >
                    <span className="dot" style={{ background: t.color }} />
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="mb-16">
            <h3 style={{ marginTop: 0 }}>
              <span className="h-ico"><Icon name="cap" size={16} /></span>
              学习偏好
            </h3>
            <div className="setting-row">
              <div>
                <div className="sr-label">每日目标单词数</div>
                <div className="sr-hint">建议 20–50 个</div>
              </div>
              <input
                className="input"
                type="number"
                min={5}
                max={200}
                style={{ width: 90 }}
                value={dailyGoal}
                onChange={(e) => setDailyGoal(Number(e.target.value))}
              />
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">考试级别</div>
                <div className="sr-hint">首页倒计时与能力报告按此级别呈现</div>
              </div>
              <div className="row">
                <button
                  className={`btn btn-sm${examLevel === 4 ? ' btn-primary' : ''}`}
                  onClick={() => setExamLevel(4)}
                >
                  四级
                </button>
                <button
                  className={`btn btn-sm${examLevel === 6 ? ' btn-primary' : ''}`}
                  onClick={() => setExamLevel(6)}
                >
                  六级
                </button>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">目标分数</div>
                <div className="sr-hint">总分 710 · 425 为常规及格线</div>
              </div>
              <input
                className="input"
                type="number"
                min={200}
                max={710}
                style={{ width: 90 }}
                value={targetScore}
                onChange={(e) => setTargetScore(Number(e.target.value))}
              />
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">考试时间同步周期</div>
                <div className="sr-hint">自动从中国教育考试网核对四六级考试时间（小时）</div>
              </div>
              <input
                className="input"
                type="number"
                min={1}
                max={168}
                style={{ width: 90 }}
                value={examSyncHours}
                onChange={(e) => setExamSyncHours(Number(e.target.value))}
              />
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">听力朗读语速</div>
                <div className="sr-hint">0.8x 慢速 · 1x 正常 · 1.2x 快速</div>
              </div>
              <div className="row">
                {[0.8, 1, 1.2].map((r) => (
                  <button key={r} className={`btn btn-sm ${ttsRate === r ? 'btn-primary' : ''}`} onClick={() => setTtsRate(r)}>
                    {r}x
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <h3 style={{ marginTop: 0 }}>
              <span className="h-ico"><Icon name="database" size={16} /></span>
              数据管理
            </h3>
            <div className="setting-row">
              <div>
                <div className="sr-label">导出全部数据</div>
                <div className="sr-hint">包含词库、学习进度、考试记录等</div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const blob = new Blob([exportAll()], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `cet-prep-backup-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Icon name="download" size={15} />
                导出
              </button>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">导入备份数据</div>
                <div className="sr-hint">将覆盖当前本地数据</div>
              </div>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                <Icon name="upload" size={15} />
                导入
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const ok = importAll(String(reader.result));
                      alert(ok ? '导入成功，请重启应用生效。' : '导入失败：文件格式不正确。');
                    };
                    reader.readAsText(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <div className="setting-row">
              <div>
                <div className="sr-label">重置所有数据</div>
                <div className="sr-hint">清空词库、进度与成绩（不可恢复）</div>
              </div>
              <button
                className="btn btn-red btn-sm"
                onClick={() => {
                  if (confirm('确定清空全部本地数据吗？此操作不可恢复。')) {
                    clearAllData();
                    alert('已清空。重启应用后自动恢复内置词库。');
                  }
                }}
              >
                <Icon name="trash" size={15} />
                重置
              </button>
            </div>
          </Card>
        </div>
      </div>

      <button className="fab" onClick={save}>
        保存设置
      </button>
    </div>
  );
}
