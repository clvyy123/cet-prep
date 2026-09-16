/**
 * 下载 examcrafts 各套听力音频（Section A/B/C各一个 mp3）→ public/audio/papers/<本地id>-{A,B,C}.mp3
 *   node scripts/download-ec-audio.mjs
 *
 * media 文件无需鉴权；已存在的文件跳过，可反复跑。缺失的站点数据补抓后重跑即可。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API_DIR = '.qa/ec/api';
const OUT_DIR = 'public/audio/papers';
mkdirSync(OUT_DIR, { recursive: true });

const strip = (k) => k.replace(/^[a-z]{2,5}_(?=[a-zA-Z])/, '');
const fields = (o) =>
  Object.entries(o || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => [strip(k), v]);
const getF = (o, name) => fields(o).find(([n]) => n === name)?.[1];

const CN_NUM = { 一: '1', 二: '2', 三: '3', 四: '4' };
const cardToId = (c) => {
  const m = /^(2026|2025|2024|2023|2022|2021|2020)年(\d{1,2})月(四|六)级真题第(.+?)套/.exec(c.title);
  if (!m) return null;
  return `cet${m[3] === '四' ? 4 : 6}-${m[1]}_${String(m[2]).padStart(2, '0')}_${CN_NUM[m[4]] ?? m[4]}`;
};

const cards = JSON.parse(readFileSync(join(API_DIR, '_cards.json'), 'utf8'));
const jobs = [];
for (const c of cards) {
  const localId = cardToId(c);
  const file = join(API_DIR, `ec-${c.id}.json`);
  if (!localId || !existsSync(file)) continue;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const urls = getF(data, 'audio_urls');
  if (!urls) continue;
  for (const [sec, url] of fields(urls)) {
    if (!/^Section [ABC]$/.test(sec) || typeof url !== 'string' || !url.startsWith('http')) continue;
    jobs.push({ localId, letter: sec.slice(-1), url });
  }
}
console.log('音频任务:', jobs.length);

const manifestPath = join(API_DIR, 'audio-manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
let ok = 0;
let skip = 0;
let fail = 0;
for (const j of jobs) {
  const dest = join(OUT_DIR, `${j.localId}-${j.letter}.mp3`);
  manifest[`${j.localId}-${j.letter}`] = j.url;
  if (existsSync(dest) && existsSync(dest + '.ok')) {
    skip++;
    continue;
  }
  try {
    const r = await fetch(j.url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 10000) throw new Error('too small: ' + buf.length);
    writeFileSync(dest, buf);
    writeFileSync(dest + '.ok', String(buf.length));
    ok++;
    console.log('  ✓', `${j.localId}-${j.letter}`, (buf.length / 1024 / 1024).toFixed(1) + 'MB');
  } catch (e) {
    fail++;
    console.log('  ✗', `${j.localId}-${j.letter}`, String(e.message).slice(0, 80));
  }
  await new Promise((r) => setTimeout(r, 800));
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`完成：新下 ${ok}，已有 ${skip}，失败 ${fail}`);
console.log('本地音频文件数:', readdirSync(OUT_DIR).filter((f) => f.endsWith('.mp3')).length);
