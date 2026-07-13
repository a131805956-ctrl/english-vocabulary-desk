interface SessionHeaderProps {
  rangeLabel: string;
  current: number;
  total: number;
  available: number;
  loading: boolean;
  onOpenRanges: () => void;
}

export function SessionHeader({
  rangeLabel,
  current,
  total,
  available,
  loading,
  onOpenRanges,
}: SessionHeaderProps) {
  const progress = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <header className="session-header">
      <div>
        <p className="eyebrow">MORPHEME DESK · 英單 1</p>
        <h1>{rangeLabel}</h1>
        <p className="session-subtitle">
          {loading ? '正在整理這輪單字…' : `${available.toLocaleString()} 個可用單字 · 合併範圍自動去重`}
        </p>
      </div>
      <div className="session-header-actions">
        <div className="session-count" aria-label={`進度 ${current} / ${total}`}>
          <span>{String(current).padStart(2, '0')}</span>
          <i aria-hidden="true">/</i>
          <span>{String(total).padStart(2, '0')}</span>
        </div>
        <button className="quiet-button" type="button" onClick={onOpenRanges}>
          更改範圍
        </button>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </header>
  );
}
