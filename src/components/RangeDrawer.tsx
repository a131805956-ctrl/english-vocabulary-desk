import { useMemo, useState } from 'react';
import {
  compactRangeName,
  estimateSelection,
  getStudyPresetForSelection,
  normalizeSelection,
  toggleRangeSelection,
} from '../range-utils';
import type { RangeDefinition, SessionMode, SessionOrder } from '../types';

interface RangeDrawerProps {
  open: boolean;
  ranges: RangeDefinition[];
  selectedIds: string[];
  limit: number | null;
  order: SessionOrder;
  mode: Exclude<SessionMode, 'problems'>;
  newLimit: number;
  starting: boolean;
  onToggle: (rangeId: string) => void;
  onLimitChange: (limit: number | null) => void;
  onOrderChange: (order: SessionOrder) => void;
  onModeChange: (mode: Exclude<SessionMode, 'problems'>) => void;
  onNewLimitChange: (limit: number) => void;
  onClose: () => void;
  onStart: () => void;
}

export function RangeDrawer({
  open,
  ranges,
  selectedIds,
  limit,
  order,
  mode,
  newLimit,
  starting,
  onToggle,
  onLimitChange,
  onOrderChange,
  onModeChange,
  onNewLimitChange,
  onClose,
  onStart,
}: RangeDrawerProps) {
  const [query, setQuery] = useState('');
  const sections = useMemo(
    () => ranges.filter((range) => range.kind === 'section'),
    [ranges],
  );
  const all = ranges.find((range) => range.id === 'all');
  const normalizedSelectedIds = useMemo(
    () => normalizeSelection(ranges, selectedIds),
    [ranges, selectedIds],
  );
  const estimate = estimateSelection(ranges, selectedIds);
  const actualSessionSize = limit === null ? estimate : Math.min(limit, estimate);
  const hasCeecSelection = normalizedSelectedIds.some((rangeId) => rangeId.startsWith('source:ceec-108')
    || rangeId.startsWith('section:ceec-108:')
    || rangeId.startsWith('range:ceec-108:'));
  const selectedBatchCount = normalizedSelectedIds.filter((rangeId) => ranges.some(
    (range) => range.id === rangeId && range.kind === 'level_batch',
  )).length;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (range: RangeDefinition) => !normalizedQuery || [range.name, range.id]
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalizedQuery);
  const visibleSections = sections.filter((section) => {
    if (matchesQuery(section)) return true;
    return ranges.some((range) => range.parentId === section.id && (
      matchesQuery(range) || ranges.some((child) => child.parentId === range.id && matchesQuery(child))
    ));
  });

  const handleRangeToggle = (rangeId: string) => {
    const next = toggleRangeSelection(selectedIds, rangeId, ranges);
    if (sameSelection(selectedIds, next)) return;

    const preset = getStudyPresetForSelection(ranges, next);
    const applyPreset = () => {
      if (!preset) return;
      onLimitChange(preset.limit);
      onOrderChange(preset.order);
    };

    if (next.includes('all')) {
      onToggle('all');
      return;
    }

    const current = new Set(selectedIds.filter((id) => id !== 'all'));
    const nextSet = new Set(next);

    // The parent owns the selection state and exposes a single-item toggle.
    // Add the intended scopes before removing obsolete ones so its non-empty
    // selection fallback never gets in the way of canonicalization.
    if (selectedIds.includes('all')) {
      const [first, ...rest] = next;
      if (!first) return;
      onToggle(first);
      rest.forEach(onToggle);
      applyPreset();
      return;
    }

    next.filter((id) => !current.has(id)).forEach(onToggle);
    [...current].filter((id) => !nextSet.has(id)).forEach(onToggle);
    applyPreset();
  };

  if (!open) return null;

  return (
    <div className="drawer-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="range-drawer" role="dialog" aria-modal="true" aria-labelledby="range-title">
        <header className="drawer-header">
          <div>
            <p className="eyebrow">BUILD A STUDY SET</p>
            <h2 id="range-title">選擇單字範圍</h2>
          </div>
          <button className="icon-button" type="button" aria-label="關閉範圍選擇" onClick={onClose}>×</button>
        </header>

        <div className="session-mode-switch" role="group" aria-label="複習模式">
          <button
            type="button"
            className={mode === 'today' ? 'is-active' : ''}
            aria-pressed={mode === 'today'}
            onClick={() => onModeChange('today')}
          >
            <b>今日複習</b>
            <span>到期卡優先，再加入新字</span>
          </button>
          <button
            type="button"
            className={mode === 'manual' ? 'is-active' : ''}
            aria-pressed={mode === 'manual'}
            onClick={() => onModeChange('manual')}
          >
            <b>自由練習</b>
            <span>照選取範圍直接出題</span>
          </button>
        </div>

        <div className={mode === 'today' ? 'range-controls is-today' : 'range-controls'}>
          <label>
            <span>{mode === 'today' ? '本輪上限' : '每輪張數'}</span>
            <select
              value={limit === null ? 'all' : String(limit)}
              onChange={(event) => onLimitChange(event.target.value === 'all' ? null : Number(event.target.value))}
            >
              <option value="20">20 張</option>
              <option value="40">40 張</option>
              <option value="80">80 張</option>
              <option value="all">全部</option>
            </select>
          </label>
          {mode === 'today' && (
            <label>
              <span>最多新字</span>
              <select value={newLimit} onChange={(event) => onNewLimitChange(Number(event.target.value))}>
                <option value="0">0 張</option>
                <option value="10">10 張</option>
                <option value="20">20 張</option>
                <option value="40">40 張</option>
                <option value="80">80 張</option>
              </select>
            </label>
          )}
          <label>
            <span>出題順序</span>
            <select value={order} onChange={(event) => onOrderChange(event.target.value as SessionOrder)}>
              <option value="source">照單字書</option>
              <option value="shuffle">隨機混合</option>
            </select>
          </label>
        </div>

        <div className="range-search">
          <label>
            <span className="sr-only">搜尋範圍</span>
            <input
              type="search"
              name="range-search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋 UNIT、詞素或分類"
            />
          </label>
          {query && (
            <button className="text-button" type="button" onClick={() => setQuery('')}>清除搜尋</button>
          )}
          <button className="quiet-button compact-button" type="button" onClick={() => handleRangeToggle('all')}>
            練全部
          </button>
        </div>

        <div className="range-tree" aria-label="可選單字範圍">
          {all && (
            <RangeCheckbox
              range={all}
              checked={selectedIds.includes('all')}
              onToggle={handleRangeToggle}
              emphasized
            />
          )}
          {visibleSections.map((section) => {
            const units = ranges.filter((range) => range.parentId === section.id && range.kind === 'unit');
            const sectionMatches = matchesQuery(section);
            const visibleUnits = units.filter((unit) => {
              if (sectionMatches || matchesQuery(unit)) return true;
              return ranges.some((group) => group.parentId === unit.id && matchesQuery(group));
            });
            return (
              <details className="range-branch" key={section.id} open>
                <summary>
                  <RangeCheckbox
                    range={section}
                    checked={selectedIds.includes(section.id)}
                    onToggle={handleRangeToggle}
                  />
                  <span className="disclosure" aria-hidden="true">⌄</span>
                </summary>
                <div className="unit-list">
                  {visibleUnits.map((unit) => {
                    const childRanges = ranges.filter((range) => range.parentId === unit.id && (
                      range.kind === 'group' || range.kind === 'level_batch'
                    ));
                    const visibleChildRanges = sectionMatches || matchesQuery(unit)
                      ? childRanges
                      : childRanges.filter(matchesQuery);
                    const levelBatchCount = visibleChildRanges.filter((range) => range.kind === 'level_batch').length;
                    return (
                      <details className="unit-branch" key={unit.id} open={Boolean(normalizedQuery) || undefined}>
                        <summary>
                          <RangeCheckbox
                            range={unit}
                            checked={selectedIds.includes(unit.id)}
                            onToggle={handleRangeToggle}
                          />
                          {visibleChildRanges.length > 0 && <span className="group-count">
                            {levelBatchCount > 0 ? `${levelBatchCount} 個隨機群組` : `${visibleChildRanges.length} 組`}
                          </span>}
                        </summary>
                        {visibleChildRanges.length > 0 && (
                          <div className="group-list">
                            {levelBatchCount > 0 && (
                              <p className="range-subheading">本 LEVEL 的隨機 40 張群組</p>
                            )}
                            {visibleChildRanges.map((group) => (
                              <RangeCheckbox
                                key={group.id}
                                range={group}
                                checked={selectedIds.includes(group.id)}
                                onToggle={handleRangeToggle}
                              />
                            ))}
                          </div>
                        )}
                      </details>
                    );
                  })}
                </div>
              </details>
            );
          })}
          {normalizedQuery && visibleSections.length === 0 && (
            <p className="range-search-empty">找不到符合的範圍。</p>
          )}
        </div>

        <footer className="drawer-footer">
          <div>
            <b>{normalizedSelectedIds.includes('all') ? '全部單字' : `${normalizedSelectedIds.length} 個範圍`}</b>
            <span>{hasCeecSelection && mode === 'manual'
              ? selectedBatchCount > 1
                ? `已選 ${selectedBatchCount} 個隨機群組，共 ${estimate} 張`
                : '高中單字：每輪隨機 40 張'
              : `聯集最多 ${estimate} 個，開始時精確去重`}
            </span>
          </div>
          <button
            type="button"
            className="start-button"
            disabled={starting || actualSessionSize === 0}
            onClick={onStart}
          >
            {starting
              ? '正在建立…'
              : mode === 'today'
                ? '建立今日複習'
                : hasCeecSelection && order === 'shuffle' && (limit === 40 || limit === null)
                  ? `隨機練習 · ${actualSessionSize} 張`
                  : `開始自由練習 · ${actualSessionSize} 張`}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function sameSelection(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function RangeCheckbox({
  range,
  checked,
  onToggle,
  emphasized = false,
}: {
  range: RangeDefinition;
  checked: boolean;
  onToggle: (rangeId: string) => void;
  emphasized?: boolean;
}) {
  const disabled = range.status === 'missing_source' || range.lexemeCount === 0;
  return (
    <label className={`range-option ${emphasized ? 'is-emphasized' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggle(range.id)}
      />
      <span className="custom-checkbox" aria-hidden="true" />
      <span className="range-copy">
        <b>{compactRangeName(range.name)}</b>
        {range.status === 'missing_source' && <small className="status-badge missing">來源缺頁</small>}
        {range.status === 'inferred_header' && <small className="status-badge inferred">推定分類</small>}
      </span>
      <span className="range-size">{range.lexemeCount}</span>
    </label>
  );
}
