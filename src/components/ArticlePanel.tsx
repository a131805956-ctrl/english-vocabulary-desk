import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiRequestError,
  deleteArticle,
  generateArticle,
  getArticle,
  listArticles,
} from '../api';
import type {
  ArticleArchiveItem,
  ArticleGenerationResult,
  ArticleLength,
  ArticleLevel,
  ArticleProvider,
  StudyCard,
} from '../types';

const MAX_WORDS = 12;
const DEFAULT_WORDS = 8;

export function addVisibleWordsToSelection(
  currentIds: readonly string[],
  visibleIds: readonly string[],
  maximum = MAX_WORDS,
): string[] {
  const next = [...new Set(currentIds)].slice(0, maximum);
  for (const lexemeId of visibleIds) {
    if (next.length >= maximum) break;
    if (!next.includes(lexemeId)) next.push(lexemeId);
  }
  return next;
}

export function toggleVisibleWordsSelection(
  currentIds: readonly string[],
  visibleIds: readonly string[],
  maximum = MAX_WORDS,
): string[] {
  const current = [...new Set(currentIds)];
  const visible = [...new Set(visibleIds)];
  if (visible.length > 0 && visible.every((id) => current.includes(id))) {
    const visibleSet = new Set(visible);
    return current.filter((id) => !visibleSet.has(id));
  }
  return addVisibleWordsToSelection(current, visible, maximum);
}

export function removeSelectedWord(currentIds: readonly string[], lexemeId: string): string[] {
  return currentIds.filter((id) => id !== lexemeId);
}

export function isArchiveActionLocked(
  openingId: string | null,
  pendingDeleteId: string | null,
): boolean {
  return openingId !== null || pendingDeleteId !== null;
}

interface ArticlePanelProps {
  cards: StudyCard[];
  baseUrl: string;
  model: string;
  provider: ArticleProvider;
  onOpenSettings: () => void;
}

export function ArticlePanel({
  cards,
  baseUrl,
  model,
  provider,
  onOpenSettings,
}: ArticlePanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    cards.slice(0, DEFAULT_WORDS).map((card) => card.lexemeId),
  );
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<ArticleLevel>('intermediate');
  const [length, setLength] = useState<ArticleLength>('short');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ArticleGenerationResult | null>(null);
  const [archive, setArchive] = useState<ArticleArchiveItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDeleteRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const archiveIndexRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const configured = provider === 'hermes' || Boolean(baseUrl.trim() && model.trim());
  const cardSignature = cards.map((card) => card.lexemeId).join('|');

  useEffect(() => {
    const validIds = new Set(cards.map((card) => card.lexemeId));
    setSelectedIds((current) => {
      const retained = current.filter((id) => validIds.has(id)).slice(0, MAX_WORDS);
      if (retained.length >= Math.min(DEFAULT_WORDS, cards.length)) return retained;
      const filled = [...retained];
      for (const card of cards) {
        if (!filled.includes(card.lexemeId)) filled.push(card.lexemeId);
        if (filled.length >= Math.min(DEFAULT_WORDS, cards.length)) break;
      }
      return filled;
    });
    setResult(null);
    setError(null);
    setConfirmingDeleteId(null);
    // A compact signature resets the selection only when the study scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardSignature]);

  useEffect(() => {
    let active = true;
    const loadArchive = async () => {
      setArchiveLoading(true);
      try {
        const savedArticles = await listArticles();
        if (active) setArchive(savedArticles);
      } catch (reason) {
        if (active) setError(articleErrorMessage(reason));
      } finally {
        if (active) setArchiveLoading(false);
      }
    };
    void loadArchive();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!result) return;
    const frame = window.requestAnimationFrame(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [result]);

  const visibleCards = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return cards;
    return cards.filter((card) =>
      card.displayHeadword.toLocaleLowerCase().includes(normalized)
      || card.primary.definitionZh?.includes(query.trim()),
    );
  }, [cards, query]);

  const selectedCards = useMemo(() => {
    const byId = new Map(cards.map((card) => [card.lexemeId, card]));
    return selectedIds.flatMap((id) => {
      const card = byId.get(id);
      return card ? [card] : [];
    });
  }, [cards, selectedIds]);

  const toggleWord = (lexemeId: string) => {
    setNotice('');
    setConfirmingDeleteId(null);
    if (selectedIds.includes(lexemeId)) {
      setSelectedIds(selectedIds.filter((id) => id !== lexemeId));
      return;
    }
    if (selectedIds.length >= MAX_WORDS) {
      setNotice(`一次最多選 ${MAX_WORDS} 個，文章會更自然。`);
      return;
    }
    setSelectedIds([...selectedIds, lexemeId]);
  };

  const selectVisibleWords = () => {
    const visibleIds = visibleCards.map((card) => card.lexemeId);
    const selectedVisible = visibleIds.filter((lexemeId) => selectedIds.includes(lexemeId)).length;
    const allVisibleSelected = visibleIds.length > 0 && selectedVisible === visibleIds.length;
    const next = toggleVisibleWordsSelection(selectedIds, visibleIds);
    setConfirmingDeleteId(null);
    setSelectedIds(next);

    if (allVisibleSelected) {
      setNotice('已取消目前篩選的單字。');
    } else if (next.length >= MAX_WORDS) {
      setNotice(`已加入可見單字；最多保留 ${MAX_WORDS} 個。`);
    } else {
      setNotice(`已加入 ${next.length - selectedIds.length} 個可見單字。`);
    }
  };

  const clearSelectedWords = () => {
    setConfirmingDeleteId(null);
    setSelectedIds([]);
    setNotice('已清除文章候選單字。');
  };

  const scrollToArchive = () => {
    archiveIndexRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleGenerate = async () => {
    if (!configured || selectedIds.length < 3 || generating) return;
    setGenerating(true);
    setError(null);
    setNotice('');
    setConfirmingDeleteId(null);
    try {
      const next = await generateArticle({
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        lexemeIds: selectedIds,
        level,
        length,
        includeTranslation: true,
      });
      setResult(next);
      setArchive((current) => [next.saved, ...current.filter((item) => item.articleId !== next.saved.articleId)]);
      setNotice('文章已自動保存到閱讀索引。');
    } catch (reason) {
      setError(articleErrorMessage(reason));
    } finally {
      setGenerating(false);
    }
  };

  const openSavedArticle = async (articleId: string) => {
    if (pendingDeleteRef.current || isArchiveActionLocked(openingId, pendingDeleteId)) return;
    setOpeningId(articleId);
    setError(null);
    setConfirmingDeleteId(null);
    try {
      const saved = await getArticle(articleId);
      setResult({
        article: saved.article,
        meta: {
          ...saved.meta,
          generatedAt: saved.createdAt,
        },
        saved,
      });
      setNotice('已開啟保存的文章。');
    } catch (reason) {
      setError(articleErrorMessage(reason));
    } finally {
      setOpeningId(null);
    }
  };

  const removeSavedArticle = async (articleId: string) => {
    if (pendingDeleteRef.current || isArchiveActionLocked(openingId, pendingDeleteId)) return;
    if (confirmingDeleteId !== articleId) {
      setConfirmingDeleteId(articleId);
      setNotice('再按一次「確認刪除」才會永久移除文章。');
      return;
    }

    pendingDeleteRef.current = articleId;
    setPendingDeleteId(articleId);
    setConfirmingDeleteId(null);
    setError(null);
    try {
      await deleteArticle(articleId);
      setArchive((current) => current.filter((item) => item.articleId !== articleId));
      if (result?.saved.articleId === articleId) setResult(null);
      setNotice('文章已刪除。');
    } catch (reason) {
      setError(articleErrorMessage(reason));
    } finally {
      pendingDeleteRef.current = null;
      setPendingDeleteId(null);
    }
  };

  const cancelDelete = () => {
    if (pendingDeleteRef.current || pendingDeleteId) return;
    setConfirmingDeleteId(null);
    setNotice('已取消刪除。');
  };

  const copyArticle = async () => {
    if (!result) return;
    const text = [
      result.article.title,
      result.article.body,
      result.article.translationZh ?? '',
    ].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setNotice('文章已複製。');
    } catch {
      setNotice('瀏覽器未允許複製，請手動選取文章。');
    }
  };

  if (cards.length === 0) {
    return (
      <div className="panel-empty">
        <p>先在「範圍」建立一輪單字卡，再用那些單字生成文章。</p>
      </div>
    );
  }

  return (
    <div className="article-panel">
      <div className="article-intro">
        <p>從這輪單字挑 3–12 個，交給本機模型或 Hermes Agent 寫成短文與理解題。</p>
        <div className="article-status">
          <span className={configured ? 'status-dot is-ready' : 'status-dot'} />
          <span>{configured
            ? provider === 'hermes'
              ? 'Hermes Agent · 既有登入'
              : `${model} · 本機連線`
            : '尚未指定本機模型'}</span>
          {!configured && (
            <button className="text-button" type="button" onClick={onOpenSettings}>前往設定</button>
          )}
        </div>
      </div>

      <section
        ref={archiveIndexRef}
        className="article-index"
        aria-labelledby="article-index-title"
        aria-busy={archiveLoading || isArchiveActionLocked(openingId, pendingDeleteId)}
      >
        <div className="article-index-heading">
          <div>
            <span className="eyebrow">SAVED READING</span>
            <h3 id="article-index-title">閱讀索引</h3>
          </div>
          <b>{archiveLoading ? '讀取中' : `${archive.length} 篇`}</b>
        </div>
        {archive.length > 0 ? (
          <div className="article-index-list">
            {archive.map((item) => {
              const confirming = confirmingDeleteId === item.articleId;
              const deleting = pendingDeleteId === item.articleId;
              const archiveLocked = isArchiveActionLocked(openingId, pendingDeleteId);
              return (
                <article className="article-index-item" key={item.articleId}>
                  <button
                    className="article-index-open"
                    type="button"
                    onClick={() => void openSavedArticle(item.articleId)}
                    disabled={archiveLocked}
                    aria-label={`開啟文章：${item.title}`}
                  >
                    <span className="article-index-date">{formatArchiveTime(item.createdAt)}</span>
                    <b lang="en">{item.title}</b>
                    <span className="article-index-words" aria-label="使用單字">
                      {item.usedWords.map((word) => <span key={word} lang="en">{word}</span>)}
                    </span>
                  </button>
                  <div className="article-index-actions" role="group" aria-label={`文章操作：${item.title}`}>
                    <button
                      className={confirming ? 'article-delete-button is-confirm' : 'article-delete-button'}
                      type="button"
                      onClick={() => void removeSavedArticle(item.articleId)}
                      disabled={archiveLocked || (confirmingDeleteId !== null && !confirming)}
                      aria-busy={deleting}
                      aria-label={deleting
                        ? `正在刪除文章：${item.title}`
                        : confirming
                          ? `確認永久刪除文章：${item.title}`
                          : `刪除文章：${item.title}`}
                    >
                      {deleting ? '刪除中…' : confirming ? '確認刪除' : '刪除'}
                    </button>
                    {confirming && !pendingDeleteId && (
                      <button className="text-button" type="button" onClick={cancelDelete}>
                        取消
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : !archiveLoading && (
          <p className="article-index-empty">尚未保存文章。生成第一篇後，主題與使用單字會先出現在這裡。</p>
        )}
      </section>

      <section className="article-step" aria-labelledby="article-words-title">
        <div className="article-step-heading">
          <div>
            <span>01</span>
            <h3 id="article-words-title">選擇要練的字</h3>
          </div>
          <b id="article-selection-status" aria-live="polite" aria-atomic="true">
            {selectedIds.length} / {MAX_WORDS}
          </b>
        </div>
        {cards.length > 12 && (
          <label className="article-search">
            <span className="sr-only">搜尋這輪單字</span>
            <input
              type="search"
              name="article-word-search"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setConfirmingDeleteId(null);
              }}
              placeholder="搜尋英文或中文意思"
            />
          </label>
        )}
        <div className="article-selection-actions" role="group" aria-label="候選單字操作">
          <button className="text-button" type="button" onClick={selectVisibleWords} disabled={visibleCards.length === 0}>
            {visibleCards.length > 0 && visibleCards.every((card) => selectedIds.includes(card.lexemeId))
              ? '取消目前篩選'
              : '選取目前篩選'}
          </button>
          <button className="text-button" type="button" onClick={clearSelectedWords} disabled={selectedIds.length === 0}>
            清除選取
          </button>
        </div>
        {selectedCards.length > 0 && (
          <div className="selected-word-strip" aria-label="已選文章單字">
            <span>已選</span>
            <div>
              {selectedCards.map((card) => (
                <button
                  className="selected-word-chip"
                  type="button"
                  key={card.lexemeId}
                  onClick={() => setSelectedIds((current) => removeSelectedWord(current, card.lexemeId))}
                  aria-label={`移除單字：${card.displayHeadword}`}
                >
                  <span lang="en">{card.displayHeadword}</span><b aria-hidden="true">×</b>
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          className="word-chip-list article-word-list"
          role="group"
          aria-label="這輪文章候選單字"
          aria-describedby="article-selection-status"
        >
          {visibleCards.map((card) => {
            const selected = selectedIds.includes(card.lexemeId);
            return (
              <label className={selected ? 'article-word-chip is-selected' : 'article-word-chip'} key={card.lexemeId}>
                <input
                  type="checkbox"
                  name="article-word"
                  value={card.lexemeId}
                  checked={selected}
                  onChange={() => toggleWord(card.lexemeId)}
                />
                <span lang="en">{card.displayHeadword}</span>
                <small>{card.primary.definitionZh ?? '—'}</small>
              </label>
            );
          })}
          {visibleCards.length === 0 && <p className="article-no-results">找不到符合的單字。</p>}
        </div>
      </section>

      <section className="article-step" aria-labelledby="article-options-title">
        <div className="article-step-heading">
          <div>
            <span>02</span>
            <h3 id="article-options-title">設定文章難度</h3>
          </div>
        </div>
        <div className="article-options">
          <label>
            <span>英文程度</span>
            <select
              name="article-level"
              autoComplete="off"
              value={level}
              onChange={(event) => {
                setLevel(event.target.value as ArticleLevel);
                setConfirmingDeleteId(null);
              }}
            >
              <option value="beginner">入門 · A2</option>
              <option value="intermediate">中階 · B1–B2</option>
              <option value="advanced">進階 · C1</option>
            </select>
          </label>
          <label>
            <span>文章長度</span>
            <select
              name="article-length"
              autoComplete="off"
              value={length}
              onChange={(event) => {
                setLength(event.target.value as ArticleLength);
                setConfirmingDeleteId(null);
              }}
            >
              <option value="short">短 · 約 120 字</option>
              <option value="medium">中 · 約 220 字</option>
              <option value="long">長 · 約 350 字</option>
            </select>
          </label>
        </div>
      </section>

      {error && <div className="article-error" role="alert"><b>生成失敗</b><span>{error}</span></div>}
      {notice && <p className="article-notice" aria-live="polite">{notice}</p>}

      <button
        className="primary-button article-generate"
        type="button"
        onClick={() => void handleGenerate()}
        disabled={!configured || selectedIds.length < 3 || generating}
        aria-describedby="article-selection-status"
      >
        {generating ? '本機模型正在寫作…' : result ? '用同一組字重新生成' : '生成練習文章'}
      </button>
      {selectedIds.length < 3 && <p className="article-hint">至少再選 {3 - selectedIds.length} 個單字。</p>}

      {result && (
        <ArticleResult
          ref={resultRef}
          result={result}
          selectedCards={selectedCards}
          onCopy={() => void copyArticle()}
          onBackToArchive={scrollToArchive}
        />
      )}
    </div>
  );
}

function articleErrorMessage(reason: unknown): string {
  if (!(reason instanceof ApiRequestError)) {
    return reason instanceof Error ? reason.message : '本機模型沒有完成文章生成。';
  }
  const messages: Record<string, string> = {
    AI_CONNECTION_FAILED: '連不到本機 AI。請先啟動 Ollama／LM Studio，並確認位址與模型名稱。',
    AI_REQUEST_TIMEOUT: '本機模型超過 60 秒沒有回應；可以改用較小模型或縮短文章。',
    AI_UPSTREAM_ERROR: '本機 AI 拒絕了請求。請確認模型已下載或已在 LM Studio 載入。',
    AI_INVALID_RESPONSE: '本機 AI 回傳了無法讀取的內容，請再生成一次。',
    AI_INVALID_OUTPUT: '模型沒有依文章格式輸出；請再試一次或換一個指令遵循較好的模型。',
    HERMES_UNAVAILABLE: '找不到 Hermes Agent。請確認這台電腦可執行 hermes 指令。',
    HERMES_TIMEOUT: 'Hermes Agent 超過兩分鐘沒有回應；可以縮短文章後再試。',
    HERMES_AGENT_FAILED: 'Hermes Agent 沒有完成文章生成；請確認 Hermes 登入和預設模型可用。',
    HERMES_INVALID_RESPONSE: 'Hermes Agent 沒有回傳可讀文字，請再試一次。',
    HERMES_OUTPUT_TOO_LARGE: 'Hermes Agent 的回覆過長，請縮短文章後再試。',
    REMOTE_AI_HOST_FORBIDDEN: '為保護本機資料，這裡只允許 localhost、127.0.0.1 或 [::1]。',
    UNKNOWN_VOCABULARY: '選取的單字已不在目前詞庫，請重新建立這輪卡片。',
  };
  return messages[reason.code] ?? reason.message;
}

function formatArchiveTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '已保存';
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const ArticleResult = forwardRef<HTMLElement, {
  result: ArticleGenerationResult;
  selectedCards: StudyCard[];
  onCopy: () => void;
  onBackToArchive: () => void;
}>(({ result, selectedCards, onCopy, onBackToArchive }, ref) => {
  const paragraphs = result.article.body.split(/\n{2,}/).filter(Boolean);
  const translation = result.article.translationZh?.split(/\n{2,}/).filter(Boolean) ?? [];
  const usedWords = result.article.usedWords.length > 0
    ? result.article.usedWords
    : selectedCards.map((card) => card.displayHeadword);

  return (
    <article ref={ref} className="generated-article" aria-labelledby="generated-article-title">
      <header>
        <div>
          <p className="eyebrow">LOCAL AI READING</p>
          <h3 id="generated-article-title" lang="en">{result.article.title}</h3>
        </div>
        <div className="generated-article-actions">
          <button className="text-button" type="button" onClick={onBackToArchive}>歷史文章</button>
          <button className="quiet-button compact-button" type="button" onClick={onCopy}>複製</button>
        </div>
      </header>
      <div className="generated-copy" lang="en">
        {paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>)}
      </div>
      <div className="generated-words" aria-label="文章使用的目標單字">
        {usedWords.map((word) => <span key={word} lang="en">{word}</span>)}
      </div>
      {translation.length > 0 && (
        <details className="article-translation">
          <summary>查看中文翻譯</summary>
          <div>{translation.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>)}</div>
        </details>
      )}
      {result.article.questions.length > 0 && (
        <section className="article-questions" aria-labelledby="article-questions-title">
          <h4 id="article-questions-title">閱讀理解</h4>
          {result.article.questions.map((item, index) => (
            <details key={`${index}-${item.question}`}>
              <summary><span>{index + 1}</span><span lang="en">{item.question}</span></summary>
              <p lang="en">{item.answer}</p>
            </details>
          ))}
        </section>
      )}
      <footer>{result.meta.provider} · {result.meta.model}</footer>
    </article>
  );
});
