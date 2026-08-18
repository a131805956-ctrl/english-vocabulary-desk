export const DEFAULT_SPEECH_VOLUME = 1;
export const AUTO_SPEAK_DELAY_MS = 900;

export function normalizeSpeechVolume(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SPEECH_VOLUME;
  return Math.min(1, Math.max(0.1, numeric));
}

export function speechToggleLabel(muted: boolean): string {
  return muted ? '開啟自動發音' : '關閉自動發音';
}
