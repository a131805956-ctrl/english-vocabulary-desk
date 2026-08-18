import { useEffect, useMemo, useRef, useState } from 'react';
import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech';
import { createSession, getRanges, getSummary, recordReview } from './api';
import { ArticlePanel } from './components/ArticlePanel';
import { ApiSettingsEditor } from './components/ApiSettingsEditor';
import { Flashcard } from './components/Flashcard';
import { RangeDrawer } from './components/RangeDrawer';
import { RatingDock } from './components/RatingDock';
import { SessionHeader } from './components/SessionHeader';
import { SessionLedger } from './components/SessionLedger';
import { SideNav, type NavTarget } from './components/SideNav';
import { displaySectionName } from './card-context';
import {
  clearPendingRangeSelection,
  compactRangeName,
  sanitizeSelection,
  toggleRangeSelection,
} from './range-utils';
import {
  loadPreferences,
  loadStudySnapshot,
  savePreferences,
  saveStudySnapshot,
} from './storage';
import {
  AUTO_SPEAK_DELAY_MS,
  normalizeSpeechVolume,
} from './speech';
import type {
  AppPreferences,
  ArticleProvider,
  RangeDefinition,
  ReviewRating,
  ReviewSummary,
  SessionMode,
  SessionOrder,
  StudyCard,
  StudySession,
} from './types';

type Panel = 'article' | 'stats' | 'settings' | null;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function App() {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [ranges, setRanges] = useState<RangeDefinition[]>([]);
  const [activeRangeIds, setActiveRangeIds] = useState(preferences.rangeIds);
  const [draftRangeIds, setDraftRangeIds] = useState(preferences.rangeIds);
  const [draftLimit, setDraftLimit] = useState<number | null>(preferences.limit);
  const [draftOrder, setDraftOrder] = useState<SessionOrder>(preferences.order);
  const [draftMode, setDraftMode] = useState<Exclude<SessionMode, 'problems'>>(preferences.mode);
  const [draftNewLimit, setDraftNewLimit] = useState(preferences.newLimit);
  const [session, setSession] = useState<StudySession | null>(null);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [hasFlipped, setHasFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resumeReady, setResumeReady] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState(preferences.ai.baseUrl);
  const [aiModel, setAiModel] = useState(preferences.ai.model);
  const [aiProvider, setAiProvider] = useState<ArticleProvider>(preferences.ai.provider);
  const cardShownAt = useRef(Date.now());
  const cardRef = useRef<HTMLButtonElement>(null);
  const focusBeforeModal = useRef<HTMLElement | null>(null);
  const speechTimer = useRef<number | null>(null);

  const currentCard = session?.cards[currentIndex] ?? null;
  const sessionTotal = session?.cards.length ?? 0;
  const completed = Boolean(session && currentIndex >= sessionTotal);
  const activeRanges = useMemo(
    () => ranges.filter((range) => activeRangeIds.includes(range.id)),
    [activeRangeIds, ranges],
  );
  const rangeLabel = useMemo(
    () => describeRanges(activeRanges, activeRangeIds),
    [activeRangeIds, activeRanges],
  );
  const sessionLabel = session?.mode === 'today'
    ? `今日複習 · ${rangeLabel}`
    : session?.mode === 'problems'
      ? `錯題專練 · ${rangeLabel}`
      : rangeLabel;
  const available = session?.total ?? summary?.scope.lexemeCount ?? 0;
  const activeNav: NavTarget = rangeOpen ? 'ranges' : panel ?? 'study';
  const modalKey = rangeOpen ? 'ranges' : panel;

  useEffect(() => {
    let ignore = false;

    async function initialize() {
      setLoading(true);
      try {
        const loadedRanges = await getRanges();
        const selected = sanitizeSelection(loadedRanges, preferences.rangeIds);
        const snapshot = loadStudySnapshot();
        const resume = snapshot !== null
          && snapshot.activeRangeIds.length === selected.length
          && snapshot.activeRangeIds.every((value, index) => value === selected[index])
          && snapshot.session.cards.length > 0
          ? snapshot
          : null;
        const nextSessionPromise = resume
          ? Promise.resolve(resume.session)
          : createSession({
              rangeIds: selected,
              limit: preferences.limit,
              order: preferences.order,
              mode: preferences.mode,
              newLimit: preferences.newLimit,
            });
        const [nextSession, nextSummary] = await Promise.all([
          nextSessionPromise,
          getSummary(selected),
        ]);
        if (ignore) return;
        setRanges(loadedRanges);
        setActiveRangeIds(selected);
        setDraftRangeIds(selected);
        setSession(nextSession);
        setSummary(nextSummary);
        setCurrentIndex(resume?.currentIndex ?? 0);
        setFlipped(resume?.flipped ?? false);
        setHasFlipped(resume?.hasFlipped ?? false);
        setResumeReady(true);
        cardShownAt.current = Date.now();
      } catch (reason) {
        if (!ignore) setError(toMessage(reason));
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void initialize();
    return () => {
      ignore = true;
    };
    // Preferences are intentionally read once to restore the last local session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!resumeReady || !session) return;
    saveStudySnapshot({
      session,
      currentIndex,
      flipped,
      hasFlipped,
      activeRangeIds,
    });
  }, [activeRangeIds, currentIndex, flipped, hasFlipped, resumeReady, session]);

  useEffect(() => {
    if (!currentCard || loading) return;
    const frame = window.requestAnimationFrame(() => cardRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [currentCard, loading]);

  useEffect(() => {
    if (!modalKey) return;

    const previousFocus = document.activeElement;
    focusBeforeModal.current = previousFocus instanceof HTMLElement ? previousFocus : null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';

    const focusDialog = () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const closeButton = dialog?.querySelector<HTMLElement>('button[aria-label^="關閉"]');
      closeButton?.focus();
    };
    const frame = window.requestAnimationFrame(focusDialog);

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (!dialog.contains(current) || (!event.shiftKey && current === last)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', trapFocus);
      body.style.overflow = previousOverflow;
      body.style.overscrollBehavior = previousOverscroll;
      focusBeforeModal.current?.focus();
    };
  }, [modalKey]);

  const speakCurrent = (force = false) => {
    if (!currentCard || preferences.speechMuted && !force) return;
    const word = currentCard.displayHeadword;
    const volume = normalizeSpeechVolume(preferences.speechVolume);
    void (async () => {
      try {
        // Capacitor uses Android's installed system TTS engine in the APK and
        // its Web implementation falls back to browser speechSynthesis.
        await TextToSpeech.speak({
          text: word,
          lang: 'en-US',
          rate: 0.88,
          pitch: 1,
          volume,
          queueStrategy: QueueStrategy.Flush,
        });
        setLiveMessage(`播放 ${word} 的英文發音`);
        return;
      } catch {
        // Keep the old browser path as a safety net for unsupported WebViews.
      }

      if (!('speechSynthesis' in window)) {
        setLiveMessage('這台裝置沒有可用的英文語音引擎');
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      utterance.rate = 0.88;
      utterance.volume = volume;
      window.speechSynthesis.speak(utterance);
      setLiveMessage(`播放 ${word} 的英文發音`);
    })();
  };

  useEffect(() => {
    if (speechTimer.current !== null) {
      window.clearTimeout(speechTimer.current);
      speechTimer.current = null;
    }
    if (!currentCard || loading || preferences.speechMuted) return;
    const cardId = currentCard.lexemeId;
    speechTimer.current = window.setTimeout(() => {
      speechTimer.current = null;
      if (currentCard?.lexemeId === cardId) speakCurrent();
    }, AUTO_SPEAK_DELAY_MS);
    return () => {
      if (speechTimer.current !== null) {
        window.clearTimeout(speechTimer.current);
        speechTimer.current = null;
      }
    };
  }, [currentCard?.lexemeId, loading, preferences.speechMuted, preferences.speechVolume]);

  const toggleSpeech = () => {
    const muted = !preferences.speechMuted;
    if (muted) {
      void TextToSpeech.stop().catch(() => undefined);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }
    const nextPreferences = { ...preferences, speechMuted: muted };
    setPreferences(nextPreferences);
    savePreferences(nextPreferences);
    setLiveMessage(muted ? '已靜音自動發音' : '已開啟自動發音');
  };

  const flipCurrent = () => {
    if (!currentCard || reviewing) return;
    setFlipped((value) => !value);
    setHasFlipped(true);
  };

  const rateCurrent = async (rating: ReviewRating) => {
    if (!currentCard || !session || reviewing || completed) return;
    const card = currentCard;
    const responseMs = Math.min(3_600_000, Date.now() - cardShownAt.current);
    setReviewing(true);
    setError(null);

    try {
      const result = await recordReview({
        lexemeId: card.lexemeId,
        entryId: card.primary.entryId,
        sessionId: session.sessionId,
        rangeIds: activeRangeIds,
        rating,
        responseMs,
        flippedBeforeAnswer: hasFlipped,
      });
      setSession((previous) => previous && ({
        ...previous,
        cards: previous.cards.map((item, index) =>
          index === currentIndex ? { ...item, review: result.review } : item,
        ),
      }));
      setCurrentIndex((index) => Math.min(index + 1, session.cards.length));
      setFlipped(false);
      setHasFlipped(false);
      cardShownAt.current = Date.now();
      setLiveMessage(
        rating === 'good'
          ? `${card.displayHeadword} 已標記為知道，前往下一張`
          : `${card.displayHeadword} 已加入加強複習，前往下一張`,
      );
      void getSummary(activeRangeIds).then(setSummary).catch(() => undefined);
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setReviewing(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRangeOpen(false);
        setPanel(null);
        return;
      }
      if (rangeOpen || panel || isInteractiveTarget(event.target)) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        flipCurrent();
      } else if (event.key.toLowerCase() === 'a' || event.key === 'ArrowLeft') {
        event.preventDefault();
        void rateCurrent('again');
      } else if (event.key.toLowerCase() === 'g' || event.key === 'ArrowRight') {
        event.preventDefault();
        void rateCurrent('good');
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        speakCurrent(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const openRanges = () => {
    setPanel(null);
    setDraftRangeIds(activeRangeIds);
    setDraftLimit(preferences.limit);
    setDraftOrder(preferences.order);
    setDraftMode(preferences.mode);
    setDraftNewLimit(preferences.newLimit);
    setRangeOpen(true);
  };

  const startScope = async (
    rangeIds: string[],
    limit: number | null,
    order: SessionOrder,
    mode: SessionMode,
    newLimit: number,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const [nextSession, nextSummary] = await Promise.all([
        createSession({ rangeIds, limit, order, mode, newLimit }),
        getSummary(rangeIds),
      ]);
      if (mode !== 'problems') {
        const nextPreferences: AppPreferences = { ...preferences, rangeIds, limit, order, mode, newLimit };
        setPreferences(nextPreferences);
        savePreferences(nextPreferences);
      }
      setActiveRangeIds(rangeIds);
      setSession(nextSession);
      setSummary(nextSummary);
      setCurrentIndex(0);
      setFlipped(false);
      setHasFlipped(false);
      setRangeOpen(false);
      setPanel(null);
      cardShownAt.current = Date.now();
      setLiveMessage(
        mode === 'today'
          ? `今日複習包含 ${nextSession.plan.due} 張到期卡與 ${nextSession.plan.new} 張新卡`
          : mode === 'problems'
            ? `已建立 ${nextSession.plan.problems} 張錯題卡`
            : `已建立 ${nextSession.cards.length} 張自由練習卡`,
      );
    } catch (reason) {
      setError(toMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  const handleNavigation = (target: NavTarget) => {
    if (target === 'study') {
      setRangeOpen(false);
      setPanel(null);
    } else if (target === 'ranges') {
      openRanges();
    } else {
      setRangeOpen(false);
      if (target === 'settings') {
        setAiBaseUrl(preferences.ai.baseUrl);
        setAiModel(preferences.ai.model);
        setAiProvider(preferences.ai.provider);
      }
      setPanel(target);
    }
  };

  const saveAiSettings = () => {
    const nextPreferences = {
      ...preferences,
      ai: { provider: aiProvider, baseUrl: aiBaseUrl.trim(), model: aiModel.trim() },
    };
    setPreferences(nextPreferences);
    savePreferences(nextPreferences);
    setLiveMessage('本機 AI 設定已保存');
    setPanel(null);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#study-main">跳到學習內容</a>
      <SideNav active={activeNav} onSelect={handleNavigation} />

      <main className="study-main" id="study-main" tabIndex={-1}>
        <SessionHeader
          rangeLabel={sessionLabel}
          current={completed ? sessionTotal : Math.min(currentIndex + 1, sessionTotal)}
          total={sessionTotal}
          available={available}
          loading={loading}
          onOpenRanges={openRanges}
        />

        {error && (
          <div className="error-banner" role="alert">
            <span><b>本機服務未完成這個動作。</b>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="關閉錯誤訊息">×</button>
          </div>
        )}

        <section className="study-workspace" aria-busy={loading}>
          {loading && !currentCard ? (
            <CardSkeleton />
          ) : completed ? (
            <CompletionCard
              total={sessionTotal}
              again={summary?.againCount ?? 0}
              mode={session?.mode ?? preferences.mode}
              plan={session?.plan ?? { due: 0, new: 0, problems: 0 }}
              onRestart={() => void startScope(
                activeRangeIds,
                preferences.limit,
                preferences.order,
                session?.mode ?? preferences.mode,
                preferences.newLimit,
              )}
              onChangeScope={openRanges}
            />
          ) : currentCard ? (
            <>
              <p className="card-context">
                <span>{displaySectionName(currentCard.primary.section)}</span>
                <i aria-hidden="true">/</i>
                <span>{currentCard.primary.unitTitle ?? '未分類'}</span>
                {currentCard.primary.groupLabel && (
                  <><i aria-hidden="true">/</i><span>{currentCard.primary.groupLabel}</span></>
                )}
              </p>
              <Flashcard
                ref={cardRef}
                key={currentCard.lexemeId}
                card={currentCard}
                flipped={flipped}
                disabled={reviewing}
                speechMuted={preferences.speechMuted}
                onFlip={flipCurrent}
                onRate={(rating) => void rateCurrent(rating)}
                onToggleSpeech={toggleSpeech}
              />
              <RatingDock
                disabled={!currentCard}
                reviewing={reviewing}
                hint="左右滑或點按即可評分；點卡片可查看答案"
                onRate={(rating) => void rateCurrent(rating)}
              />
              <div className="shortcut-strip" aria-label="鍵盤快捷鍵">
                <span><kbd>Space</kbd> 翻面</span>
                <span><kbd>S</kbd> 發音</span>
                <span><kbd>A</kbd> 不知道</span>
                <span><kbd>G</kbd> 知道</span>
              </div>
            </>
          ) : (
            <EmptyState onOpenRanges={openRanges} />
          )}
        </section>
      </main>

      <SessionLedger
        summary={summary}
        session={session}
        activeRangeCount={activeRangeIds.includes('all') ? 1 : activeRangeIds.length}
        available={available}
        orderLabel={preferences.order === 'shuffle' ? '隨機混合' : '照單字書'}
        onOpenRanges={openRanges}
        onOpenStats={() => handleNavigation('stats')}
      />

      <RangeDrawer
        open={rangeOpen}
        ranges={ranges}
        selectedIds={draftRangeIds}
        limit={draftLimit}
        order={draftOrder}
        mode={draftMode}
        newLimit={draftNewLimit}
        starting={loading}
        onToggle={(rangeId) => setDraftRangeIds((current) => toggleRangeSelection(current, rangeId))}
        onLimitChange={setDraftLimit}
        onOrderChange={setDraftOrder}
        onModeChange={setDraftMode}
        onNewLimitChange={setDraftNewLimit}
        onClearSelection={() => setDraftRangeIds(clearPendingRangeSelection())}
        onClose={() => setRangeOpen(false)}
        onStart={() => void startScope(
          draftRangeIds,
          draftLimit,
          draftOrder,
          draftMode,
          draftNewLimit,
        )}
      />

      <UtilityPanel
        panel={panel}
        summary={summary}
        cards={session?.cards ?? []}
        aiBaseUrl={aiBaseUrl}
        aiModel={aiModel}
        aiProvider={aiProvider}
        speechMuted={preferences.speechMuted}
        speechVolume={preferences.speechVolume}
        onAiBaseUrlChange={setAiBaseUrl}
        onAiModelChange={setAiModel}
        onAiProviderChange={setAiProvider}
        onSpeechMutedChange={(muted) => {
          const nextPreferences = { ...preferences, speechMuted: muted };
          setPreferences(nextPreferences);
          savePreferences(nextPreferences);
        }}
        onSpeechVolumeChange={(volume) => {
          const nextPreferences = {
            ...preferences,
            speechVolume: normalizeSpeechVolume(volume),
          };
          setPreferences(nextPreferences);
          savePreferences(nextPreferences);
        }}
        onSaveAi={saveAiSettings}
        onOpenAiSettings={() => handleNavigation('settings')}
        onPracticeProblems={() => void startScope(
          activeRangeIds,
          preferences.limit,
          preferences.order,
          'problems',
          0,
        )}
        onClose={() => setPanel(null)}
      />

      <div className="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="skeleton-wrap" aria-label="正在載入單字卡">
      <div className="skeleton-card"><span /><span /><span /></div>
      <p>正在讀取本機詞庫…</p>
    </div>
  );
}

function EmptyState({ onOpenRanges }: { onOpenRanges: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-spine" aria-hidden="true" />
      <p className="eyebrow">NO CARDS YET</p>
      <h2>先決定今天要記哪一段</h2>
      <p>可以用原本的 UNIT，也能混合字首、字根或直接選全部。</p>
      <button className="primary-button" type="button" onClick={onOpenRanges}>選擇範圍</button>
    </div>
  );
}

function CompletionCard({
  total,
  again,
  mode,
  plan,
  onRestart,
  onChangeScope,
}: {
  total: number;
  again: number;
  mode: SessionMode;
  plan: StudySession['plan'];
  onRestart: () => void;
  onChangeScope: () => void;
}) {
  const copy = completionCopy(mode, total);
  return (
    <div className="completion-card">
      <div className="completion-seal" aria-hidden="true">✓</div>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      <div className="completion-facts">
        {mode === 'today' ? (
          <>
            <span><b>{plan.due}</b>到期卡</span>
            <span><b>{plan.new}</b>新卡</span>
          </>
        ) : mode === 'problems' ? (
          <span><b>{plan.problems}</b>錯題卡</span>
        ) : (
          <span><b>{total}</b>本輪卡片</span>
        )}
        <span><b>{again}</b>累計加強</span>
      </div>
      <div className="completion-actions">
        <button className="primary-button" type="button" onClick={onRestart}>{copy.restart}</button>
        <button className="quiet-button" type="button" onClick={onChangeScope}>換個範圍</button>
      </div>
    </div>
  );
}

function completionCopy(mode: SessionMode, total: number) {
  if (mode === 'today') {
    return total === 0
      ? {
          eyebrow: 'TODAY IS CLEAR',
          title: '今天已經清空了',
          description: '目前沒有到期卡；新字也已達到這輪設定。之後回來時，FSRS 會重新安排該看的字。',
          restart: '再檢查一次',
        }
      : {
          eyebrow: 'TODAY COMPLETE',
          title: '今日複習完成',
          description: `已處理 ${total} 張卡；回答「不知道」的單字會依 FSRS 提前再次出現。`,
          restart: '再檢查到期卡',
        };
  }
  if (mode === 'problems') {
    return total === 0
      ? {
          eyebrow: 'NO PROBLEMS',
          title: '目前沒有錯題',
          description: '回答「不知道」後，單字會自動出現在錯題專練。',
          restart: '重新整理錯題',
        }
      : {
          eyebrow: 'PROBLEM SET COMPLETE',
          title: '錯題專練完成',
          description: `已重新處理 ${total} 張容易忘記的卡，最新作答也已寫入複習排程。`,
          restart: '再練一次錯題',
        };
  }
  return total === 0
    ? {
        eyebrow: 'EMPTY SET',
        title: '這個範圍沒有卡片',
        description: '請換一個來源範圍，或重新建立資料索引。',
        restart: '重新載入',
      }
    : {
        eyebrow: 'SESSION COMPLETE',
        title: '這輪完成了',
        description: `已處理 ${total} 張卡；所有作答都已寫入本機學習記錄。`,
        restart: '同範圍再一輪',
      };
}

function UtilityPanel({
  panel,
  summary,
  cards,
  aiBaseUrl,
  aiModel,
  aiProvider,
  speechMuted,
  speechVolume,
  onAiBaseUrlChange,
  onAiModelChange,
  onAiProviderChange,
  onSpeechMutedChange,
  onSpeechVolumeChange,
  onSaveAi,
  onOpenAiSettings,
  onPracticeProblems,
  onClose,
}: {
  panel: Panel;
  summary: ReviewSummary | null;
  cards: StudyCard[];
  aiBaseUrl: string;
  aiModel: string;
  aiProvider: ArticleProvider;
  speechMuted: boolean;
  speechVolume: number;
  onAiBaseUrlChange: (value: string) => void;
  onAiModelChange: (value: string) => void;
  onAiProviderChange: (value: ArticleProvider) => void;
  onSpeechMutedChange: (value: boolean) => void;
  onSpeechVolumeChange: (value: number) => void;
  onSaveAi: () => void;
  onOpenAiSettings: () => void;
  onPracticeProblems: () => void;
  onClose: () => void;
}) {
  if (!panel) return null;
  return (
    <div className="drawer-layer utility-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside
        className={panel === 'article' ? 'utility-panel article-utility-panel' : 'utility-panel'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="utility-title"
      >
        <header className="drawer-header">
          <div>
            <p className="eyebrow">MORPHEME DESK</p>
            <h2 id="utility-title">
              {panel === 'stats' ? '學習記錄' : panel === 'article' ? '文章工房' : '本機設定'}
            </h2>
          </div>
          <button className="icon-button" type="button" aria-label="關閉面板" onClick={onClose}>×</button>
        </header>

        {panel === 'stats' && (
          <StatsPanel summary={summary} onPracticeProblems={onPracticeProblems} />
        )}
        {panel === 'article' && (
          <ArticlePanel
            cards={cards}
            baseUrl={aiBaseUrl}
            model={aiModel}
            provider={aiProvider}
            onOpenSettings={onOpenAiSettings}
          />
        )}
        {panel === 'settings' && (
          <div className="settings-form">
            <p>選擇電腦上的模型服務，或交給 Hermes Agent 的既有登入。設定只存在這台瀏覽器，不保存 API 金鑰。</p>
            <label>
              <span>文章生成器</span>
              <select
                name="article-provider"
                value={aiProvider}
                onChange={(event) => onAiProviderChange(event.target.value as ArticleProvider)}
              >
                <option value="auto">Ollama／OpenAI 相容本機服務</option>
                <option value="hermes">Hermes Agent</option>
              </select>
            </label>
            {aiProvider === 'hermes' ? (
              <div className="hermes-setting-note">
                <ApiSettingsEditor />
                <b>使用 Hermes Agent 的預設模型</b>
                <span>文章只會傳入選取的單字；呼叫時會停用 Hermes 的檔案、終端、瀏覽與技能工具。</span>
              </div>
            ) : (
              <>
                <label>
                  <span>本機 AI 位址</span>
                  <input
                    type="url"
                    name="local-ai-url"
                    autoComplete="url"
                    value={aiBaseUrl}
                    onChange={(event) => onAiBaseUrlChange(event.target.value)}
                    placeholder="http://127.0.0.1:11434"
                  />
                </label>
                <label>
                  <span>模型名稱</span>
                  <input
                    type="text"
                    name="local-ai-model"
                    autoComplete="off"
                    value={aiModel}
                    onChange={(event) => onAiModelChange(event.target.value)}
                    placeholder="例如 llama3.2"
                  />
                </label>
              </>
            )}
            <section className="speech-settings" aria-labelledby="speech-settings-title">
              <div className="speech-settings-heading">
                <div>
                  <span className="eyebrow">CARD AUDIO</span>
                  <h3 id="speech-settings-title">自動發音</h3>
                </div>
                <button
                  className="quiet-button compact-button"
                  type="button"
                  aria-pressed={speechMuted}
                  onClick={() => onSpeechMutedChange(!speechMuted)}
                >
                  {speechMuted ? '已靜音' : '播放中'}
                </button>
              </div>
              <label htmlFor="speech-volume">
                <span>發音音量 <output>{Math.round(speechVolume * 100)}%</output></span>
                <input
                  id="speech-volume"
                  name="speech-volume"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={speechVolume}
                  onChange={(event) => onSpeechVolumeChange(Number(event.target.value))}
                />
              </label>
              <p>下一張單字卡出現約 0.9 秒後自動播放；也可以直接按卡片右上角靜音。</p>
            </section>
            <button className="primary-button" type="button" onClick={onSaveAi}>保存本機設定</button>
          </div>
        )}
      </aside>
    </div>
  );
}

function StatsPanel({
  summary,
  onPracticeProblems,
}: {
  summary: ReviewSummary | null;
  onPracticeProblems: () => void;
}) {
  if (!summary) return <div className="panel-empty"><p>正在整理這個範圍的學習資料。</p></div>;
  const recentDays = summary.daily.slice(-7);
  const maxDaily = Math.max(1, ...recentDays.map((day) => day.total));
  const coverage = summary.scope.lexemeCount > 0
    ? Math.round((summary.reviewedLexemes / summary.scope.lexemeCount) * 100)
    : 0;

  return (
    <div className="stats-panel">
      <div className="stats-summary">
        <span><b>{summary.totalReviews}</b>回答次數</span>
        <span><b>{summary.accuracy === null ? '—' : `${Math.round(summary.accuracy * 100)}%`}</b>知道比例</span>
        <span><b>{summary.streakDays}</b>連續學習天數</span>
        <span><b>{summary.dueNow}</b>現在到期</span>
      </div>
      <section className="stats-activity" aria-labelledby="activity-title">
        <header>
          <div>
            <p className="eyebrow">LEARNING RHYTHM</p>
            <h3 id="activity-title">最近 7 個學習日</h3>
          </div>
          <b>{coverage}% 已覆蓋</b>
        </header>
        {recentDays.length > 0 ? (
          <div className="activity-bars" role="list" aria-label="最近學習量">
            {recentDays.map((day) => {
              const height = Math.max(10, Math.round((day.total / maxDaily) * 100));
              return (
                <div
                  className="activity-bar-item"
                  key={day.date}
                  role="listitem"
                  aria-label={`${formatStatsDate(day.date)}：${day.total} 次作答，其中 ${day.good} 次知道`}
                >
                  <span className="activity-bar-value">{day.total}</span>
                  <span className="activity-bar" style={{ height: `${height}%` }} />
                  <span>{formatStatsDate(day.date)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="stats-empty">完成第一張卡後，這裡會記下你的學習節奏。</p>
        )}
        <p className="stats-insight">
          已複習 {summary.reviewedLexemes} / {summary.scope.lexemeCount} 個單字；
          {summary.averageResponseMs === null ? '再回答幾張即可看平均反應時間。' : `平均反應 ${(summary.averageResponseMs / 1000).toFixed(1)} 秒。`}
        </p>
      </section>
      <div className="problem-list">
        <div className="problem-heading">
          <h3>需要加強</h3>
          <button
            className="quiet-button compact-button"
            type="button"
            disabled={summary.problemLexemes.length === 0}
            onClick={onPracticeProblems}
          >
            專練錯題 · {summary.problemLexemes.length}
          </button>
        </div>
        {summary.problemLexemes.length === 0 ? <p>目前沒有錯題。</p> : summary.problemLexemes.map((item) => (
          <div key={item.lexemeId}>
            <span><b lang="en">{item.displayHeadword}</b><small>{item.definitionZh}</small></span>
            <strong>{item.againCount} 次</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatStatsDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(date);
}

function describeRanges(ranges: RangeDefinition[], ids: string[]): string {
  if (ids.includes('all')) return '全部單字';
  if (ranges.length === 0) return '自訂範圍';
  if (ranges.length === 1) return compactRangeName(ranges[0].name);
  return `${compactRangeName(ranges[0].name)} ＋ ${ranges.length - 1} 個範圍`;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('button, input, select, textarea, a, [contenteditable="true"]'),
  );
}

function toMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '請確認本機服務是否正在執行。';
}
