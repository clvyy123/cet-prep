/** 已内置真题音频的听力套卷 key（对应 public/audio/{key}.mp3），自动生成，勿手改 */
import type { ListeningSet } from '../types';

export const AUDIO_KEYS: string[] = [
  'cet4-2021_06_1',
  'cet4-2021_06_2',
  'cet4-2021_12_1',
  'cet4-2021_12_2',
  'cet4-2022_06_1',
  'cet4-2022_09_1',
  'cet4-2022_12_1',
  'cet4-2022_12_2',
  'cet4-2023_03_1',
  'cet4-2023_06_1',
  'cet4-2023_06_2',
  'cet4-2023_12_1',
  'cet4-2023_12_2',
  'cet4-2024_06_1',
  'cet4-2024_06_2',
  'cet4-2024_12_1',
  'cet4-2024_12_2',
  'cet4-2025_06_1',
  'cet4-2025_06_2',
  'cet4-2025_12_1',
  'cet4-2025_12_2',
  'cet6-2021_06_1',
  'cet6-2021_06_2',
  'cet6-2021_12_1',
  'cet6-2021_12_2',
  'cet6-2022_06_1',
  'cet6-2022_09_1',
  'cet6-2022_12_1',
  'cet6-2022_12_2',
  'cet6-2023_03_1',
  'cet6-2023_06_1',
  'cet6-2023_06_2',
  'cet6-2023_12_1',
  'cet6-2023_12_2',
  'cet6-2024_06_1',
  'cet6-2024_06_2',
  'cet6-2024_12_1',
  'cet6-2024_12_2',
  'cet6-2025_06_1',
  'cet6-2025_06_2',
  'cet6-2025_12_1',
  'cet6-2025_12_2',
];

/** 若该听力套卷有内置真题音频，则补充 audioUrl（无音频时回退系统朗读） */
export function withAudio(set: ListeningSet): ListeningSet {
  const m = set.id.match(/^bi-(cet[46]-\d{4}_\d{2}_\d)-lst-2$/);
  if (m && AUDIO_KEYS.includes(m[1])) return { ...set, audioUrl: `/audio/${m[1]}.mp3` };
  return set;
}
