import { describe, expect, it } from 'vitest';
import { displaySectionName } from './card-context';

describe('card context labels', () => {
  it('keeps a custom vocabulary collection name instead of calling it a prefix', () => {
    expect(displaySectionName('高中單字')).toBe('高中單字');
  });

  it('keeps the established affix labels and a safe uncategorized fallback', () => {
    expect(displaySectionName('prefix')).toBe('字首');
    expect(displaySectionName('root')).toBe('字根');
    expect(displaySectionName('suffix')).toBe('字尾');
    expect(displaySectionName(null)).toBe('自訂');
  });
});
