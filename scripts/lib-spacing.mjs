/**
 * 英文空格修复：修正 OCR 造成的「词间空格被吞」与「词内多余空格」。
 *
 * 判定策略：用 61 套真题全文自建词频表 + 内置 CET 词表作为词典。
 * 一个长 token 只有在「词典里没有它、且能切成两个以上词典词」时才拆；
 * handbook / workplace / everything 这类真词与真复合词在语料里反复出现，会自然跳过。
 */
import fs from 'node:fs';

let freq = new Map();
let cetWords = new Set();
/** 高频词（语料中出现 ≥40 次）：判定「长串里确实夹着常用词」的依据 */
let core = new Set();
let ready = false;

/** 不构成独立单词的常见后缀，防止把 shouting 切成 shout + ing */
const NON_WORD = new Set(
  `ing ed er es est ly tion sion ness ment able ible ful less ous ive ant ent ance ence ity ize ise ism ist age ence al ic ical ate ute ude ile ine ise ous ure age ade ode ude`
    .split(/\s+/)
    .filter(Boolean)
);

/** 缩写，后面不补空格 */
const ABBR = new Set(['e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'no', 'fig', 'prof']);

/** 姓名前缀，McDonald / MacArthur 不该被切开 */
const NAME_PREFIX = /^(mc|mac|van|von|de|del|la|le|el|al|bin|ibn)$/i;

export function buildVocab(PAPERS) {
  const texts = [];
  const walk = (v) => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(PAPERS);

  freq = new Map();
  for (const s of texts) {
    for (const m of s.matchAll(/[A-Za-z][a-z]{1,20}(?:['’][a-z]{1,4})?/g)) {
      const w = m[0].toLowerCase();
      if (w.length < 2) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  cetWords = new Set();
  for (const f of ['cet4', 'cet6', 'toefl', 'kaoyan', 'senior', 'junior', 'sat']) {
    const p = `src/data/words/${f}.ts`;
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/word:'([^']+)'/g)) cetWords.add(m[1].toLowerCase().replace(/[^a-z]/g, ''));
  }
  core = new Set([...freq.entries()].filter(([, n]) => n >= 40).map(([w]) => w));
  ready = true;
  return { size: freq.size, cet: cetWords.size, core: core.size };
}

const isWord = (w) => {
  if (!ready) throw new Error('请先调用 buildVocab()');
  if (NON_WORD.has(w) || w.length < 2) return false;
  return (freq.get(w) || 0) >= 2 || cetWords.has(w);
};

/** 允许作为切分结果的双字母虚词（of/to/in/is/it…）；其余 2 字母片段一律不接受，
 *  否则 con+firms、co+mp+rising 这类误切会大量出现 */
const FUNC2 = new Set(
  `of to in is it as at be by do go he me my no on or so up us we an if am ax ok pi tv`
    .split(/\s+/)
    .filter(Boolean)
);

/** 词形还原：确认/确认s、admitting→admit、percentages→percentage 都算「认识这个词」 */
function* variants(w) {
  yield w;
  const L = w.length;
  if (L > 4 && w.endsWith('ies')) yield w.slice(0, -3) + 'y';
  if (L > 3 && w.endsWith('es')) yield w.slice(0, -2);
  if (L > 3 && w.endsWith('s') && !w.endsWith('ss')) yield w.slice(0, -1);
  if (L > 4 && w.endsWith('ed')) {
    yield w.slice(0, -2);
    yield w.slice(0, -1);
    yield w.slice(0, -2) + 'e';
  }
  if (L > 4 && w.endsWith('ing')) {
    const b = w.slice(0, -3);
    yield b;
    yield b + 'e';
    yield b.slice(0, -1);
  }
  if (L > 4 && w.endsWith('ly')) yield w.slice(0, -2);
  if (L > 4 && w.endsWith('er')) {
    yield w.slice(0, -2);
    yield w.slice(0, -1);
    yield w.slice(0, -2) + 'e';
  }
  if (L > 4 && w.endsWith('est')) {
    yield w.slice(0, -3);
    yield w.slice(0, -3) + 'e';
  }
  if (L > 5 && w.endsWith('ness')) yield w.slice(0, -4);
}

/** 词典是否认识这个词（含屈折变化） */
const isKnown = (w) => {
  for (const v of variants(w)) if ((freq.get(v) || 0) >= 2 || cetWords.has(v)) return true;
  return false;
};

/** 能否作为切分出来的一节 */
const isPart = (w) => isKnown(w) && (w.length >= 3 || FUNC2.has(w));

/** OCR 高频粘连垃圾：绝不允许作为切分结果 */
const GLUE_JUNK = new Set(
  `ofthe tothe inthe andthe ofa isa ofthe atthe onthe forthe thatthe withthe willbe thereis itis andof ofhis ofher tobe
tohave hasbeen havebeen thisis theseare thereare becauseof outof intothe andto andin andfor isnot cannot alot aswell
ofits ofour oftheir onits inits atits andits forits asa atof itto andthe ofan ina ona ata fora witha toa isthe arethe`
    .split(/\s+/)
    .filter(Boolean)
);

/**
 * 切分出来的一节必须「像词」：
 * 在 CET 词表 / 高频词表里，或语料里足够常见，或词形还原后词干够硬。
 * willbe(7)、lyprone(3)、fromall(3) 这类 OCR 垃圾会被挡掉。
 */
function isPartStrict(w) {
  if (GLUE_JUNK.has(w) || NON_WORD.has(w)) return false;
  if (cetWords.has(w) || core.has(w) || FUNC2.has(w)) return true;
  if ((freq.get(w) || 0) >= 8) return true;
  for (const v of variants(w)) if (v !== w && (cetWords.has(v) || core.has(v))) return true;
  return false;
}

/**
 * 长串切分：只处理「一眼就能看出是整串粘死」的情况。
 * 判据：≥12 个字母、词典整体不认识、切出来的每一节都必须是「像词」的，
 * 且至少夹着两个高频词（the / of / will …）。
 * readiness、footwear、snapshots 这类短词和真复合词都够不到这条线。
 */
function splitGlued(token) {
  const low = token.toLowerCase();
  if (!/^[a-z]+$/.test(low) || low.length < 12 || low.length > 30) return null;
  if (isKnown(low)) return null; // 认识它（含屈折）就别动
  const n = low.length;
  const best = new Array(n + 1).fill(null);
  best[0] = { parts: [], score: 0 };
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 20); j < i; j++) {
      if (!best[j]) continue;
      const part = low.slice(j, i);
      if (part.length < 2 || !isPartStrict(part)) continue;
      const parts = best[j].parts.concat(part);
      if (parts.length > 6) continue;
      const score = best[j].score + (freq.get(part) || 1);
      const cur = best[i];
      if (!cur || parts.length < cur.parts.length || (parts.length === cur.parts.length && score > cur.score))
        best[i] = { parts, score };
    }
  }
  const PREFIX2 = new Set(
    `under over out up inter trans counter super anti semi multi non pre post sub un re de dis mis im ir il micro macro`
      .split(/\s+/)
      .filter(Boolean)
  );
  if (!best[n]) return null;
  const parts = best[n].parts;
  if (parts.length < 2) return null;
  const coreHits = parts.filter((p) => core.has(p)).length;
  if (coreHits < 2) return null; // 至少两个高频词，才敢认定是粘死的长串
  if (parts.length === 2 && PREFIX2.has(parts[0])) return null; // 前缀 + 词 = 真词，不拆
  // 还原首字母大小写
  const out = parts.slice();
  if (/^[A-Z]/.test(token)) out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return out;
}

/** 对纯英文片段做空格修复（中文字符天然是边界，不会误伤） */
export function fixEnSpacing(input) {
  if (!ready) throw new Error('请先调用 buildVocab()');
  let s = String(input == null ? '' : input);

  // ① 多余空白（保留换行，只压空格/制表）
  s = s.replace(/[ \t]{2,}/g, ' ');

  // ② 标点前多余空格
  s = s.replace(/\s+([,.;:!?])/g, '$1');

  // ③ 标点后缺空格（缩写除外）
  s = s.replace(/([,;:])(?=[A-Za-z])/g, '$1 ');
  s = s.replace(/([a-zA-Z]{1,8})([.!?])(?=[A-Z][a-z])/g, (m, a, p) => (ABBR.has(a.toLowerCase()) ? m : `${a}${p} `));
  s = s.replace(/([)\]}])(?=[A-Za-z])/g, '$1 ');
  s = s.replace(/(\d)(?=[A-Z][a-z]{2,})/g, '$1 '); // [19Branyas / 7Mile
  s = s.replace(/[''’](s)(?=[A-Z][a-z])/g, "'$1 "); // worth'sGrit

  // ④ 所有格 / 缩写后面被吞掉的空格：students'access / don'tneed / it'srewarding
  s = s.replace(/([A-Za-z])s[''’](?=[a-z]{2,})/g, "$1s' ");
  s = s.replace(/[''’](s|t|re|ve|ll|m|d)(?=[a-z]{2,})/g, "'$1 ");

  // ⑤ 小写→大写边界，可能有多处：plaguingKolkata / TrentUniversity / SpecialOlympicSpringGames
  for (let pass = 0; pass < 4; pass++) {
    const next = s.replace(/([a-z]{2})([A-Z][a-z]{2,})/g, (m, a, b) => (NAME_PREFIX.test(a) ? m : `${a} ${b}`));
    if (next === s) break;
    s = next;
  }

  // ⑥ 词间空格被吞的长串：thefridgewillspoilyourday
  s = s.replace(/\b[A-Za-z]{8,28}\b/g, (w) => {
    if (/[A-Z]/.test(w.slice(1))) return w; // 含内部大写，交给 ⑤，不猜
    const parts = splitGlued(w);
    return parts ? parts.join(' ') : w;
  });

  // ⑦ 收尾
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
  return s;
}

/** 调试用：查看词典状态 */
export const _dict = () => ({ freq, cetWords, ready });

/**
 * 供审计脚本复用：返回该 token 是否「确定是粘死的长串」。
 * 与 fixEnSpacing 用的是同一套判据，所以审计口径 == 修复口径。
 * 注意：调用前必须先 buildVocab(...) 灌词典，否则 isPartStrict 恒假、结果全是 null。
 */
export { splitGlued as _splitGlued };
