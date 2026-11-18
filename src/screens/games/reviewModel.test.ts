import { Chess } from 'chess.js';
import type { AltMove, GameAnalysis, GameRecord, MoveReview, Score, SideSummary } from '../../domain/gameTypes';
import { CONFIG } from '../../analysis/config';
import type { Category } from '../../analysis/report';
import { alternatives, bestArrowVisible, buildPlyViews, chartPoints, nextUserMistake } from './reviewModel';

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

const CATS: Category[] = ['book', 'book', 'mistake', 'good', 'miss', 'blunder', 'brilliant'];

describe('buildPlyViews', () => {
  const views = buildPlyViews(game, analysis(MOVES.map((_, i) => rv(i))), CATS);

  it('позиция на каждый полуход и начальная', () => {
    expect(views).toHaveLength(8);
    expect(views[0].review).toBeNull();
    expect(views[0].lastMove).toBeNull();
    expect(views[0].label).toBeNull();
  });

  it('вид хода: в начальной позиции null, дальше по порядку ходов', () => {
    expect(views[0].category).toBeNull();
    views.slice(1).forEach((v, i) => expect(v.category).toBe(CATS[i]));
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
  // Виды ходов 0..6; белые ходят на чётных.
  const a: Category[] = ['best', 'blunder', 'mistake', 'mistake', 'inaccuracy', 'good', 'blunder'];

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

  it('упущенная возможность владельца тоже ошибка; хороший и теоретический ходы — нет', () => {
    const b: Category[] = ['book', 'miss', 'good', 'excellent', 'miss', 'best', 'brilliant'];
    expect(nextUserMistake(b, 'white', 0)).toBe(5);
    expect(nextUserMistake(b, 'white', 5)).toBeNull();
    expect(nextUserMistake(b, 'black', 0)).toBe(2);
  });
});

describe('chartPoints', () => {
  it('доля белых для каждой позиции', () => {
    expect(chartPoints(analysis([], [{ cp: 0 }, { mate: -2 }, { mate: 3 }]))).toEqual([0.5, 0, 1]);
  });
});

describe('bestArrowVisible', () => {
  const fenAt = (n: number) => buildPlyViews(game, analysis([]), [])[n].fen;

  it('та же фигура ушла с поля «откуда» — стрелки нет', () => {
    // 2. Фh5 сыграно, лучше было Фg4: ферзь с d1 уже ушёл.
    expect(bestArrowVisible(fenAt(2), fenAt(3), 'd1g4')).toBe(false);
  });

  it('другая фигура, поле «откуда» не тронуто — стрелка есть', () => {
    expect(bestArrowVisible(fenAt(2), fenAt(3), 'g1f3')).toBe(true);
  });

  it('на поле «откуда» после хода стоит другая фигура — стрелки нет', () => {
    // Позиции подобраны вручную: до хода на c3 белый конь, после — белый слон.
    const before = '4k3/8/8/8/8/2N5/8/4K3 w - - 0 1';
    const after = '4k3/8/8/8/8/2B5/8/4K3 b - - 0 1';
    expect(bestArrowVisible(before, after, 'c3d5')).toBe(false);
  });

  it('поле «откуда» пусто и до хода — стрелки нет', () => {
    expect(bestArrowVisible(fenAt(0), fenAt(1), 'e5e6')).toBe(false);
  });

  /** Позиция после хода uci из fen. */
  const play = (fen: string, uci: string) => {
    const chess = new Chess(fen);
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    return chess.fen();
  };

  it('рокировка лучшим ходом: сыгран ход другой фигурой — стрелка есть, сыгран ход королём — нет', () => {
    const before = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    expect(bestArrowVisible(before, play(before, 'h1h4'), 'e1g1')).toBe(true);
    expect(bestArrowVisible(before, play(before, 'e1f1'), 'e1g1')).toBe(false);
  });

  it('взятие на проходе лучшим ходом: сыгран ход другой фигурой — стрелка есть', () => {
    // Чёрные только что сыграли d7d5, лучшим было e5d6 на проходе.
    const before = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2';
    expect(new Chess(before).moves({ verbose: true }).some((m) => m.from === 'e5' && m.to === 'd6')).toBe(true);
    expect(bestArrowVisible(before, play(before, 'e1e2'), 'e5d6')).toBe(true);
  });
});
