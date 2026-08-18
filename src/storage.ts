import { DEFAULT_SPEECH_VOLUME, normalizeSpeechVolume } from './speech';
import type { AppPreferences, StudyResumeSnapshot, StudySession } from './types';

const STORAGE_KEY = 'morphemeDesk:preferences:v1';
const STUDY_RESUME_KEY = 'morphemeDesk:study-resume:v1';

export const DEFAULT_PREFERENCES: AppPreferences = {
  rangeIds: ['all'],
  order: 'source',
  limit: 40,
  mode: 'today',
  newLimit: 20,
  speechMuted: false,
  speechVolume: DEFAULT_SPEECH_VOLUME,
  ai: {
    provider: 'auto',
    baseUrl: 'http://127.0.0.1:11434',
    model: '',
  },
};

function isPreferenceShape(value: unknown): value is Partial<AppPreferences> {
  return typeof value === 'object' && value !== null;
}

export function loadPreferences(): AppPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (!isPreferenceShape(parsed)) return DEFAULT_PREFERENCES;

    const rangeIds = Array.isArray(parsed.rangeIds)
      ? parsed.rangeIds.filter((item): item is string => typeof item === 'string')
      : DEFAULT_PREFERENCES.rangeIds;
    const limit = parsed.limit === null || [20, 40, 80].includes(parsed.limit ?? -1)
      ? parsed.limit ?? null
      : DEFAULT_PREFERENCES.limit;

    return {
      rangeIds: rangeIds.length > 0 ? rangeIds : DEFAULT_PREFERENCES.rangeIds,
      order: parsed.order === 'shuffle' ? 'shuffle' : 'source',
      limit,
      mode: parsed.mode === 'manual' ? 'manual' : 'today',
      newLimit: [0, 10, 20, 40, 80].includes(parsed.newLimit ?? -1)
        ? parsed.newLimit ?? DEFAULT_PREFERENCES.newLimit
        : DEFAULT_PREFERENCES.newLimit,
      speechMuted: parsed.speechMuted === true,
      speechVolume: normalizeSpeechVolume(parsed.speechVolume),
      ai: {
        provider: parsed.ai?.provider === 'hermes' ? 'hermes' : 'auto',
        baseUrl:
          typeof parsed.ai?.baseUrl === 'string'
            ? parsed.ai.baseUrl
            : DEFAULT_PREFERENCES.ai.baseUrl,
        model: typeof parsed.ai?.model === 'string' ? parsed.ai.model : '',
      },
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: AppPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The app remains usable when storage is blocked or full.
  }
}

type StudyResumeInput = Omit<StudyResumeSnapshot, 'version' | 'savedAt'>;

export function saveStudySnapshot(snapshot: StudyResumeInput): void {
  try {
    window.localStorage.setItem(STUDY_RESUME_KEY, JSON.stringify({
      ...snapshot,
      version: 1,
      savedAt: new Date().toISOString(),
    } satisfies StudyResumeSnapshot));
  } catch {
    // The app remains usable when storage is blocked or full.
  }
}

export function loadStudySnapshot(): StudyResumeSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STUDY_RESUME_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStudyResumeSnapshot(parsed)) return null;
    return {
      ...parsed,
      currentIndex: Math.max(0, Math.min(parsed.currentIndex, parsed.session.cards.length)),
    };
  } catch {
    return null;
  }
}

export function clearStudySnapshot(): void {
  try {
    window.localStorage.removeItem(STUDY_RESUME_KEY);
  } catch {
    // Ignore blocked storage.
  }
}

function isStudyResumeSnapshot(value: unknown): value is StudyResumeSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StudyResumeSnapshot>;
  return candidate.version === 1
    && isStudySession(candidate.session)
    && Number.isFinite(candidate.currentIndex)
    && typeof candidate.flipped === 'boolean'
    && typeof candidate.hasFlipped === 'boolean'
    && Array.isArray(candidate.activeRangeIds)
    && candidate.activeRangeIds.every((item) => typeof item === 'string')
    && typeof candidate.savedAt === 'string';
}

function isStudySession(value: unknown): value is StudySession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StudySession>;
  return typeof candidate.sessionId === 'string'
    && typeof candidate.total === 'number'
    && Array.isArray(candidate.cards)
    && candidate.cards.every((card) => (
      typeof card === 'object'
      && card !== null
      && typeof (card as { lexemeId?: unknown }).lexemeId === 'string'
    ));
}
