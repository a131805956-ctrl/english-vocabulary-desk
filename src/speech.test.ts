import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEECH_VOLUME,
  normalizeSpeechVolume,
  speechToggleLabel,
} from './speech';

describe('speech settings', () => {
  it('uses the maximum supported volume by default and clamps slider values', () => {
    expect(DEFAULT_SPEECH_VOLUME).toBe(1);
    expect(normalizeSpeechVolume(0)).toBe(0.1);
    expect(normalizeSpeechVolume(0.65)).toBe(0.65);
    expect(normalizeSpeechVolume(2)).toBe(1);
    expect(normalizeSpeechVolume('not-a-number')).toBe(1);
  });

  it('labels the top-right control as a mute toggle', () => {
    expect(speechToggleLabel(false)).toBe('關閉自動發音');
    expect(speechToggleLabel(true)).toBe('開啟自動發音');
  });
});
