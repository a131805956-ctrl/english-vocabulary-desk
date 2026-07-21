import type { ReviewRating } from './types';

/**
 * Convert a completed horizontal drag into the review rating it represents.
 * Keeping this calculation independent from DOM events makes touch and
 * PointerEvent paths behave identically in Android WebView and browsers.
 */
export function resolveSwipeRating(
  deltaX: number,
  elapsedMs: number,
  cardWidth: number,
): ReviewRating | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(elapsedMs) || !Number.isFinite(cardWidth)) {
    return null;
  }
  const elapsed = Math.max(1, elapsedMs);
  const velocity = deltaX / elapsed;
  const threshold = Math.max(72, cardWidth * 0.22);
  const shouldRate = Math.abs(deltaX) >= threshold || Math.abs(velocity) >= 0.55;
  if (!shouldRate || deltaX === 0) return null;
  return deltaX > 0 ? 'good' : 'again';
}
