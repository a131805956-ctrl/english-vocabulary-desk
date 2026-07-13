import type {
  ArticleGenerationResult,
  ArticleArchiveDetail,
  ArticleArchiveItem,
  ArticleLength,
  ArticleLevel,
  ArticleProvider,
  RangeDefinition,
  ReviewRating,
  ReviewResult,
  ReviewSummary,
  SessionMode,
  SessionOrder,
  StudySession,
} from './types';

interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}

export class ApiRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      // The status text remains a useful fallback for non-JSON failures.
    }
    throw new ApiRequestError(
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
      payload.error?.message ?? response.statusText ?? '本機服務發生錯誤',
    );
  }

  return (await response.json()) as T;
}

export async function getRanges(): Promise<RangeDefinition[]> {
  const payload = await requestJson<{ ranges: RangeDefinition[] }>('/api/ranges');
  return payload.ranges;
}

export function createSession(input: {
  rangeIds: string[];
  limit: number | null;
  order: SessionOrder;
  mode: SessionMode;
  newLimit: number;
}): Promise<StudySession> {
  return requestJson<StudySession>('/api/session', {
    method: 'POST',
    body: JSON.stringify({
      rangeIds: input.rangeIds,
      order: input.order,
      mode: input.mode,
      newLimit: input.newLimit,
      ...(input.limit === null ? {} : { limit: input.limit }),
    }),
  });
}

export function recordReview(input: {
  lexemeId: string;
  entryId: string;
  sessionId: string;
  rangeIds: string[];
  rating: ReviewRating;
  responseMs: number;
  flippedBeforeAnswer: boolean;
}): Promise<ReviewResult> {
  return requestJson<ReviewResult>('/api/reviews', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getSummary(rangeIds: string[] = ['all']): Promise<ReviewSummary> {
  const query = new URLSearchParams();
  rangeIds.forEach((rangeId) => query.append('rangeId', rangeId));
  return requestJson<ReviewSummary>(`/api/summary?${query.toString()}`);
}

export function generateArticle(input: {
  provider?: ArticleProvider;
  baseUrl: string;
  model: string;
  lexemeIds: string[];
  level: ArticleLevel;
  length: ArticleLength;
  includeTranslation?: boolean;
}): Promise<ArticleGenerationResult> {
  return requestJson<ArticleGenerationResult>('/api/articles', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      provider: input.provider ?? 'auto',
      includeTranslation: input.includeTranslation ?? true,
    }),
  });
}

export async function listArticles(): Promise<ArticleArchiveItem[]> {
  const payload = await requestJson<{ articles: ArticleArchiveItem[] }>('/api/articles');
  return payload.articles;
}

export function getArticle(articleId: string): Promise<ArticleArchiveDetail> {
  return requestJson<ArticleArchiveDetail>(`/api/articles/${encodeURIComponent(articleId)}`);
}

export function deleteArticle(articleId: string): Promise<{ deleted: boolean; articleId: string }> {
  return requestJson<{ deleted: boolean; articleId: string }>(
    `/api/articles/${encodeURIComponent(articleId)}`,
    { method: 'DELETE' },
  );
}
