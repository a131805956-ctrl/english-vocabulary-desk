import { describe, expect, it } from 'vitest';
import { addVisibleWordsToSelection, isArchiveActionLocked } from './ArticlePanel';

describe('addVisibleWordsToSelection', () => {
  it('adds only visible candidates without exceeding the article word limit', () => {
    const selection = addVisibleWordsToSelection(
      ['lexeme:already', 'lexeme:kept'],
      ['lexeme:kept', 'lexeme:one', 'lexeme:two', 'lexeme:three'],
      4,
    );

    expect(selection).toEqual([
      'lexeme:already',
      'lexeme:kept',
      'lexeme:one',
      'lexeme:two',
    ]);
  });

  it('keeps the existing choice unchanged when it has reached the cap', () => {
    const atCap = Array.from({ length: 12 }, (_, index) => `lexeme:${index}`);

    expect(addVisibleWordsToSelection(atCap, ['lexeme:new'])).toEqual(atCap);
  });
});

describe('isArchiveActionLocked', () => {
  it('locks archive interactions while a deletion request is pending', () => {
    expect(isArchiveActionLocked(null, 'article:pending')).toBe(true);
    expect(isArchiveActionLocked('article:opening', null)).toBe(true);
    expect(isArchiveActionLocked(null, null)).toBe(false);
  });
});
