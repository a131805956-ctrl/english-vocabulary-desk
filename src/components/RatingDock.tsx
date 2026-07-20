import type { ReviewRating } from '../types';

interface RatingDockProps {
  disabled: boolean;
  reviewing: boolean;
  hint: string;
  onRate: (rating: ReviewRating) => void;
}

export function RatingDock({ disabled, reviewing, hint, onRate }: RatingDockProps) {
  return (
    <div className="rating-dock" aria-label="回答評分">
      <button
        className="rating-button rating-again"
        type="button"
        disabled={disabled || reviewing}
        onClick={() => onRate('again')}
      >
        <span className="rating-arrow" aria-hidden="true">←</span>
        <span>
          <small>還想不起來</small>
          不知道
        </span>
        <kbd>A</kbd>
      </button>
      <p aria-live="polite">{reviewing ? '正在保存…' : hint}</p>
      <button
        className="rating-button rating-good"
        type="button"
        disabled={disabled || reviewing}
        onClick={() => onRate('good')}
      >
        <kbd>G</kbd>
        <span>
          <small>能主動回想</small>
          知道
        </span>
        <span className="rating-arrow" aria-hidden="true">→</span>
      </button>
    </div>
  );
}
