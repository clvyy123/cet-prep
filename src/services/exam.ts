import type {
  ExamMode,
  ExamResult,
  ExamType,
  SectionResult,
  SectionKey,
  ExamAnswers,
  MockExam,
} from '../types';
import { save, KEYS, load } from './storage';
import type { BuiltinBank } from '../data/builtin-banks';
import { withAudio } from '../data/listening-audio';

// 考试各板块满分（710 分制）
export const SECTION_CAPS: Record<SectionKey, number> = {
  writing: 106.5,
  listening: 248.5,
  reading: 248.5,
  translation: 106.5,
};

/** 用指定内置套卷直接组卷（整卷模拟，不做随机抽取） */
export function buildMockExamFromBank(bank: BuiltinBank, mode: ExamMode): MockExam {
  const sections: MockExam['sections'] = [
    { key: 'writing', name: '写作', minutes: 30 },
    ...(mode === 'full'
      ? [{ key: 'listening' as const, name: '听力', minutes: 25 }]
      : []),
    { key: 'reading', name: '阅读理解', minutes: 40 },
    { key: 'translation', name: '翻译', minutes: 30 },
  ];
  return {
    id: `exam-${Date.now()}`,
    type: bank.meta.level === 4 ? 'cet4' : 'cet6',
    mode,
    sections,
    items: {
      writing: bank.writing,
      listening: bank.listening.map(withAudio),
      reading: { banked: bank.banked[0] ?? null, long: bank.long[0] ?? null, passages: bank.reading },
      translation: bank.translation,
    },
  };
}

/** 各板块满分题目数 */
export function sectionMax(exam: MockExam, key: SectionResult['key']): number {
  switch (key) {
    case 'writing':
      return 15; // 自评 0-15
    case 'listening':
      return exam.items.listening.reduce((n, s) => n + s.questions.length, 0);
    case 'reading': {
      const r = exam.items.reading;
      return (
        (r.banked ? r.banked.answers.length : 0) +
        (r.long ? r.long.statements.length : 0) +
        r.passages.reduce((n, p) => n + p.questions.length, 0)
      );
    }
    case 'translation':
      return 15; // 自评 0-15
    default:
      return 0;
  }
}

/** 将分数限制在 [0, cap] 范围内，避免自评或四舍五入导致超满分 */
function clampScore(score: number, cap: number): number {
  return Math.max(0, Math.min(cap, score));
}

/** 评分并保存成绩 */
export function gradeExam(
  exam: MockExam,
  answers: ExamAnswers,
  level: ExamType
): ExamResult {
  const r = exam.items.reading;
  const sections: SectionResult[] = [];

  // 写作（自评，clamp 到 0-15）
  const writingRaw = clampScore(answers.writing?.selfScore ?? 0, 15);
  sections.push({
    key: 'writing',
    name: '写作',
    correct: writingRaw,
    max: 15,
    score710: clampScore(Math.round((writingRaw / 15) * SECTION_CAPS.writing), SECTION_CAPS.writing),
    cap: SECTION_CAPS.writing,
  });

  // 听力（客观）
  if (exam.mode === 'full') {
    let listeningCorrect = 0;
    let listeningMax = 0;
    for (const set of exam.items.listening) {
      for (const q of set.questions) {
        listeningMax++;
        if ((answers.listening?.[q.id] ?? '') === q.answer) listeningCorrect++;
      }
    }
    sections.push({
      key: 'listening',
      name: '听力',
      correct: listeningCorrect,
      max: listeningMax,
      score710: clampScore(listeningMax ? Math.round((listeningCorrect / listeningMax) * SECTION_CAPS.listening) : 0, SECTION_CAPS.listening),
      cap: SECTION_CAPS.listening,
    });
  } else {
    sections.push({
      key: 'listening',
      name: '听力',
      correct: 0,
      max: 0,
      score710: 0,
      cap: SECTION_CAPS.listening,
    });
  }

  // 阅读（客观），对 answers.reading 做空值保护
  let readCorrect = 0;
  let readMax = 0;
  const readingAns = answers.reading ?? { banked: {}, long: {}, passages: {} };
  if (r.banked) {
    r.banked.answers.forEach((ans, i) => {
      readMax++;
      if ((readingAns.banked?.[`${i}`] ?? '') === ans) readCorrect++;
    });
  }
  if (r.long) {
    r.long.statements.forEach((s) => {
      readMax++;
      if ((readingAns.long?.[s.id] ?? '') === s.answer) readCorrect++;
    });
  }
  for (const p of r.passages) {
    for (const q of p.questions) {
      readMax++;
      if ((readingAns.passages?.[p.id]?.[q.id] ?? '') === q.answer) readCorrect++;
    }
  }
  sections.push({
    key: 'reading',
    name: '阅读理解',
    correct: readCorrect,
    max: readMax,
    score710: clampScore(readMax ? Math.round((readCorrect / readMax) * SECTION_CAPS.reading) : 0, SECTION_CAPS.reading),
    cap: SECTION_CAPS.reading,
  });

  // 翻译（自评，clamp 到 0-15）
  const transRaw = clampScore(answers.translation?.selfScore ?? 0, 15);
  sections.push({
    key: 'translation',
    name: '翻译',
    correct: transRaw,
    max: 15,
    score710: clampScore(Math.round((transRaw / 15) * SECTION_CAPS.translation), SECTION_CAPS.translation),
    cap: SECTION_CAPS.translation,
  });

  const result: ExamResult = {
    id: `result-${Date.now()}`,
    date: Date.now(),
    type: level,
    mode: exam.mode,
    sections,
    totalScore: Math.min(710, Math.round(sections.reduce((s, x) => s + x.score710, 0))),
    exam,
    answers,
  };

  const list = loadExams();
  list.unshift(result);
  save(KEYS.exams, list.slice(0, 50));
  return result;
}

export function loadExams(): ExamResult[] {
  return load<ExamResult[]>(KEYS.exams, []);
}
