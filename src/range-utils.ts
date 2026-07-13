import type { RangeDefinition } from './types';

export function toggleRangeSelection(current: string[], rangeId: string): string[] {
  if (rangeId === 'all') return ['all'];
  const withoutAll = current.filter((id) => id !== 'all');
  if (withoutAll.includes(rangeId)) {
    const next = withoutAll.filter((id) => id !== rangeId);
    return next.length > 0 ? next : ['all'];
  }
  return [...withoutAll, rangeId];
}

export function estimateSelection(
  ranges: RangeDefinition[],
  selectedIds: string[],
): number {
  const all = ranges.find((range) => range.id === 'all')?.lexemeCount ?? 0;
  if (selectedIds.includes('all')) return all;
  const selected = new Set(selectedIds);
  const total = ranges.reduce(
    (sum, range) => sum + (selected.has(range.id) ? range.lexemeCount : 0),
    0,
  );
  return Math.min(all || total, total);
}

export function sanitizeSelection(
  ranges: RangeDefinition[],
  selectedIds: string[],
): string[] {
  const available = new Set(ranges.map((range) => range.id));
  const valid = selectedIds.filter((id) => available.has(id));
  return valid.length > 0 ? valid : ['all'];
}

export function compactRangeName(name: string): string {
  return name.replace(/^英單\s*1\s*[｜|]\s*/u, '').trim();
}
