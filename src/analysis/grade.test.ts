import { describe, expect, it } from 'vitest';
import type { AltMove, MoveReview } from '../domain/gameTypes';
import { gradeOf, isBrilliant, isGreat, summarize } from './grade';
import { moveAccuracy } from './score';

describe('gradeOf', () => {
  it('пороги потери', () => {
    expect(gradeOf(0.3, true)).toBe('best');
    expect(gradeOf(0.049, false)).toBe('good');
    expect(gradeOf(0.05, false)).toBe('inaccuracy');
    expect(gradeOf(0.10, false)).toBe('mistake');
    expect(gradeOf(0.20, false)).toBe('blunder');
  });
});

const line = (cp: number): AltMove => ({ move: 'e2e4', score: { cp }, pv: ['e2e4'] });

describe('isGreat', () => {
  it('единственный хороший ход', () => {
    expect(isGreat({ grade: 'best', best: [line(200), line(-100)], mover: 'white', isRecapture: false })).toBe(true);
  });
  it('второй ход почти так же хорош', () => {
    expect(isGreat({ grade: 'best', best: [line(200), line(170)], mover: 'white', isRecapture: false })).toBe(false);
  });
  it('ответное взятие не отмечается', () => {
    expect(isGreat({ grade: 'best', best: [line(200), line(-100)], mover: 'white', isRecapture: true })).toBe(false);
  });
  it('одна линия — не судим', () => {
    expect(isGreat({ grade: 'best', best: [line(200)], mover: 'white', isRecapture: false })).toBe(false);
  });
  it('для чёрных разрыв считается с их стороны', () => {
    expect(isGreat({ grade: 'best', best: [line(-200), line(100)], mover: 'black', isRecapture: false })).toBe(true);
    expect(isGreat({ grade: 'good', best: [line(-200), line(100)], mover: 'black', isRecapture: false })).toBe(false);
  });
});

describe('isBrilliant', () => {
  const fenBefore = '4k3/8/4p3/8/8/8/8/3RK3 w - - 0 1';
  const base = { loss: 0, fenBefore, move: 'd1d5', before: { cp: 100 }, after: { cp: 150 }, mover: 'white' as const };

  it('ладья встаёт под бой пешки', () => {
    expect(isBrilliant(base)).toBe(true);
  });
  it('позиция уже выиграна', () => {
    expect(isBrilliant({ ...base, before: { cp: 900 } })).toBe(false);
  });
  it('после хода хуже равной', () => {
    expect(isBrilliant({ ...base, after: { cp: -100 } })).toBe(false);
  });
  it('потеря слишком большая', () => {
    expect(isBrilliant({ ...base, loss: 0.03 })).toBe(false);
  });
  it('тихий ход без жертвы', () => {
    expect(isBrilliant({ ...base, move: 'd1d2' })).toBe(false);
  });
  it('ход сам взял столько же — это размен, не жертва', () => {
    // ладья берёт ладью, пешка забирает ладью
    expect(isBrilliant({ ...base, fenBefore: '4k3/8/4p3/3r4/8/8/8/3RK3 w - - 0 1' })).toBe(false);
  });
});

const review = (ply: number, loss: number, grade: MoveReview['grade'], extra: Partial<MoveReview> = {}): MoveReview =>
  ({ ply, move: 'e2e4', loss, grade, best: [], deep: false, ...extra });

describe('summarize', () => {
  const moves: MoveReview[] = [
    review(0, 0, 'best', { mark: 'brilliant' }),
    review(1, 0.3, 'blunder', { kind: 'pieceEnPrise', phrase: 'x' }),
    review(2, 0.12, 'mistake', { kind: 'missedFork', phrase: 'x' }),
    review(3, 0, 'best', { mark: 'great' }),
    review(4, 0.07, 'inaccuracy', { kind: 'other' }),
    review(5, 0.25, 'blunder', { kind: 'pieceEnPrise', phrase: 'x' }),
  ];

  it('белые — чётные ходы', () => {
    const s = summarize(moves, 'white');
    expect(s.grades).toEqual({ best: 1, good: 0, inaccuracy: 1, mistake: 1, blunder: 0 });
    expect(s.brilliant).toBe(1);
    expect(s.great).toBe(0);
    expect(s.accuracy).toBeCloseTo((moveAccuracy(0) + moveAccuracy(0.12) + moveAccuracy(0.07)) / 3, 6);
    expect(s.kinds).toEqual({ missedFork: 1 });
  });

  it('чёрные — нечётные ходы', () => {
    const s = summarize(moves, 'black');
    expect(s.grades).toEqual({ best: 1, good: 0, inaccuracy: 0, mistake: 0, blunder: 2 });
    expect(s.brilliant).toBe(0);
    expect(s.great).toBe(1);
    expect(s.accuracy).toBeCloseTo((moveAccuracy(0.3) + moveAccuracy(0) + moveAccuracy(0.25)) / 3, 6);
    expect(s.kinds).toEqual({ pieceEnPrise: 2 });
  });

  it('нет ходов — пустая сводка', () => {
    const s = summarize([], 'white');
    expect(s.grades).toEqual({ best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 });
    expect(s.accuracy).toBe(0);
    expect(s.kinds).toEqual({});
  });
});
