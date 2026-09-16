/**
 * 懒笔记（english-exam.lazynote.cn）听力音频抓取：HLS（m3u8 + TS）→ 纯 JS 抽成单文件 AAC(ADTS)。
 *
 *   node scripts/lz-audio.mjs probe  cet4 2026-06-2              # 看 m3u8 地址 + 与整卷正文的相似度
 *   node scripts/lz-audio.mjs build  cet4-2026_06_2 cet4 2026-06-2   # 下载并落盘 public/audio/papers/<id>.aac
 *
 * 为什么要自己抽 TS：本机没有 ffmpeg；站点只提供 HLS，没有 mp3 直链。
 * 好在这些 TS 是「纯音频单节目流」（PAT/PMT + 一个 AAC ES），
 * 把 PID 的 PES 负载按序拼起来就是标准 ADTS 流，Chromium/Electron 可直接播（canPlayType('audio/aac')=probably）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public/audio/papers');
const CACHE = path.join(ROOT, '.qa/lazynote/audio');
const UA = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://english-exam.lazynote.cn/' };

const get = async (url) => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r;
};

/** 抓听力页 → m3u8 地址 + 页面纯文本 */
async function fetchListeningPage(level, date) {
  const url = `https://english-exam.lazynote.cn/${level}/sections/listening/${date}/`;
  const html = await (await get(url)).text();
  // astro-island 的 props 是 HTML 转义过的（&quot;），这里只认 URL 本体
  const m = /(https:\/\/listening\.lazynote\.cn\/[^"'&\s<>]*\/index\.m3u8)/.exec(html);
  if (!m) throw new Error(`听力页未找到 m3u8：${url}`);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return { url, m3u8: m[1], text };
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 词级 n-gram 覆盖率：整卷听力正文的 5-gram 有多少出现在页面里。
 *  比 Dice 更抗页面噪声（页面含大量中文/导航），同卷 ≈84%，异卷 = 0%。 */
function coverage(paper, page, n = 5) {
  const grams = (t) => {
    const w = norm(t).split(' ');
    const s = new Set();
    for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
    return s;
  };
  const A = grams(paper);
  const B = grams(page);
  if (!A.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.size;
}

/** 整卷听力原文（用于来源校验） */
function paperListeningText(paperId) {
  const raw = fs.readFileSync(path.join(ROOT, 'src/data/papers.ts'), 'utf8');
  const P = JSON.parse(raw.slice(raw.indexOf('= [') + 2, raw.lastIndexOf(']') + 1));
  const p = P.find((x) => x.id === paperId);
  if (!p) throw new Error(`papers.ts 无 ${paperId}`);
  return p.sections
    .filter((s) => s.partName === '听力理解')
    .map((s) => s.blocks.map((b) => b.material || '').join(' '))
    .join(' ');
}

// ---------------------------------------------------------------- TS → AAC

/** PAT/PMT 解析：拿到音频 ES 的 PID */
function audioPidOf(buf) {
  let pmtPid = null;
  const esPids = new Map(); // pid → stream_type
  for (let o = 0; o + 188 <= buf.length; o += 188) {
    if (buf[o] !== 0x47) break;
    const pid = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2];
    const afc = (buf[o + 3] >> 4) & 3;
    let p = o + 4;
    if (afc & 2) p += 1 + buf[o + 4]; // 有适配域：跳过长度字节 + 内容
    if (p >= o + 188) continue;
    if (pid === 0) {
      // PAT：pointer_field + section
      let i = p + 1 + buf[p];
      const len = ((buf[i + 1] & 0x0f) << 8) | buf[i + 2];
      for (let j = i + 8; j < i + 3 + len - 4; j += 4) {
        const prog = (buf[j] << 8) | buf[j + 1];
        if (prog) pmtPid = ((buf[j + 2] & 0x1f) << 8) | buf[j + 3];
      }
    } else if (pmtPid !== null && pid === pmtPid) {
      let i = p + 1 + buf[p];
      const len = ((buf[i + 1] & 0x0f) << 8) | buf[i + 2];
      const pcrPid = ((buf[i + 8] & 0x1f) << 8) | buf[i + 9];
      const pil = ((buf[i + 10] & 0x0f) << 8) | buf[i + 11];
      let j = i + 12 + pil;
      const end = i + 3 + len - 4;
      while (j < end) {
        const st = buf[j];
        const epid = ((buf[j + 1] & 0x1f) << 8) | buf[j + 2];
        const eil = ((buf[j + 3] & 0x0f) << 8) | buf[j + 4];
        esPids.set(epid, st);
        j += 5 + eil;
      }
      void pcrPid;
    }
  }
  // 优先 AAC(0x0f) / LATM(0x11) / MP3(0x03|0x04)，实在没有就取唯一 ES
  for (const want of [0x0f, 0x11, 0x03, 0x04]) {
    for (const [pid, st] of esPids) if (st === want) return pid;
  }
  if (esPids.size === 1) return [...esPids.keys()][0];
  for (const [pid, st] of esPids) if (st !== 0x0f) return pid;
  return null;
}

/** 取某一 PID 的 PES 负载并拼接（跳过 PES 头） */
function esPayloadOf(buf, pid) {
  const chunks = [];
  for (let o = 0; o + 188 <= buf.length; o += 188) {
    if (buf[o] !== 0x47) break;
    const p = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2];
    if (p !== pid) continue;
    const pusi = buf[o + 1] & 0x40;
    const afc = (buf[o + 3] >> 4) & 3;
    let s = o + 4;
    if (afc & 2) s += 1 + buf[o + 4];
    else if (afc === 0) continue;
    if (s >= o + 188) continue;
    if (pusi) {
      // PES 头：00 00 01 sid len(2) flags(2) hdrlen(1) hdr
      if (buf[s] !== 0x00 || buf[s + 1] !== 0x00 || buf[s + 2] !== 0x01) continue;
      const sid = buf[s + 3];
      if (sid === 0xbe || sid === 0xbf) continue; // padding / private_stream_2 无额外头
      s += 9 + buf[s + 8];
    }
    if (s < o + 188) chunks.push(buf.slice(s, o + 188));
  }
  return Buffer.concat(chunks);
}

/** ADTS 帧扫描：返回 {rate, channels, frames, durationSec, out} —— 顺带丢掉不对齐的碎字节 */
export function adtsScan(buf) {
  const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  let i = 0;
  let frames = 0;
  let rate = 0;
  let channels = 0;
  const start = (() => {
    for (let k = 0; k + 7 < buf.length; k++)
      if (buf[k] === 0xff && (buf[k + 1] & 0xf6) === 0xf0) return k;
    return -1;
  })();
  if (start < 0) throw new Error('未找到 ADTS 同步字');
  i = start;
  const parts = [];
  while (i + 7 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xf6) !== 0xf0) {
      // 失步：往后找下一个同步字（最多容忍 4KB）
      let k = i + 1;
      while (k < Math.min(i + 4096, buf.length - 7)) {
        if (buf[k] === 0xff && (buf[k + 1] & 0xf6) === 0xf0) break;
        k++;
      }
      if (k >= Math.min(i + 4096, buf.length - 7)) break;
      i = k;
      continue;
    }
    const len = ((buf[i + 3] & 0x03) << 11) | (buf[i + 4] << 3) | ((buf[i + 5] & 0xe0) >> 5);
    if (len < 8 || i + len > buf.length) break;
    if (!rate) {
      const idx = (buf[i + 2] >> 2) & 0x0f;
      rate = RATES[idx] || 0;
      channels = ((buf[i + 2] & 0x01) << 2) | ((buf[i + 3] & 0xc0) >> 6);
    }
    parts.push(buf.slice(i, i + len));
    frames++;
    i += len;
  }
  return { rate, channels, frames, durationSec: rate ? (frames * 1024) / rate : 0, out: Buffer.concat(parts) };
}

async function fetchM3u8(m3u8) {
  const base = m3u8.replace(/[^/]*$/, '');
  const text = await (await get(m3u8)).text();
  const segs = [...text.matchAll(/^([^#\s].*\.ts)\s*$/gm)].map((m) => m[1]);
  if (!segs.length) throw new Error('m3u8 无 TS 分段');
  const dir = path.join(CACHE, path.basename(base.replace(/\/$/, '')));
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (let n = 0; n < segs.length; n++) {
    const f = path.join(dir, segs[n].replace(/[\\/]/g, '_'));
    files.push(f);
    if (fs.existsSync(f) && fs.statSync(f).size > 1000) continue;
    const b = Buffer.from(await (await get(base + segs[n])).arrayBuffer());
    fs.writeFileSync(f, b);
    if (n % 20 === 0) process.stdout.write(`\r  分段 ${n + 1}/${segs.length}`);
  }
  process.stdout.write(`\r  分段 ${segs.length}/${segs.length} 已缓存\n`);
  return files;
}

export async function buildLzAudio(paperId, level, date, outOverride) {
  const page = await fetchListeningPage(level, date);
  const paper = paperListeningText(paperId);
  const sim = coverage(paper, page.text) * 100;
  console.log(`  听力页 ${page.url}`);
  console.log(`  m3u8   ${page.m3u8}`);
  console.log(`  与 ${paperId} 听力正文 5-gram 覆盖率 ${sim.toFixed(0)}%（<60% 视为不是同一份卷）`);
  if (sim < 60) throw new Error(`来源核验不通过，拒绝落盘：覆盖率 ${sim.toFixed(0)}%`);

  const files = await fetchM3u8(page.m3u8);
  // 每个分段各自解析 ES，再整体做一次 ADTS 扫描（跨分段帧由拼接自动接续）
  const raw = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const pid = audioPidOf(buf);
    if (pid === null) throw new Error(`分段无音频 ES：${path.basename(f)}`);
    raw.push(esPayloadOf(buf, pid));
  }
  const { rate, channels, frames, durationSec, out } = adtsScan(Buffer.concat(raw));
  const dest = outOverride ? path.resolve(ROOT, outOverride) : path.join(OUT_DIR, `${paperId}.aac`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  console.log(
    `  ✓ ${path.relative(ROOT, dest)}  ${(out.length / 1048576).toFixed(1)}MB · ${frames} 帧 · ${rate}Hz ${channels}ch · ${(durationSec / 60).toFixed(1)} 分钟`
  );
  return durationSec;
}

// ------------------------------------------------ CLI（被 import 时不执行）
const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  if (cmd === 'probe') {
    const page = await fetchListeningPage(a, b);
    console.log(page.url);
    console.log(page.m3u8);
  } else if (cmd === 'build') {
    await buildLzAudio(a, b, c, d);
  } else {
    console.log('用法: node scripts/lz-audio.mjs probe <cet4|cet6> <yyyy-mm-set>');
    console.log('      node scripts/lz-audio.mjs build <paperId> <cet4|cet6> <yyyy-mm-set> [输出路径]');
  }
}
