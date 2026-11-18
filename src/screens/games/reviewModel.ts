import { Chess, type Square } from 'chess.js';
import { CONFIG } from '../../analysis/config';
import { moveLabel } from '../../analysis/notation';
import type { Category } from '../../analysis/report';
import { expected } from '../../analysis/score';
import type { AltMove, GameAnalysis, GameRecord, MoveReview, Score, Side } from '../../domain/gameTypes';

/** Одна позиция партии на экране разбора. */
export interface PlyView {
  fen: string;
  lastMove: [string, string] | null;
  score: Score;
  review: MoveReview | null /* ход, приведший к позиции; null в начальной */;
  label: string | null;
  /** Вид хода, приведшего к позиции; null в начальной. */
  category: Category | null;
}

/** Разбор пригоден для показа: оценки есть и их ровно на одну больше, чем ходов в партии. */
export const isAnalysisUsable = (game: GameRecord, analysis: GameAnalysis): boolean =>
  Array.isArray(analysis.scores) && analysis.scores.length === game.moves.length + 1;

/** Кто делает ход номер ply (0 — первый ход белых). */
export const moverOf = (ply: number): Side => (ply % 2 === 0 ? 'white' : 'black');

/** Позиции партии: начальная и после каждого полухода. */
export function buildPlyViews(game: GameRecord, a: GameAnalysis, categories: Category[]): PlyView[] {
  const chess = new Chess();
  const reviews = new Map(a.moves.map((m) => [m.ply, m]));
  const views: PlyView[] = [{ fen: chess.fen(), lastMove: null, score: a.scores[0], review: null, label: null, category: null }];
  game.moves.forEach((uci, ply) => {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const san = chess.move({ from, to, promotion: uci[4] }).san;
    views.push({
      fen: chess.fen(), lastMove: [from, to], score: a.scores[ply + 1],
      review: reviews.get(ply) ?? null, label: moveLabel(ply, san), category: categories[ply] ?? null,
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

/** Виды «плохих» ходов: подсветка поля и «Следующая ошибка». */
export const BAD_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['mistake', 'miss', 'blunder']);

/** Позиция после следующей ошибки, упущенной возможности или зевка владельца позже позиции fromPly; null — таких нет.
 *  categories[i] — вид хода i. */
export function nextUserMistake(categories: Category[], userColor: Side, fromPly: number): number | null {
  const i = categories.findIndex((c, ply) => ply + 1 > fromPly && moverOf(ply) === userColor && BAD_CATEGORIES.has(c));
  return i < 0 ? null : i + 1;
}

/** Точки графика: доля белых 0..1 для каждой позиции. */
export function chartPoints(a: GameAnalysis): number[] {
  return a.scores.map((s) => expected(s, 'white'));
}

/** Стрелка лучшего хода на позиции после сыгранного: только если на поле «откуда» стоит та же фигура, что до хода. */
export function bestArrowVisible(beforeFen: string, afterFen: string, bestUci: string): boolean {
  const from = bestUci.slice(0, 2) as Square;
  const was = new Chess(beforeFen).get(from);
  const now = new Chess(afterFen).get(from);
  return !!was && !!now && was.type === now.type && was.color === now.color;
}
