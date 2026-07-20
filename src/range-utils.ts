import type { RangeDefinition, SessionOrder } from './types';

export interface StudyPreset {
  limit: number | null;
  order: SessionOrder;
}

export function getStudyPresetForRange(
  rangeId: string,
): StudyPreset | null {
  const isCeecLevelRange = rangeId === 'source:ceec-108'
    || rangeId.startsWith('section:ceec-108:')
    || rangeId.startsWith('range:ceec-108:');

  return isCeecLevelRange ? { limit: 40, order: 'shuffle' } : null;
}

export function getStudyPresetForSelection(
  ranges: RangeDefinition[],
  selectedIds: string[],
): StudyPreset | null {
  const normalizedIds = normalizeSelection(ranges, selectedIds);
  const selected = ranges.filter((range) => normalizedIds.includes(range.id));
  const levelBatches = selected.filter((range) => range.kind === 'level_batch');

  // A single batch is exactly one 40-card round. Several explicit batches
  // should keep their full union instead of being silently sliced to 40.
  if (levelBatches.length >= 2 && selected.every((range) => range.kind === 'level_batch')) {
    return { limit: null, order: 'shuffle' };
  }

  return selected.map((range) => getStudyPresetForRange(range.id)).find((value) => value !== null) ?? null;
}

export function toggleRangeSelection(
  current: string[],
  rangeId: string,
  ranges?: RangeDefinition[],
): string[] {
  if (rangeId === 'all') return ['all'];
  const withoutAll = [...new Set(current.filter((id) => id !== 'all'))];
  if (withoutAll.includes(rangeId)) {
    const next = withoutAll.filter((id) => id !== rangeId);
    const selection = next.length > 0 ? next : ['all'];
    return ranges ? normalizeSelection(ranges, selection) : selection;
  }
  const selection = [...withoutAll, rangeId];
  return ranges ? normalizeSelection(ranges, selection) : selection;
}

/**
 * Removes selections that cannot add any lexemes to the backend's union.
 *
 * Range definitions form a containment tree, so a selected ancestor already
 * covers every selected descendant. We deliberately do not collapse siblings:
 * their lexeme overlap is only known to the backend, which selects with
 * `DISTINCT lexeme_id`.
 */
export function normalizeSelection(
  ranges: RangeDefinition[],
  selectedIds: string[],
): string[] {
  const rangesById = new Map(ranges.map((range) => [range.id, range]));
  const validIds = [...new Set(selectedIds.filter((id) => rangesById.has(id)))];

  if (validIds.includes('all')) return ['all'];

  const selected = new Set(validIds);
  return validIds.filter((id) => !hasSelectedAncestor(id, selected, rangesById));
}

function hasSelectedAncestor(
  rangeId: string,
  selected: Set<string>,
  rangesById: Map<string, RangeDefinition>,
): boolean {
  const seen = new Set<string>([rangeId]);
  let parentId = rangesById.get(rangeId)?.parentId;

  while (parentId && !seen.has(parentId)) {
    if (selected.has(parentId)) return true;
    seen.add(parentId);
    parentId = rangesById.get(parentId)?.parentId;
  }

  return false;
}

export function estimateSelection(
  ranges: RangeDefinition[],
  selectedIds: string[],
): number {
  const all = ranges.find((range) => range.id === 'all')?.lexemeCount ?? 0;
  const selected = new Set(normalizeSelection(ranges, selectedIds));
  if (selected.has('all')) return all;
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
  const normalized = normalizeSelection(ranges, selectedIds);
  return normalized.length > 0 ? normalized : ['all'];
}

export function compactRangeName(name: string): string {
  return name.replace(/^英單\s*1\s*[｜|]\s*/u, '').trim();
}
