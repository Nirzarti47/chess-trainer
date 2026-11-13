import { describe, it, expect } from 'vitest';
import type { Puzzle } from './types';
import { startPuzzle, tryMove, takeHint, resultOf, sideToMove, legalDests } from './puzzle';

const fork: Puzzle = { id: 'f1', rating: 700, themes: ['fork'],
  fen: '5rk1/p4ppp/1q6/3N4/8/8/5PPP/3R2K1 b - - 0 1', moves: ['b6c6', 'd5e7', 'g8h8', 'e7c6'] };
const mate: Puzzle = { id: 'm1', rating: 500, themes: ['mateIn1'],
  fen: '6k1/p4ppp/8/8/8/8/5PPP/3RQ1K1 b - - 0 1', moves: ['a7a6', 'd1d8'] };
// Белая пешка a7 превращается; ферзь и ладья дают мат по 8-й горизонтали, конь — нет.
const promo: Puzzle = { id: 'p1', rating: 600, themes: ['promotion'],
  fen: '6k1/P4ppp/8/8/8/8/5PPP/6K1 b - - 0 1', moves: ['g8h8', 'a7a8q'] };
// Превращение без мата: ожидается только конь (шах с вилкой).
const knightPromo: Puzzle = { id: 'p2', rating: 600, themes: ['promotion'],
  fen: '8/2P2k2/8/8/8/8/6PP/6K1 b - - 0 1', moves: ['f7e7', 'c7c8n'] };

describe('решение задачи (из брифа)', () => {
  it('проходит сценарий брифа', () => {
    let s = startPuzzle(fork);
    expect(sideToMove(s)).toBe('white');
    expect(s.lastMove).toEqual(['b6', 'c6']);
    let r = tryMove(s, 'd5e7');
    expect(r.outcome).toBe('correct');
    expect(r.state.lastMove).toEqual(['g8', 'h8']);
    r = tryMove(r.state, 'e7c6');
    expect(r.outcome).toBe('solved');
    expect(resultOf(r.state)).toBe('clean');

    s = startPuzzle(fork);
    r = tryMove(s, 'd5f6');
    expect(r.outcome).toBe('wrong');
    expect(r.state.fen).toBe(s.fen);
    expect(resultOf(r.state)).toBe('mistake');
    expect(tryMove(r.state, 'd5b4').state.status).toBe('revealed');
    expect(tryMove(s, 'd5d7').outcome).toBe('illegal');
    expect(tryMove(s, 'd5d7').state.mistakes).toBe(0);

    expect(tryMove(startPuzzle(mate), 'e1e8').outcome).toBe('solved');
    expect(tryMove(startPuzzle(mate), 'd1d8').outcome).toBe('solved');

    const h1 = takeHint(startPuzzle(fork));
    expect(h1.square).toBe('d5');
    const h2 = takeHint(h1.state);
    expect(h2.move).toBe('d5e7');
    expect(resultOf(h2.state)).toBe('hint');
  });
});

describe('startPuzzle', () => {
  it('делает ход соперника и ставит step = 1', () => {
    const s = startPuzzle(fork);
    expect(s.step).toBe(1);
    expect(s.mistakes).toBe(0);
    expect(s.hintLevel).toBe(0);
    expect(s.status).toBe('playing');
    expect(s.fen).not.toBe(fork.fen);
    expect(s.puzzle).toBe(fork);
  });
});

describe('tryMove', () => {
  it('не меняет переданное состояние', () => {
    const s = startPuzzle(fork);
    const snapshot = structuredClone(s);
    tryMove(s, 'd5e7');
    tryMove(s, 'd5f6');
    tryMove(s, 'd5d7');
    expect(s).toEqual(snapshot);
  });

  it('после верного хода двигает step на 2 и меняет позицию', () => {
    const s = startPuzzle(fork);
    const r = tryMove(s, 'd5e7');
    expect(r.state.step).toBe(3);
    expect(r.state.fen).not.toBe(s.fen);
    expect(sideToMove(r.state)).toBe('white');
  });

  it('последний ход решающего: solved, ответ соперника не делается, lastMove — свой ход', () => {
    const r = tryMove(tryMove(startPuzzle(fork), 'd5e7').state, 'e7c6');
    expect(r.state.status).toBe('solved');
    expect(r.state.lastMove).toEqual(['e7', 'c6']);
    expect(sideToMove(r.state)).toBe('black');
  });

  it('недопустимая строка хода — illegal', () => {
    expect(tryMove(startPuzzle(fork), 'zz99').outcome).toBe('illegal');
    expect(tryMove(startPuzzle(fork), '').outcome).toBe('illegal');
  });

  it('в завершённой задаче любой ход — illegal и состояние то же', () => {
    const solved = tryMove(startPuzzle(mate), 'd1d8').state;
    const r1 = tryMove(solved, 'e1e8');
    expect(r1.outcome).toBe('illegal');
    expect(r1.state).toBe(solved);

    const s = startPuzzle(fork);
    const revealed = tryMove(tryMove(s, 'd5f6').state, 'd5b4').state;
    expect(revealed.mistakes).toBe(2);
    const r2 = tryMove(revealed, 'd5e7');
    expect(r2.outcome).toBe('illegal');
    expect(r2.state).toBe(revealed);
  });

  it('превращение с матом засчитывается любой фигурой, дающей мат', () => {
    expect(tryMove(startPuzzle(promo), 'a7a8q').outcome).toBe('solved');
    expect(tryMove(startPuzzle(promo), 'a7a8r').outcome).toBe('solved');
    expect(tryMove(startPuzzle(promo), 'a7a8n').outcome).toBe('wrong');
  });

  it('превращение без мата требует точной фигуры', () => {
    expect(tryMove(startPuzzle(knightPromo), 'c7c8n').outcome).toBe('solved');
    expect(tryMove(startPuzzle(knightPromo), 'c7c8q').outcome).toBe('wrong');
  });
});

describe('takeHint', () => {
  it('на уровне 2 остаётся на 2 и снова даёт ход', () => {
    const h2 = takeHint(takeHint(startPuzzle(fork)).state);
    const h3 = takeHint(h2.state);
    expect(h3.state.hintLevel).toBe(2);
    expect(h3.move).toBe('d5e7');
  });

  it('не меняет переданное состояние', () => {
    const s = startPuzzle(fork);
    takeHint(s);
    expect(s.hintLevel).toBe(0);
  });

  it('относится к текущему ожидаемому ходу', () => {
    const after = tryMove(startPuzzle(fork), 'd5e7').state;
    expect(takeHint(after).square).toBe('e7');
  });

  it('в решённой задаче ничего не подсказывает и не меняет состояние', () => {
    const solved = tryMove(startPuzzle(mate), 'd1d8').state;
    const h = takeHint(solved);
    expect(h.state).toBe(solved);
    expect(h.square).toBeUndefined();
    expect(h.move).toBeUndefined();
  });

  it('подсказка важнее ошибки в итоге', () => {
    const s = tryMove(takeHint(startPuzzle(fork)).state, 'd5f6').state;
    expect(resultOf(s)).toBe('hint');
  });
});

describe('legalDests', () => {
  it('начальная позиция: 20 ходов, e2 → e3, e4', () => {
    const dests = legalDests('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const total = [...dests.values()].reduce((n, d) => n + d.length, 0);
    expect(total).toBe(20);
    expect(dests.get('e2')).toEqual(['e3', 'e4']);
    expect(dests.has('e7')).toBe(false);
  });
});
