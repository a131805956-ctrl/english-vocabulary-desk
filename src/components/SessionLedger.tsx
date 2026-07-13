import type { ReviewSummary, StudySession } from '../types';

interface SessionLedgerProps {
  summary: ReviewSummary | null;
  session: StudySession | null;
  activeRangeCount: number;
  available: number;
  orderLabel: string;
  onOpenRanges: () => void;
  onOpenStats: () => void;
}

export function SessionLedger({
  summary,
  session,
  activeRangeCount,
  available,
  orderLabel,
  onOpenRanges,
  onOpenStats,
}: SessionLedgerProps) {
  return (
    <aside className="session-ledger" aria-label="本次範圍摘要">
      <div className="ledger-heading">
        <p className="eyebrow">SESSION LEDGER</p>
        <h2>本次範圍</h2>
      </div>
      <dl className="scope-facts">
        <div>
          <dt>學習模式</dt>
          <dd className="text-value">{modeLabel(session?.mode)}</dd>
        </div>
        <div>
          <dt>本輪卡片</dt>
          <dd>{session?.cards.length ?? 0}<small>{activeRangeCount} 範圍 · {available} 字</small></dd>
        </div>
        <div>
          <dt>出題順序</dt>
          <dd className="text-value">{orderLabel}</dd>
        </div>
      </dl>
      <div className="ledger-rule" />
      <dl className="review-facts">
        <div>
          <dt>{session?.mode === 'today' ? '本輪到期' : '現在到期'}</dt>
          <dd>{session?.mode === 'today' ? session.plan.due : summary?.dueNow ?? '—'}</dd>
        </div>
        <div>
          <dt>{session?.mode === 'today' ? '本輪新卡' : session?.mode === 'problems' ? '本輪錯題' : '尚未複習'}</dt>
          <dd>{session?.mode === 'today'
            ? session.plan.new
            : session?.mode === 'problems'
              ? session.plan.problems
              : summary?.unreviewedLexemes ?? '—'}</dd>
        </div>
        <div>
          <dt>已記錄次數</dt>
          <dd>{summary?.totalReviews ?? '—'}</dd>
        </div>
      </dl>
      <div className="ledger-actions">
        <button type="button" className="primary-button" onClick={onOpenRanges}>
          選擇其他範圍
        </button>
        <button type="button" className="text-button" onClick={onOpenStats}>
          查看錯題與記錄 →
        </button>
      </div>
      <p className="ledger-note">單字內容唯讀；學習進度另存於這台電腦。</p>
    </aside>
  );
}

function modeLabel(mode: StudySession['mode'] | undefined): string {
  if (mode === 'today') return '今日複習';
  if (mode === 'problems') return '錯題專練';
  return '自由練習';
}
