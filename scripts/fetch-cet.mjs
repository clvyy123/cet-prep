// 批量下载脚本：从 cettong.cn 索引页自动提取全部套题，并发下载 真题 PDF + 答案解析 PDF
// 用法：node scripts/fetch-cet.mjs [--level cet4|cet6] [--min-year 2021] [--limit N] [--mp3] [--force]
//   --level     只下载 cet4 或 cet6
//   --min-year  只下载 key 中年份 >= min-year 的套卷（如 2021 → 2021-2025）
//   --limit N   只下载前 N 套（按索引页顺序）
//   --mp3       额外下载听力 MP3（默认不下载，听力用 TTS 朗读）
//   --force     覆盖已存在的文件
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('scripts/.download');
const CONCURRENCY = 6; // 并发下载数
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const LEVEL = arg('--level');
const MIN_YEAR = arg('--min-year') ? parseInt(arg('--min-year'), 10) : null;
const LIMIT = arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity;
const WITH_MP3 = args.includes('--mp3');
const FORCE = args.includes('--force');

// ---------- 从索引页提取套题清单 ----------
async function listSets(level) {
  const url = `http://www.cettong.cn/library/cet${level}`;
  console.log(`抓取索引页 ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`索引页 HTTP ${res.status}`);
  const html = await res.text();
  const seen = new Set();
  const sets = [];
  const re = /\/library\/cet[46]\/(\d{4}_\d{2}_[\d-]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      sets.push({ level, key });
    }
  }
  return sets;
}

// ---------- 并发下载 ----------
async function downloadFile(f, name) {
  const dir = path.join(OUT_DIR, `cet${f.level}`, f.key);
  const out = path.join(dir, name);
  const url = `http://www.cettong.cn/library/cet${f.level}/${f.key}/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  if (!FORCE && fs.existsSync(out) && fs.statSync(out).size > 10000) {
    return { name, ok: true, skipped: true, size: fs.statSync(out).size };
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10000) throw new Error(`文件过小 ${buf.length} bytes`);
    fs.writeFileSync(out, buf);
    console.log(`  已保存 cet${f.level}/${f.key}/${name} (${buf.length} bytes)`);
    return { name, ok: true, size: buf.length };
  } catch (e) {
    console.log(`  失败 cet${f.level}/${f.key}/${name}: ${e.message}`);
    return { name, ok: false, error: e.message };
  }
}

async function download(f) {
  const names = ['test.pdf', 'answer.pdf'];
  if (WITH_MP3) names.push('listening.mp3');
  const results = [];
  for (const n of names) results.push(await downloadFile(f, n));
  const ok = results.filter((r) => r.ok).length;
  console.log(`[cet${f.level}/${f.key}] 成功 ${ok}/${names.length}`);
  return { ...f, ok: ok > 0 };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let all = [];
  if (!LEVEL || LEVEL === 'cet4') all = all.concat(await listSets('4'));
  if (!LEVEL || LEVEL === 'cet6') all = all.concat(await listSets('6'));
  if (MIN_YEAR) all = all.filter((s) => parseInt(s.key.slice(0, 4), 10) >= MIN_YEAR);
  if (LIMIT !== Infinity) all = all.slice(0, LIMIT);
  console.log(`共 ${all.length} 套待下载\n`);

  let done = 0;
  let okCount = 0;
  const failList = [];
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const batch = all.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(download));
    for (const r of results) {
      if (r.ok) okCount++;
      else failList.push(r);
    }
    done += results.length;
    console.log(`进度 ${done}/${all.length}`);
  }
  console.log(`\n成功 ${okCount} / 失败 ${failList.length}`);
  if (failList.length) {
    console.log('失败清单:');
    for (const f of failList) console.log(`  cet${f.level}/${f.key}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
