import { describe, expect, it } from 'vitest';
import { estimateSelection, sanitizeSelection, toggleRangeSelection } from './range-utils';
import type { RangeDefinition } from './types';

const ranges: RangeDefinition[] = [
  { id: 'all', kind: 'all', name: '全部', parentId: null, status: 'complete', entryCount: 12, lexemeCount: 10 },
  { id: 'unit:1', kind: 'unit', name: 'UNIT 1', parentId: 'section:1', status: 'complete', entryCount: 6, lexemeCount: 6 },
  { id: 'unit:2', kind: 'unit', name: 'UNIT 2', parentId: 'section:1', status: 'complete', entryCount: 7, lexemeCount: 7 },
];

describe('range selection', () => {
  it('treats all as an exclusive shortcut', () => {
    expect(toggleRangeSelection(['unit:1'], 'all')).toEqual(['all']);
    expect(toggleRangeSelection(['all'], 'unit:2')).toEqual(['unit:2']);
  });

  it('never leaves the selection empty', () => {
    expect(toggleRangeSelection(['unit:1'], 'unit:1')).toEqual(['all']);
  });

  it('caps the estimate at the known all-range size', () => {
    expect(estimateSelection(ranges, ['unit:1', 'unit:2'])).toBe(10);
  });

  it('drops range ids that no longer exist', () => {
    expect(sanitizeSelection(ranges, ['old:id', 'unit:2'])).toEqual(['unit:2']);
    expect(sanitizeSelection(ranges, ['old:id'])).toEqual(['all']);
  });
});
