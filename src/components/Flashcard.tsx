import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type TouchEvent,
} from 'react';
import type { ReviewRating, StudyCard } from '../types';
import { resolveSwipeRating } from '../swipe-utils';

interface FlashcardProps {
  card: StudyCard;
  flipped: boolean;
  disabled: boolean;
  onFlip: () => void;
  onRate: (rating: ReviewRating) => void;
  onSpeak: () => void;
}

interface DragOrigin {
  x: number;
  time: number;
  source: 'pointer' | 'touch';
}

const SWIPE_EXIT_MS = 190;

export const Flashcard = forwardRef<HTMLButtonElement, FlashcardProps>(
  function Flashcard(
    { card, flipped, disabled, onFlip, onRate, onSpeak },
    ref,
  ) {
    const [dragX, setDragX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const origin = useRef<DragOrigin | null>(null);
    const suppressClick = useRef(false);
    const settleTimer = useRef<number | null>(null);
    const tokens = parseEtymology(card.primary.etymology);
    const pronunciation = formatPronunciation(card.primary.pronunciation);
    const position = card.primary.partsOfSpeech.join(' · ');
    const dragStyle = {
      '--drag-x': `${dragX}px`,
      '--drag-rotate': `${dragX / 55}deg`,
      '--drag-transition': isDragging
        ? 'none'
        : `transform ${SWIPE_EXIT_MS}ms cubic-bezier(0.16, 0.82, 0.24, 1), filter 160ms ease`,
    } as CSSProperties;

    useEffect(() => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    }, []);

    useEffect(() => {
      // The component is intentionally reused for the next card. Never carry
      // the previous card's off-screen exit transform into the new card.
      origin.current = null;
      setDragX(0);
      setIsDragging(false);
    }, [card.lexemeId]);

    const resetDrag = () => {
      origin.current = null;
      setIsDragging(false);
      setDragX(0);
    };

    const finishDrag = (finalDragX: number, elapsedMs: number, width: number) => {
      const rating = resolveSwipeRating(finalDragX, elapsedMs, width);
      if (!rating) {
        resetDrag();
        return;
      }

      // Complete the full flight first, then let the parent persist and move
      // to the next card. This keeps a fast flick visually complete instead
      // of snapping back to the center before the card changes.
      suppressClick.current = true;
      origin.current = null;
      setIsDragging(false);
      setDragX(finalDragX > 0 ? Math.max(width * 1.25, 480) : -Math.max(width * 1.25, 480));
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null;
        onRate(rating);
      }, SWIPE_EXIT_MS);
    };

    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
      // Android WebView can deliver a touch gesture through TouchEvent rather
      // than completing the PointerEvent sequence. Let the explicit touch
      // fallback below own touch pointers so the two paths never double-rate.
      if (disabled || event.pointerType === 'touch' || event.pointerType === 'mouse' && event.button !== 0) return;
      origin.current = { x: event.clientX, time: performance.now(), source: 'pointer' };
      setIsDragging(true);
      suppressClick.current = false;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A few embedded WebViews expose pointer events without pointer capture.
      }
    };

    const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
      if (!origin.current || origin.current.source !== 'pointer' || event.pointerType === 'touch' || disabled) return;
      const nextX = event.clientX - origin.current.x;
      if (Math.abs(nextX) > 8) suppressClick.current = true;
      setDragX(nextX);
    };

    const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
      const dragOrigin = origin.current;
      if (!dragOrigin || dragOrigin.source !== 'pointer' || event.pointerType === 'touch') return;
      // React may not have committed the final pointer-move state yet. Calculate
      // from the pointer-up event so fast mobile swipes always use their true delta.
      const finalDragX = event.clientX - dragOrigin.x;
      if (Math.abs(finalDragX) > 8) suppressClick.current = true;
      finishDrag(finalDragX, performance.now() - dragOrigin.time, event.currentTarget.offsetWidth);
    };

    const handleTouchStart = (event: TouchEvent<HTMLButtonElement>) => {
      if (disabled || origin.current) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      origin.current = { x: touch.clientX, time: performance.now(), source: 'touch' };
      setIsDragging(true);
      suppressClick.current = false;
    };

    const handleTouchMove = (event: TouchEvent<HTMLButtonElement>) => {
      const dragOrigin = origin.current;
      if (!dragOrigin || dragOrigin.source !== 'touch' || disabled) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      event.preventDefault();
      const nextX = touch.clientX - dragOrigin.x;
      if (Math.abs(nextX) > 8) suppressClick.current = true;
      setDragX(nextX);
    };

    const finishTouch = (event: TouchEvent<HTMLButtonElement>) => {
      const dragOrigin = origin.current;
      if (!dragOrigin || dragOrigin.source !== 'touch') return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const finalDragX = touch.clientX - dragOrigin.x;
      if (Math.abs(finalDragX) > 8) suppressClick.current = true;
      finishDrag(finalDragX, performance.now() - dragOrigin.time, event.currentTarget.offsetWidth);
    };

    return (
      <div className="flashcard-stage">
        <div
          className={`drag-cue drag-cue-again ${dragX < -24 ? 'is-visible' : ''}`}
          aria-hidden="true"
        >
          ← 不知道
        </div>
        <div
          className={`drag-cue drag-cue-good ${dragX > 24 ? 'is-visible' : ''}`}
          aria-hidden="true"
        >
          知道 →
        </div>
        <button
          ref={ref}
          type="button"
          className={`flashcard ${flipped ? 'is-flipped' : ''}`}
          style={dragStyle}
          aria-describedby="flashcard-instruction"
          disabled={disabled}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            onFlip();
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={(event) => {
            if (origin.current?.source === 'pointer') resetDrag();
            try {
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            } catch {
              // Ignore a capture that the embedded WebView did not grant.
            }
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={finishTouch}
          onTouchCancel={() => {
            if (origin.current?.source === 'touch') resetDrag();
          }}
        >
          <span id="flashcard-instruction" className="sr-only">
            點擊卡片翻面；也可以向左或向右滑動評分。
          </span>
          <span className="morpheme-spine" aria-hidden="true" />
          <span className="flashcard-inner">
            <span className="card-face card-front" aria-hidden={flipped}>
              <span className="card-index">ACTIVE RECALL</span>
              <span className="card-front-center">
                <span className="headword" lang="en">{card.displayHeadword}</span>
                <span className="pronunciation" lang="en">{pronunciation}</span>
                {position && <span className="part-of-speech">{position}</span>}
              </span>
              <span className="flip-hint">點卡查看答案，或直接滑動／點按評分</span>
            </span>

            <span className="card-face card-back" aria-hidden={!flipped}>
              <span className="card-back-topline">
                <span className="card-index">DECODED</span>
                <span className="back-headword" lang="en">{card.displayHeadword}</span>
              </span>
              <span className="definition" lang="zh-Hant">{card.primary.definitionZh}</span>

              {tokens.length > 0 && (
                <span className="morpheme-grid" aria-label="詞素拆解">
                  {tokens.map((token, index) => (
                    <span className="morpheme-token" key={`${token.form}-${index}`}>
                      <b lang="en">{token.form}</b>
                      <small>{token.meaning}</small>
                    </span>
                  ))}
                </span>
              )}

              {(card.primary.relationType || card.primary.relationTerm) && (
                <span className="relation-line">
                  {card.primary.relationType || '相關'}
                  <b lang="en">{card.primary.relationTerm}</b>
                </span>
              )}

              {card.primary.exampleEn && (
                <span className="example-block">
                  <span lang="en">{card.primary.exampleEn}</span>
                  {card.primary.exampleZh && <small lang="zh-Hant">{card.primary.exampleZh}</small>}
                </span>
              )}
            </span>
          </span>
        </button>

        <button
          className="pronounce-button"
          type="button"
          aria-label={`播放 ${card.displayHeadword} 發音`}
          onClick={onSpeak}
          disabled={disabled}
        >
          <SpeakerIcon />
          <span className="sr-only">播放發音</span>
        </button>
      </div>
    );
  },
);

function formatPronunciation(value: string | null): string {
  if (!value) return '';
  return `/${value.replace(/`/gu, 'ˈ').replace(/^\/+|\/+$/gu, '')}/`;
}

function parseEtymology(value: string | null): Array<{ form: string; meaning: string }> {
  if (!value) return [];
  return value.split(/\s*\+\s*/u).filter(Boolean).map((part) => {
    const [form, ...meaning] = part.trim().split(/\s+/u);
    return { form, meaning: meaning.join(' ') || '詞素' };
  });
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9v6h4l5 4V5L9 9H5Z" />
      <path d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" />
    </svg>
  );
}
