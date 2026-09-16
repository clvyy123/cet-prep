/**
 * 直接走 API：登录 → 列表 → 整卷内容（答案模式）
 *   node scripts/ec-api.mjs <user> <pass> <outDir>
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [USER, PASS, outDir] = process.argv.slice(2);
const API = 'https://admin.examcrafts.com/api';
mkdirSync(outDir, { recursive: true });

const j = async (url, opts = {}) => {
  const r = await fetch(url, opts);
  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch { d = t.slice(0, 200); }
  return { status: r.status, d };
};

const login = await j(`${API}/auth/login/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
});
console.log('login:', login.status, JSON.stringify(login.d).slice(0, 200));
const tok = login.d?.access || login.d?.data?.access || login.d?.token;
if (!tok) process.exit(1);
const H = { Authorization: `Bearer ${tok}` };

// 列表：扫全部 年份 × 月份
const cards = [];
for (const subject of ['CET4', 'CET6']) {
  for (const year of [2026, 2025, 2024, 2023, 2022, 2021, 2020]) {
    for (const month of [6, 12, 3, 9, 8]) {
      const r = await j(`${API}/exams/exam-cards/?subject=${subject}&year=${year}&month=${month}`, { headers: H });
      if (Array.isArray(r.d) && r.d.length) cards.push(...r.d);
      else if (r.d?.results?.length) cards.push(...r.d.results);
    }
  }
}
console.log('cards:', cards.length);
writeFileSync(join(outDir, '_cards.json'), JSON.stringify(cards, null, 1));

// 第一套内容试抓：encrypt=false
const first = cards[0];
console.log('first card:', JSON.stringify(first).slice(0, 300));
const c1 = await j(`${API}/exams/cet/cet-content/${first.id}/?mode=answer&encrypt=false`, { headers: H });
console.log('content(false):', c1.status, JSON.stringify(c1.d).slice(0, 400));
if (c1.status === 200) {
  writeFileSync(join(outDir, `content-${first.id}.json`), JSON.stringify(c1.d, null, 1));
} else {
  const c2 = await j(`${API}/exams/cet/cet-content/${first.id}/?mode=answer&encrypt=true`, { headers: H });
  console.log('content(true):', c2.status, JSON.stringify(c2.d).slice(0, 300));
}
