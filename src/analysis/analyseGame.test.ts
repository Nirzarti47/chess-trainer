import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { GameRecord, Side } from '../domain/gameTypes';
import type { EngineLine } from '../engine/analysisEngine';
import { analyseGame } from './analyseGame';
import { CONFIG } from './config';
import { expected } from './score';
import { tableEngine } from './testEngine';

const game = (moves: string[], userColor: Side = 'white'): GameRecord => ({
  id: 'game-1', url: 'https://www.chess.com/game/live/1', endTime: 100, timeClass: 'rapid', timeControl: '600',
  userColor, userRating: 800, opponent: 'rival_one', opponentRating: 790,
  result: 'win', endReason: 'checkmated', moves,
});

/** fen позиций 0..N. */
function fensOf(moves: string[]): string[] {
  const chess = new Chess();
  const fens = [chess.fen()];
  for (const m of moves) {
    chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    fens.push(chess.fen());
  }
  return fens;
}

const line = (move: string, cp: number): EngineLine => ({ move, score: { cp }, pv: [move] });

const SCHOLAR = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
const QUIET = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];
// 3-й ход чёрных (ply 5) g7g5: оценка в белой точке зрения падает с 0 до +400
const BLUNDER = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g7g5'];
const blunderTable = (): Record<string, EngineLine[]> => {
  const fens = fensOf(BLUNDER);
  return { [fens[5]]: [line('g8f6', 0), line('f8c5', -10)], [fens[6]]: [line('f3g5', 400)] };
};

describe('analyseGame', () => {
  it('детский мат: оценки всех позиций, последняя — мат, движок её не видит', async () => {
    const engine = tableEngine({});
    let t = 1000;
    const a = await analyseGame(game(SCHOLAR), { engine, priority: 'background', now: () => (t += 250) });
    expect(a).not.toBeNull();
    expect(a!.scores).toHaveLength(8);
    expect(a!.scores[7]).toEqual({ over: 'white' });
    expect(a!.moves).toHaveLength(7);
    expect(a!.moves.map((m) => m.move)).toEqual(SCHOLAR);
    expect(engine.calls.map((c) => c.fen)).not.toContain(fensOf(SCHOLAR)[7]);
    expect(a!.gameId).toBe('game-1');
    expect(a!.rulesVersion).toBe(CONFIG.RULES_VERSION);
    expect(a!.tookMs).toBe(250);
    expect(a!.white.grades.best + a!.white.grades.good).toBe(4);
  });

  it('грубая ошибка чёрных идёт во второй проход', async () => {
    const engine = tableEngine(blunderTable());
    const a = await analyseGame(game(BLUNDER), { engine, priority: 'background' });
    const m = a!.moves[5];
    expect(m.deep).toBe(true);
    expect(m.grade).toBe('blunder');
    expect(m.kind).toBeDefined();
    expect(m.phrase).toBeDefined();
    expect(a!.scores[6]).toEqual({ cp: 400 });
    expect(engine.calls).toContainEqual({ fen: fensOf(BLUNDER)[5], nodes: 300000, multipv: 3 });
    expect(engine.calls).toContainEqual({ fen: fensOf(BLUNDER)[6], nodes: 300000, multipv: 1 });
  });

  it('спокойные ходы: только первый проход', async () => {
    const engine = tableEngine({});
    const a = await analyseGame(game(QUIET), { engine, priority: 'background' });
    expect(a!.moves.every((m) => !m.deep)).toBe(true);
    expect(engine.calls).toHaveLength(5);
    expect(engine.calls.every((c) => c.nodes === 60000 && c.multipv === 2)).toBe(true);
  });

  it('движок вернул null на одном запросе → null', async () => {
    const base = tableEngine({});
    const bad = fensOf(QUIET)[2];
    const engine = { analyse: (fen: string, o: Parameters<typeof base.analyse>[1]) =>
      fen === bad ? Promise.resolve(null) : base.analyse(fen, o) };
    expect(await analyseGame(game(QUIET), { engine, priority: 'background' })).toBeNull();
  });

  it('пустой ответ на позицию с ходами → null', async () => {
    const base = tableEngine({});
    const bad = fensOf(QUIET)[1];
    const engine = { analyse: (fen: string, o: Parameters<typeof base.analyse>[1]) =>
      fen === bad ? Promise.resolve([]) : base.analyse(fen, o) };
    expect(await analyseGame(game(QUIET), { engine, priority: 'background' })).toBeNull();
  });

  it('отмена посреди разбора → null, новых запросов нет', async () => {
    const engine = tableEngine({});
    const ctrl = new AbortController();
    const a = await analyseGame(game(QUIET), { engine, priority: 'screen', signal: ctrl.signal,
      onProgress: (done) => { if (done === 2) ctrl.abort(); } });
    expect(a).toBeNull();
    expect(engine.calls).toHaveLength(2);
  });

  it('во второй проход не больше DEEP_MAX_MOVES ходов, ходы владельца первыми', async () => {
    const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const moves = Array.from({ length: 30 }, (_, i) => cycle[i % 4]);
    // каждый ход отдаёт +400 сыгравшего: все 30 ходов выше порога
    const table: Record<string, EngineLine[]> = {};
    fensOf(moves).forEach((fen, i) => { table[fen] = [line(i % 2 === 0 ? 'b1c3' : 'b8c6', 400)]; });
    const engine = tableEngine(table);
    const a = await analyseGame(game(moves, 'black'), { engine, priority: 'background' });
    const deep = a!.moves.filter((m) => m.deep);
    expect(deep).toHaveLength(20);
    expect(deep.filter((m) => m.ply % 2 === 1)).toHaveLength(15);
    expect(engine.calls.filter((c) => c.multipv === 3)).toHaveLength(20);
  });

  it('onProgress: done растёт, в конце done === total', async () => {
    const engine = tableEngine(blunderTable());
    const seen: [number, number][] = [];
    await analyseGame(game(BLUNDER), { engine, priority: 'background', onProgress: (d, t) => seen.push([d, t]) });
    expect(seen.map(([d]) => d)).toEqual(engine.calls.map((_, i) => i + 1));
    for (let i = 1; i < seen.length; i++) expect(seen[i][1]).toBeGreaterThanOrEqual(seen[i - 1][1]);
    expect(seen[0][1]).toBe(BLUNDER.length + 1);
    const [done, total] = seen[seen.length - 1];
    expect(done).toBe(total);
  });

  it('матующий последний ход во втором проходе: оценка после хода — «партия закончена»', async () => {
    const fens = fensOf(SCHOLAR);
    // перед матом первая линия — мат в 1, вторая заметно хуже: ход уходит во второй проход как «сильный»
    const engine = tableEngine({ [fens[6]]: [{ move: 'h5f7', score: { mate: 1 }, pv: ['h5f7'] }, line('h5e5', 0)] });
    const a = await analyseGame(game(SCHOLAR), { engine, priority: 'background' });
    expect(a!.moves[6].deep).toBe(true);
    expect(a!.scores[7]).toEqual({ over: 'white' });
    expect(a!.scores[6]).toEqual({ mate: 1 });
  });

  it('глубокий разбор хода белых: оценка падает с 0 до -400 → грубая ошибка', async () => {
    const fens = fensOf(['e2e4', 'e7e5']);
    // движок отдаёт оценку с точки зрения стороны, чей ход: чёрные видят +400
    const engine = tableEngine({ [fens[0]]: [line('d2d4', 0)], [fens[1]]: [line('e7e5', 400)] });
    const a = await analyseGame(game(['e2e4', 'e7e5']), { engine, priority: 'background' });
    const m = a!.moves[0];
    expect(m.deep).toBe(true);
    expect(m.grade).toBe('blunder');
    expect(m.loss).toBeGreaterThan(0.2);
    expect(a!.scores[1]).toEqual({ cp: -400 });
  });

  it('сыгранный ход найден среди глубоких линий: оценка и потеря берутся из его линии', async () => {
    const moves = ['e2e4', 'e7e5'];
    const fens = fensOf(moves);
    // d2d4 — первая линия, e2e4 — вторая (-150); ответ чёрных даёт -100 и запускает глубокий разбор
    const engine = tableEngine({
      [fens[0]]: [line('d2d4', 0), line('e2e4', -150)],
      [fens[1]]: [line('e7e5', 100)],
      [fens[2]]: [line('g1f3', -100)], // ход чёрных ничего не теряет и во второй проход не идёт
    });
    const a = await analyseGame(game(moves), { engine, priority: 'background' });
    const m = a!.moves[0];
    expect(m.deep).toBe(true);
    expect(a!.scores[1]).toEqual({ cp: -150 });
    expect(m.loss).toBeCloseTo(expected({ cp: 0 }, 'white') - expected({ cp: -150 }, 'white'), 10);
    expect(m.best.map((b) => b.move)).toEqual(['d2d4', 'e2e4']);
  });
});
