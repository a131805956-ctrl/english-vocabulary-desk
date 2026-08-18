import { describe, expect, it } from 'vitest';
import {
  addVisibleWordsToSelection,
  isArchiveActionLocked,
  removeSelectedWord,
  translationDisplayState,
  toggleVisibleWordsSelection,
} from './ArticlePanel';

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

describe('article selection interactions', () => {
  it('clears the visible subset when every visible word is already selected', () => {
    expect(toggleVisibleWordsSelection(
      ['lexeme:one', 'lexeme:two', 'lexeme:keep'],
      ['lexeme:one', 'lexeme:two'],
      12,
    )).toEqual(['lexeme:keep']);
  });

  it('removes one selected word without changing the remaining order', () => {
    expect(removeSelectedWord(
      ['lexeme:one', 'lexeme:two', 'lexeme:three'],
      'lexeme:two',
    )).toEqual(['lexeme:one', 'lexeme:three']);
  });
});

describe('article translation display', () => {
  it('keeps generated Chinese translation visible by default', () => {
    expect(translationDisplayState('第一段\n\n第二段')).toEqual({
      hasTranslation: true,
      paragraphs: ['第一段', '第二段'],
      notice: null,
    });
  });

  it('explains when the model omitted the translation', () => {
    expect(translationDisplayState(null)).toEqual({
      hasTranslation: false,
      paragraphs: [],
      notice: '尚未取得中文翻譯，請重新生成文章。',
    });
  });
});
