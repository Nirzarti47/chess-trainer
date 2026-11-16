import type { AltMove, GameAnalysis, GameRecord, MoveReview, Score, SideSummary } from '../../domain/gameTypes';
import { CONFIG } from '../../analysis/config';
import { alternatives, badgeText, buildPlyViews, chartPoints, nextUserMistake } from './reviewModel';

// Детский мат: 1. e4 e5 2. Фh5 Кc6 3. Сc4 Кf6 4. Ф:f7#
const MOVES = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];

const game: GameRecord = {
  id: 'g1', url: 'https://www.chess.com/game/live/g1', endTime: 1, timeClass: 'rapid', timeControl: '600',
  userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 820,
  result: 'win', endReason: 'checkmated', moves: MOVES,
};

const side: SideSummary = {
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 70, kinds: {},
};

const rv = (ply: number, over: Partial<MoveReview> = {}): MoveReview =>
  ({ ply, move: MOVES[ply] ?? 'e2e4', loss: 0, grade: 'best', best: [], deep: false, ...over });

const analysis = (moves: MoveReview[], scores: Score[] = MOVES.map(() => ({ cp: 0 })).concat([{ cp: 0 }])): GameAnalysis =>
  ({ gameId: 'g1', rulesVersion: CONFIG.RULES_VERSION, analysedAt: 1, tookMs: 1, scores, moves, white: side, black: side });

/** Оценка в сотых пешки, при которой ожидаемый результат белых равен e (обратная к expected). */
const cpFor = (e: number) => Math.round(Math.log(e / (1 - e)) / 0.00368208);
const alt = (move: string, whiteExpected: number): AltMove => ({ move, score: { cp: cpFor(whiteExpected) }, pv: [move] });

describe('buildPlyViews', () => {
  const views = buildPlyViews(game, analysis(MOVES.map((_, i) => rv(i))));

  it('позиция на каждый полуход и начальная', () => {
    expect(views).toHaveLength(8);
    expect(views[0].review).toBeNull();
    expect(views[0].lastMove).toBeNull();
    expect(views[0].label).toBeNull();
  });

  it('запись хода по-русски и сыгранный ход', () => {
    expect(views[7].label).toBe('4. Ф:f7#');
    expect(views[1].lastMove).toEqual(['e2', 'e4']);
    expect(views[1].review?.ply).toBe(0);
    expect(views[2].label).toBe('1… e5');
  });
});

describe('alternatives', () => {
  it('лучший ход и те, что уступают ему меньше ALT_MAX_LOSS', () => {
    const r = rv(0, { best: [alt('g1f3', 0.6), alt('b1c3', 0.57), alt('d2d4', 0.4)] });
    expect(alternatives(r, 'white').map((a) => a.move)).toEqual(['g1f3', 'b1c3']);
  });

  it('потери считаются для стороны, сделавшей ход', () => {
    // Для чёрных лучший ход — тот, после которого у белых меньше.
    const r = rv(1, { best: [alt('e7e5', 0.4), alt('c7c5', 0.43), alt('a7a6', 0.6)] });
    expect(alternatives(r, 'black').map((a) => a.move)).toEqual(['e7e5', 'c7c5']);
  });

  it('одна линия — один вариант', () => {
    expect(alternatives(rv(0, { best: [alt('g1f3', 0.6)] }), 'white')).toHaveLength(1);
  });
});

describe('nextUserMistake', () => {
  const a = analysis([
    rv(0), rv(1, { grade: 'blunder' }), rv(2, { grade: 'mistake' }), rv(3, { grade: 'mistake' }),
    rv(4, { grade: 'inaccuracy' }), rv(5), rv(6, { grade: 'blunder' }),
  ]);

  it('пропускает ошибки соперника и возвращает позицию после ошибки владельца', () => {
    expect(nextUserMistake(a, 'white', 0)).toBe(3);
    expect(nextUserMistake(a, 'white', 3)).toBe(7);
    expect(nextUserMistake(a, 'black', 0)).toBe(2);
    expect(nextUserMistake(a, 'black', 2)).toBe(4);
  });

  it('после последней ошибки — null', () => {
    expect(nextUserMistake(a, 'white', 7)).toBeNull();
    expect(nextUserMistake(a, 'black', 4)).toBeNull();
  });
});

describe('chartPoints', () => {
  it('доля белых для каждой позиции', () => {
    expect(chartPoints(analysis([], [{ cp: 0 }, { mate: -2 }, { mate: 3 }]))).toEqual([0.5, 0, 1]);
  });
});

describe('badgeText', () => {
  it('значок по знаку и оценке', () => {
    expect(badgeText(rv(0, { mark: 'brilliant' }))).toBe('!!');
    expect(badgeText(rv(0, { mark: 'great' }))).toBe('!');
    expect(badgeText(rv(0, { grade: 'inaccuracy' }))).toBe('?!');
    expect(badgeText(rv(0, { grade: 'mistake' }))).toBe('?');
    expect(badgeText(rv(0, { grade: 'blunder' }))).toBe('??');
    expect(badgeText(rv(0, { grade: 'best' }))).toBeNull();
    expect(badgeText(rv(0, { grade: 'good' }))).toBeNull();
  });
});
