import { describe, expect, it } from 'vitest';
import {
  estimateSelection,
  getStudyPresetForRange,
  getStudyPresetForSelection,
  normalizeSelection,
  sanitizeSelection,
  toggleRangeSelection,
} from './range-utils';
import type { RangeDefinition } from './types';

const ranges: RangeDefinition[] = [
  { id: 'all', kind: 'all', name: '全部', parentId: null, status: 'complete', entryCount: 12, lexemeCount: 10 },
  { id: 'section:1', kind: 'section', name: 'SECTION 1', parentId: 'all', status: 'complete', entryCount: 12, lexemeCount: 10 },
  { id: 'unit:1', kind: 'unit', name: 'UNIT 1', parentId: 'section:1', status: 'complete', entryCount: 6, lexemeCount: 6 },
  { id: 'unit:2', kind: 'unit', name: 'UNIT 2', parentId: 'section:1', status: 'complete', entryCount: 7, lexemeCount: 7 },
  { id: 'group:1', kind: 'group', name: 'GROUP 1', parentId: 'unit:1', status: 'complete', entryCount: 3, lexemeCount: 3 },
  { id: 'batch:1:1', kind: 'level_batch', name: 'LEVEL 2｜隨機組 01（40）', parentId: 'unit:1', status: 'complete', entryCount: 40, lexemeCount: 40 },
  { id: 'batch:2:1', kind: 'level_batch', name: 'LEVEL 3｜隨機組 01（40）', parentId: 'unit:2', status: 'complete', entryCount: 40, lexemeCount: 40 },
];

describe('range selection', () => {
  it('uses a random 40-card preset for every CEEC level range', () => {
    expect(getStudyPresetForRange('source:ceec-108')).toEqual({ limit: 40, order: 'shuffle' });
    expect(getStudyPresetForRange('section:ceec-108:高中單字')).toEqual({ limit: 40, order: 'shuffle' });
    expect(getStudyPresetForRange('range:ceec-108:高中單字:u-level-2')).toEqual({ limit: 40, order: 'shuffle' });
    expect(getStudyPresetForRange('unit:1')).toBeNull();
  });

  it('treats all as an exclusive shortcut', () => {
    expect(toggleRangeSelection(['unit:1'], 'all')).toEqual(['all']);
    expect(toggleRangeSelection(['all'], 'unit:2')).toEqual(['unit:2']);
  });

  it('never leaves the selection empty', () => {
    expect(toggleRangeSelection(['unit:1'], 'unit:1')).toEqual(['all']);
  });

  it('can return a canonical selection when definitions are available', () => {
    expect(toggleRangeSelection(['unit:1'], 'section:1', ranges)).toEqual(['section:1']);
    expect(toggleRangeSelection(['section:1', 'unit:1'], 'section:1', ranges)).toEqual(['unit:1']);
  });

  it('caps the estimate at the known all-range size', () => {
    expect(estimateSelection(ranges, ['unit:1', 'unit:2'])).toBe(10);
  });

  it('normalizes duplicate and nested selections without changing the union', () => {
    expect(normalizeSelection(ranges, ['group:1', 'unit:1', 'section:1', 'section:1']))
      .toEqual(['section:1']);
    expect(normalizeSelection(ranges, ['unit:1', 'all'])).toEqual(['all']);
    expect(estimateSelection(ranges, ['section:1', 'unit:1', 'group:1'])).toBe(10);
  });

  it('keeps siblings for the backend to union precisely', () => {
    expect(normalizeSelection(ranges, ['unit:1', 'unit:2'])).toEqual(['unit:1', 'unit:2']);
    expect(normalizeSelection(ranges, ['batch:1:1', 'batch:2:1'])).toEqual(['batch:1:1', 'batch:2:1']);
    expect(getStudyPresetForSelection(ranges, ['batch:1:1', 'batch:2:1']))
      .toEqual({ limit: null, order: 'shuffle' });
  });

  it('drops range ids that no longer exist', () => {
    expect(sanitizeSelection(ranges, ['old:id', 'unit:2'])).toEqual(['unit:2']);
    expect(sanitizeSelection(ranges, ['old:id'])).toEqual(['all']);
    expect(sanitizeSelection(ranges, ['section:1', 'unit:1'])).toEqual(['section:1']);
  });
});
