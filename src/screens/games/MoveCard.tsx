import { Chess } from 'chess.js';
import { ruSan } from '../../analysis/notation';
import { CATEGORY_TITLE } from '../../analysis/phrases';
import { formatScore } from '../../analysis/score';
import type { AltMove } from '../../domain/gameTypes';
import { CategoryIcon } from '../../ui/CategoryIcon';
import type { PlyView } from './reviewModel';

/** Ход в UCI из позиции fen → русская запись. */
export function ruMove(fen: string, uci: string): string {
  try {
    return ruSan(new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
  } catch {
    return uci;
  }
}

interface MoveCardProps {
  view: PlyView;
  /** Позиция перед ходом: из неё записываются варианты. */
  beforeFen: string | null;
  alts: AltMove[];
  chosen: number | null;
  onChoose(index: number | null): void;
}

/** Карточка хода: вид хода значком, словом и цветом, запись хода, фраза, «Лучше было». */
export function MoveCard({ view, beforeFen, alts, chosen, onChoose }: MoveCardProps) {
  const r = view.review;
  const category = view.category;
  if (!r || !beforeFen || !category) {
    return (
      <div className="move-card" data-testid="move-card">
        <p className="move-card-start">Начало партии</p>
      </div>
    );
  }
  // Сыгран лучший ход и других хороших нет — показывать нечего.
  const showAlts = alts.length > 0 && !(alts.length === 1 && alts[0].move === r.move);
  return (
    <div className="move-card" data-testid="move-card">
      <p className="move-card-head">
        <span className="move-card-grade">
          <CategoryIcon category={category} size={18} decorative />
          <span className="move-card-grade-name" style={{ color: `var(--cat-${category})` }}>{CATEGORY_TITLE[category]}</span>
        </span>
        <b className="move-card-move">{view.label}</b>
      </p>
      {r.phrase && <p className="move-card-phrase">{r.phrase}</p>}
      {showAlts && (
        <div className="move-card-alts">
          <p className="move-card-lab">Лучше было</p>
          {alts.map((a, i) => (
            <button
              key={a.move}
              type="button"
              className={`move-card-alt${chosen === i ? ' move-card-alt--on' : ''}`}
              aria-pressed={chosen === i}
              onClick={() => onChoose(chosen === i ? null : i)}
            >
              <b>{ruMove(beforeFen, a.move)}</b>
              {a.move === r.move && <span className="move-card-same"> — как в партии</span>}
              <small>{formatScore(a.score)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
