import { useMemo } from 'react';
import { compactRangeName, estimateSelection } from '../range-utils';
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
  const sections = useMemo(
    () => ranges.filter((range) => range.kind === 'section'),
    [ranges],
  );
  const all = ranges.find((range) => range.id === 'all');
  const estimate = estimateSelection(ranges, selectedIds);
  const actualSessionSize = limit === null ? estimate : Math.min(limit, estimate);

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

        <div className="range-tree">
          {all && (
            <RangeCheckbox
              range={all}
              checked={selectedIds.includes('all')}
              onToggle={onToggle}
              emphasized
            />
          )}
          {sections.map((section) => {
            const units = ranges.filter((range) => range.parentId === section.id && range.kind === 'unit');
            return (
              <details className="range-branch" key={section.id} open>
                <summary>
                  <RangeCheckbox
                    range={section}
                    checked={selectedIds.includes(section.id)}
                    onToggle={onToggle}
                  />
                  <span className="disclosure" aria-hidden="true">⌄</span>
                </summary>
                <div className="unit-list">
                  {units.map((unit) => {
                    const groups = ranges.filter((range) => range.parentId === unit.id && range.kind === 'group');
                    return (
                      <details className="unit-branch" key={unit.id}>
                        <summary>
                          <RangeCheckbox
                            range={unit}
                            checked={selectedIds.includes(unit.id)}
                            onToggle={onToggle}
                          />
                          {groups.length > 0 && <span className="group-count">{groups.length} 組</span>}
                        </summary>
                        {groups.length > 0 && (
                          <div className="group-list">
                            {groups.map((group) => (
                              <RangeCheckbox
                                key={group.id}
                                range={group}
                                checked={selectedIds.includes(group.id)}
                                onToggle={onToggle}
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
        </div>

        <footer className="drawer-footer">
          <div>
            <b>{selectedIds.includes('all') ? '全部單字' : `${selectedIds.length} 個範圍`}</b>
            <span>聯集最多 {estimate} 個，開始時精確去重</span>
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
                : `開始自由練習 · ${actualSessionSize} 張`}
          </button>
        </footer>
      </aside>
    </div>
  );
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
