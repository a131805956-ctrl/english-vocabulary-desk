import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, generateArticle, resolveApiUrl } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client API contracts', () => {
  it('sends the FSRS session mode and new-card limit', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        rangeIds: ['all'],
        order: 'source',
        mode: 'today',
        newLimit: 20,
        limit: 40,
      });
      return Response.json({
        sessionId: 'session:test',
        total: 574,
        mode: 'today',
        plan: { due: 0, new: 20, problems: 0 },
        cards: [],
      }, { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await createSession({
      rangeIds: ['all'],
      order: 'source',
      mode: 'today',
      newLimit: 20,
      limit: 40,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ method: 'POST' }));
  });

  it('routes article requests through the local API adapter', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'local-model',
        provider: 'auto',
        lexemeIds: ['lexeme:a', 'lexeme:b', 'lexeme:c'],
        includeTranslation: true,
      });
      return Response.json({
        article: {
          title: 'A Local Story',
          body: 'A short story.',
          translationZh: '一篇短文。',
          usedWords: ['a', 'b', 'c'],
          questions: [],
        },
        meta: { provider: 'ollama', model: 'local-model', generatedAt: new Date(0).toISOString() },
      }, { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateArticle({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'local-model',
      lexemeIds: ['lexeme:a', 'lexeme:b', 'lexeme:c'],
      level: 'intermediate',
      length: 'short',
    });

    expect(result.article.title).toBe('A Local Story');
    expect(fetchMock).toHaveBeenCalledWith('/api/articles', expect.objectContaining({ method: 'POST' }));
  });

  it('selects Hermes Agent without requiring a model URL', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        provider: 'hermes',
        baseUrl: '',
        model: '',
        lexemeIds: ['lexeme:a', 'lexeme:b', 'lexeme:c'],
      });
      return Response.json({
        article: {
          title: 'Hermes Story', body: 'A story.', translationZh: null, usedWords: [], questions: [],
        },
        meta: { provider: 'hermes-agent', model: 'Hermes Agent default', generatedAt: new Date(0).toISOString() },
      }, { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await generateArticle({
      provider: 'hermes',
      baseUrl: '',
      model: '',
      lexemeIds: ['lexeme:a', 'lexeme:b', 'lexeme:c'],
      level: 'intermediate',
      length: 'short',
    });
  });
});

describe('API origin resolution', () => {
  it('keeps local relative API paths when no origin is configured', () => {
    expect(resolveApiUrl('/api/ranges', '')).toBe('/api/ranges');
  });

  it('joins a GitHub Pages build to its separately hosted API origin', () => {
    expect(resolveApiUrl('/api/ranges', 'https://vocab-api.example.com/')).toBe(
      'https://vocab-api.example.com/api/ranges',
    );
  });

  it('does not rewrite an already absolute URL', () => {
    expect(resolveApiUrl('https://other.example.com/api', 'https://vocab-api.example.com')).toBe(
      'https://other.example.com/api',
    );
  });
});
