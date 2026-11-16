import { Chess } from 'chess.js';
import { CONFIG } from '../../analysis/config';
import { moveLabel } from '../../analysis/notation';
import { expected } from '../../analysis/score';
import type { AltMove, GameAnalysis, GameRecord, MoveReview, Score, Side } from '../../domain/gameTypes';

/** Одна позиция партии на экране разбора. */
export interface PlyView {
  fen: string;
  lastMove: [string, string] | null;
  score: Score;
  review: MoveReview | null /* ход, приведший к позиции; null в начальной */;
  label: string | null;
}

/** Кто делает ход номер ply (0 — первый ход белых). */
export const moverOf = (ply: number): Side => (ply % 2 === 0 ? 'white' : 'black');

/** Позиции партии: начальная и после каждого полухода. */
export function buildPlyViews(game: GameRecord, a: GameAnalysis): PlyView[] {
  const chess = new Chess();
  const reviews = new Map(a.moves.map((m) => [m.ply, m]));
  const views: PlyView[] = [{ fen: chess.fen(), lastMove: null, score: a.scores[0], review: null, label: null }];
  game.moves.forEach((uci, ply) => {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const san = chess.move({ from, to, promotion: uci[4] }).san;
    views.push({
      fen: chess.fen(), lastMove: [from, to], score: a.scores[ply + 1],
      review: reviews.get(ply) ?? null, label: moveLabel(ply, san),
    });
  });
  return views;
}

/** Варианты «Лучше было»: лучший ход и те, что уступают ему меньше ALT_MAX_LOSS; не больше трёх. */
export function alternatives(review: MoveReview, mover: Side): AltMove[] {
  const [first] = review.best;
  if (!first) return [];
  const top = expected(first.score, mover);
  return review.best.filter((m) => top - expected(m.score, mover) < CONFIG.ALT_MAX_LOSS).slice(0, 3);
}

/** Позиция после следующей ошибки или грубой ошибки владельца позже позиции fromPly; null — таких нет. */
export function nextUserMistake(a: GameAnalysis, userColor: Side, fromPly: number): number | null {
  const found = a.moves
    .filter((m) => m.ply + 1 > fromPly && moverOf(m.ply) === userColor && (m.grade === 'mistake' || m.grade === 'blunder'))
    .map((m) => m.ply + 1);
  return found.length > 0 ? Math.min(...found) : null;
}

/** Точки графика: доля белых 0..1 для каждой позиции. */
export function chartPoints(a: GameAnalysis): number[] {
  return a.scores.map((s) => expected(s, 'white'));
}

const BADGE: Partial<Record<NonNullable<MoveReview['mark']> | MoveReview['grade'], string>> = {
  brilliant: '!!', great: '!', inaccuracy: '?!', mistake: '?', blunder: '??',
};

export const badgeText = (r: MoveReview): string | null => BADGE[r.mark ?? r.grade] ?? null;
