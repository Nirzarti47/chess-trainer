import { expected, formatScore } from '../../analysis/score';
import type { Score, Side } from '../../domain/gameTypes';

/** Шкала перевеса слева от доски; повёрнута как доска: цвет владельца внизу. */
export function EvalBar({ score, bottom }: { score: Score; bottom: Side }) {
  const share = expected(score, bottom);
  const text = formatScore(score);
  // Число стоит на стороне того, у кого перевес.
  const ahead = share >= 0.5 ? 'bottom' : 'top';
  return (
    <div className={`eval-bar eval-bar--${bottom}`} aria-label="Перевес">
      <i className="eval-bar-fill" style={{ height: `${share * 100}%` }} />
      <span className={`eval-bar-text eval-bar-text--${ahead}`}>{text}</span>
    </div>
  );
}
