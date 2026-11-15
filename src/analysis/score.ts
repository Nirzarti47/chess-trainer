import type { Score, Side } from '../domain/gameTypes';
import type { UciScore } from '../engine/analysisEngine';

/** Оценка движка (с точки зрения стороны, чей ход) → оценка с точки зрения белых. */
export function toWhite(score: UciScore, turn: Side): Score {
  const k = turn === 'white' ? 1 : -1;
  return 'mate' in score ? { mate: score.mate * k } : { cp: score.cp * k };
}

/** Ожидаемый результат стороны, 0..1. */
export function expected(score: Score, side: Side): number {
  let white: number;
  if ('cp' in score) white = 1 / (1 + Math.exp(-0.00368208 * score.cp));
  else if ('mate' in score) white = score.mate > 0 ? 1 : 0;
  else white = score.over === 'white' ? 1 : score.over === 'black' ? 0 : 0.5;
  return side === 'white' ? white : 1 - white;
}

export function lossOf(before: Score, after: Score, mover: Side): number {
  return Math.max(0, expected(before, mover) - expected(after, mover));
}

export function moveAccuracy(loss: number): number {
  return Math.min(100, Math.max(0, 103.1668 * Math.exp(-4.354 * loss) - 3.1669));
}

export function formatScore(score: Score): string {
  if ('mate' in score) return `${score.mate < 0 ? '−' : ''}М${Math.abs(score.mate)}`;
  if ('over' in score) return score.over === 'white' ? '1–0' : score.over === 'black' ? '0–1' : '½–½';
  const pawns = (Math.abs(score.cp) / 100).toFixed(1).replace('.', ',');
  if (pawns === '0,0') return '0,0';
  return `${score.cp > 0 ? '+' : '−'}${pawns}`;
}
