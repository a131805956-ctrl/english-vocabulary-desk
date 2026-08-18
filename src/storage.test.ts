import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudySession } from './types';
import { clearStudySnapshot, loadStudySnapshot, saveStudySnapshot } from './storage';

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const session = {
  sessionId: 'session:test',
  total: 1,
  mode: 'manual',
  plan: { due: 0, new: 0, problems: 0 },
  cards: [{ lexemeId: 'lexeme:test' }],
} as unknown as StudySession;

describe('study resume storage', () => {
  beforeEach(() => {
    globalThis.window = { localStorage: createMemoryStorage() } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('round-trips the active session and clamps an out-of-range index', () => {
    saveStudySnapshot({
      session,
      currentIndex: 4,
      flipped: true,
      hasFlipped: true,
      activeRangeIds: ['all'],
    });

    expect(loadStudySnapshot()).toMatchObject({
      version: 1,
      session,
      currentIndex: 1,
      flipped: true,
      hasFlipped: true,
      activeRangeIds: ['all'],
    });
  });

  it('ignores malformed snapshots and sessions without cards', () => {
    window.localStorage.setItem('morphemeDesk:study-resume:v1', '{not-json');
    expect(loadStudySnapshot()).toBeNull();

    window.localStorage.setItem(
      'morphemeDesk:study-resume:v1',
      JSON.stringify({ version: 1, session: { sessionId: 'broken', cards: null } }),
    );
    expect(loadStudySnapshot()).toBeNull();
  });

  it('clears a saved study snapshot explicitly', () => {
    saveStudySnapshot({
      session,
      currentIndex: 0,
      flipped: false,
      hasFlipped: false,
      activeRangeIds: ['all'],
    });
    clearStudySnapshot();
    expect(loadStudySnapshot()).toBeNull();
  });
});
