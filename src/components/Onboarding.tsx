/**
 * 首次启动引导（诊断报告 S4）：三步完成备考配置——
 *   ① 选级别（四级 / 六级）→ ② 填考试日期 → ③ 选目标分
 * 完成后直接落在配置好的 Dashboard 上（S1 倒计时、S2 任务卡即刻生效）。
 * 已有本地数据的老用户在 App.tsx 里静默跳过，不进本组件。
 *
 * 样式只复用现有体系：Modal / btn / input / hint / Tag，
 * 新增的 .ob-* 类全部走 styles.css 既有 CSS 变量（bluechip 与星际黑自动适配）。
 */
import { useState } from 'react';
import type { Level } from '../types';
import { EXAM_SESSIONS } from '../data/exam-dates';
import { Modal } from './ui';
import Icon from './Icon';

export interface OnboardingResult {
  examLevel: Level;
  examDate: string;
  targetScore: number;
}

const TARGET_PRESETS = [425, 500, 550, 600];

export default function Onboarding({
  onFinish,
  onSkip,
}: {
  onFinish: (cfg: OnboardingResult) => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState<Level>(4);
  const [target, setTarget] = useState<number>(425);
  // 日期默认跟随所选中级别的官方公告日期；手动改过则尊重用户值
  const [dateTouched, setDateTouched] = useState(false);
  const [dateInput, setDateInput] = useState<string>('');

  const session = EXAM_SESSIONS[level === 4 ? 'cet4' : 'cet6'];
  const effDate = dateTouched && dateInput ? dateInput : session.date;

  const pickLevel = (lv: Level) => {
    setLevel(lv);
    // 级别切换后默认日期跟随官方常量（未手动改过时）
    if (!dateTouched) setDateInput('');
  };

  const finish = () => {
    const clamped = Math.max(200, Math.min(710, Math.round(Number(target) || 425)));
    onFinish({
      examLevel: level,
      // 保持官方默认时不落死值：未来常量更新后倒计时自动跟随
      examDate: effDate === session.date ? '' : effDate,
      targetScore: clamped,
    });
  };

  return (
    <Modal title="欢迎使用 词炬 · CET 备考助手" onClose={onSkip} width={520}>
      <div className="ob-top">
        <div className="ob-dots" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`ob-dot${i <= step ? ' is-on' : ''}`} />
          ))}
        </div>
        <span className="ob-step-label">0{step + 1} / 03</span>
      </div>

      {step === 0 && (
        <div className="ob-step">
          <p className="ob-lead">你备考哪个级别？</p>
          <div className="ob-levels">
            <button type="button" className={`ob-level${level === 4 ? ' is-on' : ''}`} onClick={() => pickLevel(4)}>
              <span className="h-ico"><Icon name="cap" size={16} /></span>
              <b>大学英语四级</b>
              <span className="small muted">CET-4 · {EXAM_SESSIONS.cet4.time}</span>
            </button>
            <button type="button" className={`ob-level${level === 6 ? ' is-on' : ''}`} onClick={() => pickLevel(6)}>
              <span className="h-ico"><Icon name="cap" size={16} /></span>
              <b>大学英语六级</b>
              <span className="small muted">CET-6 · {EXAM_SESSIONS.cet6.time}</span>
            </button>
          </div>
          <div className="hint">级别决定首页倒计时、任务卡取题范围，之后可在「设置」中修改。</div>
        </div>
      )}

      {step === 1 && (
        <div className="ob-step">
          <p className="ob-lead">考试日期是哪天？</p>
          <input
            className="input"
            type="date"
            value={effDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              setDateTouched(true);
              setDateInput(e.target.value);
            }}
          />
          <div className="hint">
            默认取官方公告日期（2026 年下半年笔试：12 月 12 日，{session.time}）。日期不准可在「设置」中随时修改。
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="ob-step">
          <p className="ob-lead">目标多少分？</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {TARGET_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                className={`btn btn-sm${target === t ? ' btn-primary' : ''}`}
                onClick={() => setTarget(t)}
              >
                {t} 分
              </button>
            ))}
            <input
              className="input"
              type="number"
              min={200}
              max={710}
              style={{ width: 90 }}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </div>
          <div className="hint">总分 710 分，425 分为常规及格线。目标分会出现在成绩报告的「距目标差距」里。</div>
        </div>
      )}

      <div className="row ob-foot" style={{ justifyContent: 'space-between' }}>
        {step > 0 ? (
          <button className="btn" onClick={() => setStep(step - 1)}>上一步</button>
        ) : (
          <button className="btn btn-ghost" onClick={onSkip}>跳过，稍后配置</button>
        )}
        {step < 2 ? (
          <button className="btn btn-primary" onClick={() => setStep(step + 1)}>下一步</button>
        ) : (
          <button className="btn btn-primary" onClick={finish}>完成，开始备考</button>
        )}
      </div>
    </Modal>
  );
}
