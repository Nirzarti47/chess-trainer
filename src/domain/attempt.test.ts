import { describe, expect, it } from 'vitest';
import { puzzleAttempt } from './attempt';
import type { Puzzle } from './types';

const FEN = '8/8/8/8/8/8/8/K6k w - - 0 1';
const plain: Puzzle = { id: 'p1', fen: FEN, moves: ['a1a2', 'h1h2'], rating: 750, themes: ['fork'] };
const fromGame: Puzzle = { id: 'g:x:5', fen: FEN, moves: ['a1a2', 'h1h2'], rating: 0, themes: ['hangingPiece'],
  game: { gameId: 'x', ply: 5, phrase: 'Фраза' } };
const none = new Set<string>();

describe('puzzleAttempt', () => {
  it('задача из партии: без рейтинга при любом источнике', () => {
    expect(puzzleAttempt(fromGame, 'game', none)).toEqual(
      { puzzleId: 'g:x:5', themes: ['hangingPiece'], puzzleRating: undefined, rated: false });
    expect(puzzleAttempt(fromGame, 'weak', none)).toMatchObject({ puzzleRating: undefined, rated: false });
  });

  it('обычная невиденная задача в уроке идёт в рейтинг с рейтингом задачи', () => {
    expect(puzzleAttempt(plain, 'lesson', none)).toEqual(
      { puzzleId: 'p1', themes: ['fork'], puzzleRating: 750, rated: true });
  });

  it('обычная задача: уже виденная или в повторении — без рейтинга', () => {
    expect(puzzleAttempt(plain, 'lesson', new Set(['p1'])).rated).toBe(false);
    expect(puzzleAttempt(plain, 'review', none)).toEqual(
      { puzzleId: 'p1', themes: ['fork'], puzzleRating: 750, rated: false });
  });
});
