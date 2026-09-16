// 导入真题听力音频：
// 1) 把桌面 C:\Users\yy\Desktop\CET4资料\听力\{四级,六级}\*.mp3 复制到 public/audio/，
//    并按套卷 key 重命名（如 四级_2021年6月 第1套_听力.mp3 -> cet4-2021_06_1.mp3）
// 2) 生成 src/data/listening-audio.ts（内置音频 key 清单，供代码匹配 audioUrl）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = 'C:/Users/yy/Desktop/CET4资料/听力';
const audioDir = path.join(root, 'public', 'audio');

const levelMap = { 四: 'cet4', 六: 'cet6' };
const keys = [];

fs.mkdirSync(audioDir, { recursive: true });

for (const sub of ['四级', '六级']) {
  const dir = path.join(srcDir, sub);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mp3'))) {
    const m = f.match(/^([四六])级_(\d{4})年(\d{1,2})月 第(\d)套_听力\.mp3$/);
    if (!m) {
      console.warn('跳过无法识别的文件:', f);
      continue;
    }
    const level = levelMap[m[1]];
    const mm = String(Number(m[3])).padStart(2, '0');
    const key = `${level}-${m[2]}_${mm}_${m[4]}`;
    fs.copyFileSync(path.join(dir, f), path.join(audioDir, `${key}.mp3`));
    keys.push(key);
    console.log(`${f}  ->  ${key}.mp3`);
  }
}

keys.sort();
const ts = `/** 已内置真题音频的听力套卷 key（对应 public/audio/{key}.mp3），自动生成，勿手改 */
import type { ListeningSet } from '../types';

export const AUDIO_KEYS: string[] = [
${keys.map((k) => `  '${k}',`).join('\n')}
];

/** 若该听力套卷有内置真题音频，则补充 audioUrl（无音频时回退系统朗读） */
export function withAudio(set: ListeningSet): ListeningSet {
  const m = set.id.match(/^bi-(cet[46]-\\d{4}_\\d{2}_\\d)-lst-2$/);
  if (m && AUDIO_KEYS.includes(m[1])) return { ...set, audioUrl: \`/audio/\${m[1]}.mp3\` };
  return set;
}
`;
fs.writeFileSync(path.join(root, 'src', 'data', 'listening-audio.ts'), ts, 'utf8');
console.log(`\n共导入 ${keys.length} 个音频，清单已写入 src/data/listening-audio.ts`);
