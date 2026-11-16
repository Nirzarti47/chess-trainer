import { describe, expect, it } from 'vitest';
import type { AltMove, GameAnalysis, GamePuzzle, GameRecord, MoveReview, Score, SideSummary } from '../domain/gameTypes';
import { startPuzzle, tryMove } from '../domain/puzzle';
import { gamePuzzleId, isGamePuzzleId, reconcile, selectPuzzles, toPuzzle } from './gamePuzzles';

const CYCLE = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
const MOVES = Array.from({ length: 32 }, (_, i) => CYCLE[i % 4]);

const game: GameRecord = {
  id: 'game-1', url: 'https://www.chess.com/game/live/1', endTime: 500, timeClass: 'rapid', timeControl: '600',
  userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 790,
  result: 'loss', endReason: 'resigned', moves: MOVES,
};

const alt = (move: string, score: Score): AltMove => ({ move, score, pv: [move] });
const GOOD_LINES = [alt('b1c3', { cp: 300 }), alt('b1a3', { cp: -50 })];

const quiet = (ply: number): MoveReview => ({
  ply, move: MOVES[ply], loss: 0, grade: 'best', best: [alt(MOVES[ply], { cp: 0 })], deep: false,
});
const blunder = (ply: number, over: Partial<MoveReview> = {}): MoveReview => ({
  ply, move: MOVES[ply], loss: 0.3, grade: 'blunder', kind: 'other', phrase: 'Лучше было сыграть так',
  best: GOOD_LINES, deep: true, ...over,
});

const summary = (): SideSummary => ({
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 0, kinds: {},
});

function analysis(over: Record<number, MoveReview>): GameAnalysis {
  return {
    gameId: game.id, rulesVersion: 1, analysedAt: 0, tookMs: 0,
    scores: Array.from({ length: MOVES.length + 1 }, () => ({ cp: 0 })),
    moves: MOVES.map((_, ply) => over[ply] ?? quiet(ply)), white: summary(), black: summary(),
  };
}

describe('gamePuzzleId', () => {
  it('id задачи из партии', () => {
    expect(gamePuzzleId('game-1', 2)).toBe('g:game-1:2');
    expect(isGamePuzzleId('g:game-1:2')).toBe(true);
    expect(isGamePuzzleId('00008')).toBe(false);
  });
});

describe('selectPuzzles', () => {
  it('грубая ошибка владельца → задача из позиции перед ходом соперника', () => {
    const [p, ...rest] = selectPuzzles(game, analysis({ 2: blunder(2, { kind: 'missedFork', phrase: 'Фраза' }) }));
    expect(rest).toEqual([]);
    expect(p).toEqual({
      id: 'g:game-1:2', gameId: 'game-1', ply: 2, endTime: 500,
      fen: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1', moves: ['g8f6', 'b1c3'],
      kind: 'missedFork', phrase: 'Фраза', loss: 0.3,
    });
    const s = startPuzzle(toPuzzle(p));
    expect(tryMove(s, p.moves[1]).outcome).toBe('solved');
  });

  it('отбрасывает неподходящие ходы', () => {
    const a = analysis({
      0: blunder(0),
      1: blunder(1),
      2: blunder(2, { loss: 0.4 }),
      4: blunder(4, { deep: false }),
      6: blunder(6, { best: [GOOD_LINES[0]] }),
      8: blunder(8, { best: [alt('b1c3', { cp: 300 }), alt('b1a3', { cp: 250 })] }),
      10: blunder(10, { best: [alt('b1c3', { mate: 2 }), alt('b1a3', { mate: 3 })] }),
      12: blunder(12, { best: [alt('b1c3', { cp: -400 }), alt('b1a3', { cp: -900 })] }),
      14: blunder(14, { grade: 'mistake', loss: 0.15 }),
      16: blunder(16, { grade: 'inaccuracy', loss: 0.09 }),
    });
    expect(selectPuzzles(game, a).map((p) => p.ply)).toEqual([2, 14]);
  });

  it('из 12 подходящих — 8 с наибольшей потерей', () => {
    const over: Record<number, MoveReview> = {};
    for (let k = 1; k <= 12; k++) over[2 * k] = blunder(2 * k, { loss: 0.2 + k / 100 });
    expect(selectPuzzles(game, analysis(over)).map((p) => p.ply)).toEqual([24, 22, 20, 18, 16, 14, 12, 10]);
  });
});

describe('reconcile', () => {
  const stored = (ply: number, best: string): GamePuzzle => ({
    id: gamePuzzleId(game.id, ply), gameId: game.id, ply, endTime: 500, fen: 'старая', moves: [MOVES[ply - 1], best],
    kind: 'other', phrase: 'Старая', loss: 0.25,
  });

  it('оставляет, заменяет и добавляет', () => {
    const a = analysis({ 2: blunder(2), 4: blunder(4, { best: [alt('b1a3', { cp: 300 }), alt('b1c3', { cp: -50 })] }),
      6: blunder(6) });
    const fresh = selectPuzzles(game, a);
    const old = [stored(2, 'b1c3'), stored(4, 'b1c3')];
    const r = reconcile(old, fresh, a);
    expect(r.removeIds).toEqual(['g:game-1:4']);
    expect(r.put.map((p) => p.id).sort()).toEqual(['g:game-1:4', 'g:game-1:6']);
    expect(r.put.find((p) => p.ply === 4)!.moves[1]).toBe('b1a3');
  });
});

describe('toPuzzle', () => {
  it('задача для общего тренажёра', () => {
    const [p] = selectPuzzles(game, analysis({ 2: blunder(2, { kind: 'missedFork', phrase: 'Фраза' }) }));
    const q = toPuzzle(p);
    expect(q).toEqual({ id: 'g:game-1:2', fen: p.fen, moves: ['g8f6', 'b1c3'], rating: 0, themes: ['fork'],
      game: { gameId: 'game-1', ply: 2, phrase: 'Фраза' } });
  });
});
