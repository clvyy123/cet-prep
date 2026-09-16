// 通用验证：网络"正确答案文本" → 本地选项字母
// 输入：bankId + {题号: 答案文本关键词}
import fs from 'node:fs';

const src = fs.readFileSync('src/data/builtin-banks.ts', 'utf8');
const arrStart = src.indexOf('[', src.indexOf('BUILTIN_BANKS'));
const arrEnd = src.lastIndexOf('];');
const banks = eval(src.slice(arrStart, arrEnd + 1));

function verify(bankId, section, web) {
  const bank = banks.find(b => b.meta.id === bankId);
  if (!bank) { console.log(bankId + ' 未找到'); return; }
  const items = section === 'listening' ? bank.listening[0].questions
    : section === 'reading' ? bank.reading.flatMap(r => r.questions)
    : bank.long.flatMap(l => l.questions);
  console.log(`\n===== ${bankId} (${section}) =====`);
  for (const [numStr, kw] of Object.entries(web)) {
    const n = Number(numStr);
    const q = items.find(x => x.num === n);
    if (!q) { console.log(`Q${n}: 本地无此题`); continue; }
    const k = kw.toLowerCase().replace(/[’']/g, "'");
    let hit = '', hitOpt = '';
    for (let i = 0; i < q.options.length; i++) {
      const opt = (q.options[i] || '').toLowerCase().replace(/[’']/g, "'");
      if (opt.includes(k)) { hit = 'ABCD'[i]; hitOpt = q.options[i]; break; }
    }
    const local = q.answer || '(空)';
    const ok = hit && hit === local ? '✓一致' : (hit ? `✗本地=${local} 应=${hit}` : '?未匹配');
    console.log(`Q${String(n).padStart(2)}: ${ok}${hit ? ` | 文本:「${hitOpt.slice(0, 50)}」` : ` | 关键词「${kw}」未在本地选项找到`}`);
  }
}

// 2022_12_1 听力（bilibili 23767406 原文答案）
verify('bi-cet4-2022_12_1', 'listening', {
  1: 'Part of its dam wall collapsed', 2: 'brought the mine',
  3: 'team of doctors for each expected baby', 4: 'stay in the hospital',
  5: 'perfect tourist destination', 6: 'unspoiled beaches',
  7: 'unmatched location', 8: 'member of the gym two months ago',
  9: 'discount off two new classes', 10: 'general discount',
  11: 'card details over the phone', 12: 'research new markets',
  13: 'Dubai', 14: 'map of the hotel area',
  15: 'Keep all his receipts', 16: 'protection of women',
  17: 'better health if women', 18: 'positive effect on economic development',
  19: 'strange physical reactions', 20: 'Bad breath',
  21: 'extra energy', 22: 'win in combat sports',
  23: 'stronger connection', 24: 'still remains unknown',
  25: 'fast-paced interactive sports',
});

// 2022_12_2 听力（bilibili cv20415170）
verify('bi-cet4-2022_12_2', 'listening', {
  1: 'pipe band contest', 2: 'local economy',
  3: 'Dangerous ice melts', 4: 'started a month earlier',
  5: 'Bundles of 20 pounds notes', 6: 'return it to the finder',
  7: 'strong community spirit', 8: 'Strange',
  9: 'Search for the meaning', 10: 'celebrating others',
  11: 'socialize and have fun', 12: 'absolutely exhausting',
  13: 'saved enough money', 14: 'dangerous',
  15: 'sharing a ride', 16: 'deaf person working in',
  17: 'Speech recognition technology', 18: 'speakers',
  19: 'cheerful colors', 20: 'fashionable',
  21: 'wooden frameworks and walls the same color', 22: 'Reading to their children is important',
  23: 'quality of books parents read', 24: 'specifically labeled',
  25: 'Choose carefully',
});

// cet6-2021_06_1 听力（沪江）
verify('bi-cet6-2021_06_1', 'listening', {
  1: 'leave his present job', 2: 'useful to senior managers',
  3: 'adversely affect his future career', 4: 'rate-your-employer',
  5: 'latest documentary', 6: 'endure many hardships',
  7: 'hurricane was coming', 8: 'fruitful',
  9: "diminishes laymen", 10: 'disbelieve the actual science',
  11: 'Do away with jargon', 12: 'oil deposits below',
  13: 'sand under the hill', 14: 'gave birth to the oil drilling',
  15: 'oil surplus', 16: 'Bad managers',
  17: 'Toxic company culture', 18: 'perspective of employees',
  19: 'automation revolution', 20: 'new Jobs',
  21: 'reservations', 22: 'twice that of the global average',
  23: "reflect the changes", 24: 'decline in road-death',
  25: 'driving behavior',
});
