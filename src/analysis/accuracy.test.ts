import { describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveReview, Score, SideSummary } from '../domain/gameTypes';
import { gameAccuracy, moveAccuracyWin } from './accuracy';
import { CONFIG } from './config';
import { reportOf } from './report';
import { expected } from './score';

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
    const win = (s: Score) => 100 * expected(s, 'white');
    const whiteMoves = Array.from({ length: 10 }, (_, k) => moveAccuracyWin(win(scores[2 * k]), win(scores[2 * k + 1])));
    const simple = whiteMoves.reduce((x, y) => x + y, 0) / whiteMoves.length;
    expect(gameAccuracy(scores, 'white')!).toBeLessThan(simple - 5);
    expect(gameAccuracy(scores, 'black')!).toBeGreaterThanOrEqual(90);
  });
  it('одна грубая ошибка белых: точное значение', () => {
    // Вероятность выигрыша: 52.76 до ошибки, 13.69 после. Точность хода ply 4 — 16.659, остальных девяти — 100.
    // Окно 2 (20 полуходов), вес ply 4: sd окна {52.76, 13.69} = 19.54 → предел 12; у остальных sd = 0 → 0.5.
    // Взвешенное: (16.659·12 + 9·100·0.5) / (12 + 4.5) = 39.389.
    // Гармоническое: 10 / (1/16.659 + 9/100) = 66.655. Итог: (39.389 + 66.655) / 2 = 53.022.
    // расчёт выше — для способа Lichess как есть (поправка 1); подогнанная поправка из CONFIG только смягчает потерю
    const scores: Score[] = Array.from({ length: 21 }, (_, i) => ({ cp: i <= 4 ? 30 : -500 }));
    const tuned = gameAccuracy(scores, 'white')!;
    const cfg = CONFIG as { ACC_LOSS_SCALE: number };
    const saved = cfg.ACC_LOSS_SCALE;
    cfg.ACC_LOSS_SCALE = 1;
    try {
      expect(gameAccuracy(scores, 'white')!).toBeCloseTo(53.02, 1);
    } finally {
      cfg.ACC_LOSS_SCALE = saved;
    }
    if (saved < 1) expect(tuned).toBeGreaterThan(53.02);
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
    // Ход белых {over:'white'} → {over:'black'}: вероятность 100 → 0, точность хода ровно 0.
    const scores: Score[] = [{ over: 'white' }, { over: 'black' }, ...flat(10).map(() => ({ over: 'black' as const }))];
    expect(moveAccuracyWin(100 * expected(scores[0], 'white'), 100 * expected(scores[1], 'white'))).toBe(0);
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
