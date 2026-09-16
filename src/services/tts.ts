import { getSettings } from './storage';

let voices: SpeechSynthesisVoice[] = [];
let voicesLoaded = false;

function refreshVoices(): void {
  if (typeof speechSynthesis === 'undefined') return;
  voices = speechSynthesis.getVoices();
  voicesLoaded = true;
}

if (typeof window !== 'undefined' && typeof speechSynthesis !== 'undefined') {
  refreshVoices();
  speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

export function getVoices(): SpeechSynthesisVoice[] {
  if (!voicesLoaded) refreshVoices();
  return voices;
}

export function pickVoice(): SpeechSynthesisVoice | null {
  const setting = getSettings().ttsVoice;
  const list = getVoices();
  if (!list.length) return null;
  const preferred = setting
    ? list.find((v) => v.name === setting)
    : undefined;
  if (preferred) return preferred;
  // 优先英文语音
  const en = list.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return (
    en.find((v) => v.localService) ??
    en[0] ??
    list.find((v) => v.localService) ??
    list[0] ??
    null
  );
}

export function speak(text: string, opts?: { rate?: number; onEnd?: () => void }): void {
  if (typeof speechSynthesis === 'undefined' || !text.trim()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'en-US';
  u.rate = opts?.rate ?? getSettings().ttsRate;
  u.pitch = 1;
  u.onend = () => opts?.onEnd?.();
  speechSynthesis.speak(u);
}

export function stopSpeak(): void {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
