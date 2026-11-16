import { Chess } from 'chess.js';
import { ruSan } from '../../analysis/notation';
import { GRADE_TITLE, MARK_TITLE } from '../../analysis/phrases';
import { formatScore } from '../../analysis/score';
import type { AltMove } from '../../domain/gameTypes';
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

/** Карточка хода: оценка словом и цветом, запись хода, фраза, «Лучше было». */
export function MoveCard({ view, beforeFen, alts, chosen, onChoose }: MoveCardProps) {
  const r = view.review;
  if (!r || !beforeFen) {
    return (
      <div className="move-card" data-testid="move-card">
        <p className="move-card-start">Начало партии</p>
      </div>
    );
  }
  const tone = r.mark ?? r.grade;
  const title = r.mark ? MARK_TITLE[r.mark] : GRADE_TITLE[r.grade];
  // Сыгран лучший ход и других хороших нет — показывать нечего.
  const showAlts = alts.length > 0 && !(alts.length === 1 && alts[0].move === r.move);
  return (
    <div className="move-card" data-testid="move-card">
      <p className="move-card-head">
        <span className="move-card-grade" style={{ background: `var(--grade-${tone})` }}>{title}</span>
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
