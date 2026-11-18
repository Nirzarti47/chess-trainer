import { describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveReview, Score, SideSummary } from '../domain/gameTypes';
import { gameAccuracy, moveAccuracyWin } from './accuracy';
import { reportOf } from './report';

const SUMMARY: SideSummary = {
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 0, kinds: {},
};

const analysisOf = (scores: Score[]): GameAnalysis => ({
  gameId: 'g', rulesVersion: 2, analysedAt: 0, tookMs: 0, scores,
  moves: scores.slice(1).map((_, ply): MoveReview => (
    { ply, move: 'e2e4', loss: 0, grade: 'good', best: [], deep: false })),
  white: SUMMARY, black: SUMMARY,
});

const flat = (n: number, cp = 20): Score[] => Array.from({ length: n + 1 }, () => ({ cp }));

describe('moveAccuracyWin', () => {
  it('без потери — 100', () => {
    expect(moveAccuracyWin(50, 50)).toBe(100);
    expect(moveAccuracyWin(60, 70)).toBe(100);
  });
  it('большая потеря — мало', () => expect(moveAccuracyWin(70, 20)).toBeLessThan(15));
  it('всегда в пределах 0..100', () => {
    expect(moveAccuracyWin(100, 0)).toBeGreaterThanOrEqual(0);
    expect(moveAccuracyWin(100, 0)).toBeLessThanOrEqual(100);
  });
});

describe('gameAccuracy', () => {
  it('партия без потерь — 100 у обеих сторон', () => {
    expect(gameAccuracy(flat(12), 'white')).toBe(100);
    expect(gameAccuracy(flat(12), 'black')).toBe(100);
  });
  it('грубая ошибка весит больше простого среднего', () => {
    // 20 полуходов: белые на 4-м полуходе (ply 4) роняют {cp:30} → {cp:-500}; дальше ровно
    const scores: Score[] = Array.from({ length: 21 }, (_, i) => ({ cp: i <= 4 ? 30 : -500 }));
    const win = (s: Score) => 100 * (1 / (1 + Math.exp(-0.00368208 * (s as { cp: number }).cp)));
    const whiteMoves = Array.from({ length: 10 }, (_, k) => moveAccuracyWin(win(scores[2 * k]), win(scores[2 * k + 1])));
    const simple = whiteMoves.reduce((x, y) => x + y, 0) / whiteMoves.length;
    expect(gameAccuracy(scores, 'white')!).toBeLessThan(simple - 5);
    expect(gameAccuracy(scores, 'black')!).toBeGreaterThanOrEqual(90);
  });
  it('мат и конец партии в оценках не дают NaN', () => {
    const scores: Score[] = [{ cp: 0 }, { mate: 3 }, { mate: -2 }, { over: 'white' }, { over: 'draw' }, { over: 'black' }];
    for (const side of ['white', 'black'] as const) {
      const v = gameAccuracy(scores, side);
      expect(typeof v).toBe('number');
      expect(Number.isNaN(v)).toBe(false);
    }
  });
  it('один полуход: у белых число, у чёрных null', () => {
    const scores: Score[] = [{ cp: 0 }, { cp: 20 }];
    expect(typeof gameAccuracy(scores, 'white')).toBe('number');
    expect(gameAccuracy(scores, 'black')).toBeNull();
  });
  it('ход с нулевой точностью не обнуляет всю партию', () => {
    const scores: Score[] = [{ cp: 0 }, { over: 'black' }, ...flat(10).map(() => ({ over: 'black' as const }))];
    expect(gameAccuracy(scores, 'white')!).toBeGreaterThan(0);
  });
});

describe('reportOf: точность', () => {
  it('заполняет accuracy числом', () => {
    const r = reportOf(analysisOf(flat(6)), 0);
    expect(r.white.accuracy).toBe(100);
    expect(r.black.accuracy).toBe(100);
  });
});
