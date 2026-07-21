import { describe, expect, it } from 'vitest';
import { resolveSwipeRating } from './swipe-utils';

describe('flashcard swipe resolution', () => {
  it('uses the card-width threshold for a deliberate drag', () => {
    expect(resolveSwipeRating(92, 500, 360)).toBe('good');
    expect(resolveSwipeRating(-92, 500, 360)).toBe('again');
    expect(resolveSwipeRating(70, 500, 360)).toBeNull();
  });

  it('accepts a fast short swipe in the Android touch path', () => {
    expect(resolveSwipeRating(24, 30, 360)).toBe('good');
    expect(resolveSwipeRating(-24, 30, 360)).toBe('again');
  });

  it('ignores invalid or stationary gestures', () => {
    expect(resolveSwipeRating(0, 100, 360)).toBeNull();
    expect(resolveSwipeRating(Number.NaN, 100, 360)).toBeNull();
  });
});
