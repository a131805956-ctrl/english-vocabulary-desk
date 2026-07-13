import type { AppPreferences } from './types';

const STORAGE_KEY = 'morphemeDesk:preferences:v1';

export const DEFAULT_PREFERENCES: AppPreferences = {
  rangeIds: ['all'],
  order: 'source',
  limit: 40,
  mode: 'today',
  newLimit: 20,
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
