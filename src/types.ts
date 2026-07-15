export type ReviewRating = 'again' | 'good';
export type SessionOrder = 'source' | 'shuffle';
export type SessionMode = 'today' | 'manual' | 'problems';
export type ArticleLevel = 'beginner' | 'intermediate' | 'advanced';
export type ArticleLength = 'short' | 'medium' | 'long';
export type ArticleProvider = 'auto' | 'hermes';

export interface HermesApiSettings {
  baseUrl: string;
  model: string;
  sessionKey: string;
  apiKeyConfigured: boolean;
  apiKeyMasked: string | null;
}

export interface RangeDefinition {
  id: string;
  kind: 'all' | 'source' | 'section' | 'unit' | 'group' | string;
  name: string;
  parentId: string | null;
  status: 'complete' | 'missing_source' | 'inferred_header' | string;
  entryCount: number;
  lexemeCount: number;
}

export interface PrimaryEntry {
  entryId: string;
  pronunciation: string | null;
  partsOfSpeech: string[];
  definitionZh: string | null;
  relationType: string | null;
  relationTerm: string | null;
  examTag: string | null;
  difficulty: number | null;
  etymology: string | null;
  exampleEn: string | null;
  exampleZh: string | null;
  section: 'prefix' | 'root' | string | null;
  unitTitle: string | null;
  groupLabel: string | null;
  qualityFlags: string[];
}

export interface ReviewProgress {
  lexemeId: string;
  due: string;
  stability: number;
  difficulty: number;
  retrievability: number;
  lapses: number;
  state: string;
  reps: number;
  againCount: number;
  goodCount: number;
  lastReview: string | null;
  lastIntervalDays: number;
  scheduler: {
    algorithm: string;
    version: number;
    fsrsData: Record<string, unknown>;
  };
}

export interface StudyCard {
  lexemeId: string;
  canonicalTerm: string;
  displayHeadword: string;
  variants: string[];
  entryCount: number;
  primary: PrimaryEntry;
  review: ReviewProgress | null;
}

export interface StudySession {
  sessionId: string;
  total: number;
  mode: SessionMode;
  plan: {
    due: number;
    new: number;
    problems: number;
  };
  cards: StudyCard[];
}

export interface ProblemLexeme {
  lexemeId: string;
  displayHeadword: string | null;
  definitionZh: string | null;
  againCount: number;
  goodCount: number;
  total: number;
}

export interface ReviewSummary {
  scope: {
    rangeIds: string[];
    sessionId: string | null;
    lexemeCount: number;
  };
  totalReviews: number;
  againCount: number;
  goodCount: number;
  accuracy: number | null;
  averageResponseMs: number | null;
  reviewedLexemes: number;
  unreviewedLexemes: number;
  dueNow: number;
  learning: number;
  review: number;
  streakDays: number;
  daily: Array<{ date: string; total: number; again: number; good: number }>;
  problemLexemes: ProblemLexeme[];
}

export interface ReviewResult {
  event: {
    eventId: string;
    lexemeId: string;
    entryId: string | null;
    sessionId: string | null;
    rangeIds: string[];
    reviewedAt: string;
    rating: ReviewRating;
    responseMs: number | null;
    flippedBeforeAnswer: boolean;
    wasCorrect: boolean;
  };
  review: ReviewProgress;
}

export interface ArticleQuestion {
  question: string;
  answer: string;
}

export interface GeneratedArticle {
  title: string;
  body: string;
  translationZh: string | null;
  usedWords: string[];
  questions: ArticleQuestion[];
}

export interface ArticleArchiveItem {
  articleId: string;
  createdAt: string;
  title: string;
  usedWords: string[];
  meta: {
    provider: string;
    model: string;
  };
  level: ArticleLevel;
  length: ArticleLength;
}

export interface ArticleArchiveDetail extends ArticleArchiveItem {
  article: GeneratedArticle;
  selectedLexemeIds: string[];
}

export interface ArticleGenerationResult {
  article: GeneratedArticle;
  meta: {
    provider: string;
    model: string;
    generatedAt: string;
  };
  saved: ArticleArchiveItem;
}

export interface AppPreferences {
  rangeIds: string[];
  order: SessionOrder;
  limit: number | null;
  mode: Exclude<SessionMode, 'problems'>;
  newLimit: number;
  ai: {
    provider: ArticleProvider;
    baseUrl: string;
    model: string;
  };
}
