import { describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveReview, Score, SideSummary } from '../domain/gameTypes';
import { gameAccuracy, moveAccuracyWin, winPercent } from './accuracy';
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
    // расчёт выше — для способа Lichess как есть (поправка 1)
    const scores: Score[] = Array.from({ length: 21 }, (_, i) => ({ cp: i <= 4 ? 30 : -500 }));
    expect(gameAccuracy(scores, 'white', { lossScale: 1 })!).toBeCloseTo(53.02, 1);
    // подогнанная поправка из CONFIG только смягчает потерю
    expect(gameAccuracy(scores, 'white')!).toBeGreaterThan(53.02);
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
  it('ход с нулевой точностью не обнуляет всю партию: пол гармонического среднего 1', () => {
    // Ход белых {over:'white'} → {over:'black'}: вероятность 97.5 → 2.5, потеря 95, точность хода при поправке 1 ровно 0.
    // Дальше {over:'black'} без потерь: у белых 6 ходов (12 полуходов), у остальных пяти точность 100.
    // Окно 2 (12 полуходов): вес ply 0 — sd окна {97.5, 2.5} = 47.5 → предел 12; у остальных sd = 0 → 0.5.
    // Взвешенное: (0·12 + 5·100·0.5) / (12 + 2.5) = 17.241.
    // Гармоническое с полом 1: 6 / (1/1 + 5/100) = 5.714; без пола ход 0 дал бы деление на ноль.
    // Итог: (17.241 + 5.714) / 2 = 11.478.
    const scores: Score[] = [{ over: 'white' }, ...Array.from({ length: 12 }, () => ({ over: 'black' as const }))];
    expect(moveAccuracyWin(winPercent(scores[0]), winPercent(scores[1]), 1)).toBe(0);
    expect(gameAccuracy(scores, 'white', { lossScale: 1 })!).toBeCloseTo(11.48, 1);
  });
});

describe('winPercent: потолок оценки как у Lichess', () => {
  const cap = CONFIG.ACC_CP_CAP;
  it('оценка за потолком равна оценке на потолке', () => {
    expect(winPercent({ cp: 2500 })).toBeCloseTo(winPercent({ cp: cap }), 10);
    expect(winPercent({ cp: -2500 })).toBeCloseTo(winPercent({ cp: -cap }), 10);
    expect(winPercent({ cp: cap })).toBeLessThan(100);
  });
  it('мат — как потолок в пользу ставящего мат; конец партии — победа потолок, ничья 0', () => {
    expect(winPercent({ mate: 3 })).toBeCloseTo(winPercent({ cp: cap }), 10);
    expect(winPercent({ mate: -2 })).toBeCloseTo(winPercent({ cp: -cap }), 10);
    expect(winPercent({ over: 'white' })).toBeCloseTo(winPercent({ cp: cap }), 10);
    expect(winPercent({ over: 'black' })).toBeCloseTo(winPercent({ cp: -cap }), 10);
    expect(winPercent({ over: 'draw' })).toBeCloseTo(50, 10);
  });
  it('ход с +2500 на +600 точнее, чем без потолка', () => {
    const capped = moveAccuracyWin(winPercent({ cp: 2500 }), winPercent({ cp: 600 }));
    const raw = moveAccuracyWin(100 * expected({ cp: 2500 }, 'white'), 100 * expected({ cp: 600 }, 'white'));
    expect(capped).toBeGreaterThan(raw);
  });
  it('партия с матом в оценках — число', () => {
    const scores: Score[] = [{ cp: 300 }, { mate: 4 }, { mate: 3 }, { mate: 2 }, { over: 'white' }];
    for (const side of ['white', 'black'] as const) {
      const v = gameAccuracy(scores, side);
      expect(typeof v).toBe('number');
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});

describe('reportOf: точность', () => {
  it('заполняет accuracy числом', () => {
    const r = reportOf(analysisOf(flat(6)), 0);
    expect(r.white.accuracy).toBe(100);
    expect(r.black.accuracy).toBe(100);
  });
});
