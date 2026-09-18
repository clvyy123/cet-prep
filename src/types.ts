export type Level = 4 | 6;

/** 词库分类（学习范围） */
export type Book = 'junior' | 'senior' | 'cet4' | 'cet6' | 'kaoyan' | 'toefl' | 'sat';

// ============ 单词 ============
export interface Word {
  id: string;
  word: string;
  book: Book;
  pos: string;
  meaning: string;
  example?: string;
  exampleCn?: string;
}

export type WordStatus = 'new' | 'learning' | 'mastered';

export interface WordProgress {
  status: WordStatus;
  stage: number;
  reviewCount: number;
  correctCount: number;
  wrongCount: number;
  nextReviewAt: number;
  lastReviewAt: number;
}

export interface DailyActivity {
  learned: number;
  reviewed: number;
  practiced: number;
  correct: number;
  wrong: number;
}

// ============ 设置 ============
export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Settings {
  dailyGoal: number;
  ttsRate: number;
  ttsVoice: string;
  theme: string;
  ai: AIConfig;
  /** 备考级别（S1 倒计时按级别呈现；S4 首启引导选择） */
  examLevel: Level;
  /** 目标总分（710 分制），默认 425（常规及格线） */
  targetScore: number;
  /** 自定义考试日期 YYYY-MM-DD；留空 = 使用 src/data/exam-dates.ts 的官方常量 */
  examDate: string;
  /** 考试时间同步插件的爬取周期（小时），默认 24（每天一次） */
  examSyncHours?: number;
}

// ============ 今日任务卡（S2） ============
/** 任务指向的真题资源（试卷页可直达） */
export interface TaskResource {
  paperId: string;
  paperTitle: string;
  /** 展示名，如「听力 · Part II Listening Comprehension」 */
  label: string;
  done: boolean;
}

/** 单日任务计划快照（按天生成并落 localStorage，保证当日目标数稳定不漂移） */
export interface DayPlan {
  /** YYYY-MM-DD */
  date: string;
  /** 单词：SRS 到期数 + 新词配额（动态取代写死的 todayGoal = 30） */
  word: { due: number; quota: number };
  listening: TaskResource | null;
  reading: TaskResource | null;
  /** 三项全部完成后置位，并记入完成历史（本周计划完成度用） */
  allDone: boolean;
}

// ============ 考试 ============
export type ExamType = 'cet4' | 'cet6';
export type ExamMode = 'full' | 'no-listening';
export type SectionKey = 'writing' | 'listening' | 'reading' | 'translation';

export interface SectionResult {
  key: SectionKey;
  name: string;
  correct: number;
  max: number;
  score710: number;
  cap: number;
}

/** 用户交卷时的全部答案（含写作/翻译文本） */
export interface ExamAnswers {
  writing?: { selfScore: number; content?: string };
  listening: Record<string, string>;
  reading: {
    banked: Record<string, string>;
    long: Record<string, string>;
    passages: Record<string, Record<string, string>>;
  };
  translation?: { selfScore: number; content?: string };
}

/** 一次模拟考试的完整试卷（可序列化快照） */
export interface MockExam {
  id: string;
  type: ExamType;
  mode: ExamMode;
  sections: { key: SectionKey; name: string; minutes: number }[];
  items: {
    writing: WritingItem[];
    listening: ListeningSet[];
    reading: {
      banked: BankedCloze | null;
      long: LongReading | null;
      passages: ReadingPassage[];
    };
    translation: TranslationItem[];
  };
}

export interface ExamResult {
  id: string;
  date: number;
  type: ExamType;
  mode: ExamMode;
  sections: SectionResult[];
  totalScore: number;
  /** 试卷快照与作答记录（用于历史回顾） */
  exam?: MockExam;
  answers?: ExamAnswers;
}

// ============ 阅读题库 ============
export interface ReadingQuestion {
  id: string;
  /** 原始题号（内置题库携带，如 46-55） */
  num?: number;
  question: string;
  options: string[];
  answer: string;
  analysis: string;
}

export interface ReadingPassage {
  id: string;
  level: Level;
  title: string;
  passage: string;
  questions: ReadingQuestion[];
}

export interface BankedCloze {
  id: string;
  level: Level;
  title: string;
  passage: string;
  words: string[];
  answers: string[];
  analysis: string;
  /** 按空位排列的解析（26-35），与 answers 一一对应 */
  analysisList?: string[];
}

export interface LongReadingStatement {
  id: string;
  /** 原始题号（内置题库携带，如 36-45） */
  num?: number;
  text: string;
  answer: string;
  /** 官方解析 */
  analysis?: string;
}

export interface LongReading {
  id: string;
  level: Level;
  title: string;
  paragraphs: string[];
  statements: LongReadingStatement[];
}

// ============ 翻译 / 写作 ============
export interface TranslationItem {
  id: string;
  level: Level;
  title: string;
  prompt: string;
  reference: string;
  keywords: string[];
}

export interface WritingItem {
  id: string;
  level: Level;
  title: string;
  prompt: string;
  requirements: string[];
  sample: string;
}

// ============ 听力 ============
export interface ListeningQuestion {
  id: string;
  /** 原始题号（内置题库携带，如 1-25） */
  num?: number;
  question: string;
  options: string[];
  answer: string;
  analysis: string;
}

export interface ListeningSet {
  id: string;
  level: Level;
  title: string;
  type: string;
  transcript: string;
  /** 内置真题音频（public/audio/ 下的 mp3），无则用系统朗读 */
  audioUrl?: string;
  questions: ListeningQuestion[];
}

export type PracticeType =
  | 'banked'
  | 'longreading'
  | 'reading'
  | 'translation'
  | 'writing';

// ============ 整卷试卷 ============
/** 一道题（听力/阅读通用）。options 是「字母 → 文本」映射，选项译文同理 */
export interface PaperQuestion {
  num: number;
  /** 题干（阅读为问题，听力为空——听力只看选项） */
  stem: string;
  /** 题干中文 */
  stemCn: string;
  /** 英文选项，键为 A-O */
  options: Record<string, string>;
  /** 选项中文译文 */
  optionCn: Record<string, string>;
  /** 正确答案字母 */
  answer: string;
  /** 官方解析正文 */
  analysis: string;
}

/** 一「组」题：听力的一段材料 / 阅读的一篇文章 / 写作一题 */
export interface PaperBlock {
  id: string;
  /** Section A / 短文写作 … */
  group: string;
  /** 短新闻 / 长对话 / 选词填空 … */
  groupCn: string;
  /** News Report One / Passage One / Banked Cloze … */
  label: string;
  /** 「Questions 1 and 2 are based on …」（听力独有） */
  intro?: string;
  /** 听力原文 / 阅读篇章原文 */
  material?: string;
  /** 阅读：题型概览 */
  analysisOverview?: string;
  /** 阅读：篇章中文全文翻译 */
  translationCn?: string;
  /** 选词填空：字母 → 词 */
  wordBank?: Record<string, string>;
  /** 写作/翻译：题目要求 */
  prompt?: string;
  /** 写作：审题 */
  review?: string;
  /** 翻译：难词译注 */
  terms?: string[];
  /** 翻译：参考译文 */
  reference?: string;
  /** 翻译：译点精析 */
  notes?: string;
  /** 写作：参考范文 */
  sample?: string;
  /** 写作：范文点评 */
  sampleNote?: string;
  /** 写作：范文译文 */
  sampleCn?: string;
  /** 写作：亮点词汇 */
  vocab?: string[];
  /** 写作：写作句型 */
  patterns?: string[];
  questions: PaperQuestion[];
}

/** 一个 Part */
export interface PaperSection {
  partNo: string;
  partName: string;
  partNameEn: string;
  score: number;
  minutes: number;
  blocks: PaperBlock[];
  /** 听力完整音频（一份，public/audio/papers/ 下由分段 A/B/C 拼接），仅 Part II 有 */
  audioUrl?: string;
  /** 听力来源标记（第3套卷从第1/2套导入的 variant 携带，如「第1套」；同一 partNo 的多个 variant 随机显示一个） */
  sourceSet?: string;
}

/** 一整份试卷 */
export interface Paper {
  id: string;
  level: Level;
  year: number;
  month: number;
  setNo: string;
  title: string;
  minutes: number;
  sections: PaperSection[];
}

// ============ 错题本 ============
export type MistakeSourceType = 'exam' | 'practice' | 'quiz';
export type MistakeKind = 'reading' | 'banked' | 'longreading' | 'listening' | 'vocabulary';

export interface MistakeItem {
  id: string;
  sourceType: MistakeSourceType;
  sourceId: string;
  sourceTitle: string;
  kind: MistakeKind;
  questionId: string;
  question: string;
  options?: string[];
  yourAnswer?: string;
  correctAnswer: string;
  /** 解析快照（官方解析 / 题目解析） */
  analysis?: string;
  /** 相关原文快照（用于原文依据跳转） */
  passage?: string;
  passageTitle?: string;
  addedAt: number;
  mastered: boolean;
}
