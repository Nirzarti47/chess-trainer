import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuzzleRow } from './puzzleStore';

const FEN = '8/8/8/8/8/8/8/K6k w - - 0 1';
const rows: Record<number, PuzzleRow[]> = {
  1: [
    ['a', FEN, 'e2e4 e7e5', 450, 'fork pin'],
    ['b', FEN, 'd2d4 d7d5', 500, 'fork'],
    ['c', FEN, 'c2c4 c7c5', 600, 'fork'],
    ['d', FEN, 'g1f3 g8f6', 800, 'fork mateIn1'],
  ],
  2: [['e', FEN, 'b1c3 b8c6', 1000, 'pin']],
  3: [['f', FEN, 'a2a3 a7a6', 1500, 'sacrifice']],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn(async (url: string) => {
    const n = Number(/c(\d)\.json$/.exec(url)![1]);
    return { ok: true, json: async () => rows[n] };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const load = async () => (await import('./puzzleStore')).loadCircle(1);
const none = new Set<string>();

describe('puzzleStore', () => {
  it('разбирает ходы и темы в массивы', async () => {
    const p = (await load()).byId('a')!;
    expect(p.moves).toEqual(['e2e4', 'e7e5']);
    expect(p.themes).toEqual(['fork', 'pin']);
    expect(p.rating).toBe(450);
  });

  it('query уважает min/max', async () => {
    const pool = await load();
    const ids = pool.query({ theme: 'fork', min: 500, max: 600, exclude: none, limit: 10 }).map((p) => p.id);
    expect(ids).toEqual(['b', 'c']);
  });

  it('query уважает exclude и limit', async () => {
    const pool = await load();
    const q = { theme: 'fork', min: 400, max: 900, limit: 2 };
    expect(pool.query({ ...q, exclude: new Set(['a']) }).map((p) => p.id)).toEqual(['b', 'c']);
    expect(pool.query({ ...q, exclude: none, limit: 3 })).toHaveLength(3);
  });

  it('query сортирует по близости к near, без повторов', async () => {
    const pool = await load();
    const res = pool.query({ theme: 'fork', min: 400, max: 900, exclude: none, limit: 4, near: 790 });
    expect(res.map((p) => p.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(new Set(res.map((p) => p.id)).size).toBe(4);
  });

  it('count и byId', async () => {
    const pool = await load();
    expect(pool.count('fork')).toBe(4);
    expect(pool.count('nothing')).toBe(0);
    expect(pool.byId('zzz')).toBeUndefined();
  });

  it('кэширует круг, параллельные вызовы делят один fetch', async () => {
    const { loadCircle: lc } = await import('./puzzleStore');
    const [a, b] = await Promise.all([lc(1), lc(1)]);
    expect(a).toBe(b);
    await lc(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('./puzzles/c1.json');
  });

  it('mergePools: query, byId и count по всем кругам', async () => {
    const { loadCircle: lc, mergePools } = await import('./puzzleStore');
    const pool = mergePools([await lc(1), await lc(2)]);
    expect(pool.query({ theme: 'pin', min: 400, max: 1300, exclude: none, limit: 10 }).map((p) => p.id))
      .toEqual(['a', 'e']);
    expect(pool.query({ theme: 'pin', min: 400, max: 1300, exclude: none, limit: 1, near: 950 }).map((p) => p.id))
      .toEqual(['e']);
    expect(pool.query({ theme: 'fork', min: 400, max: 1300, exclude: none, limit: 2, near: 1200 }).map((p) => p.id))
      .toEqual(['d', 'c']);
    expect(pool.byId('e')?.rating).toBe(1000);
    expect(pool.byId('a')?.rating).toBe(450);
    expect(pool.byId('f')).toBeUndefined();
    expect(pool.count('pin')).toBe(2);
  });

  it('findPuzzle ищет по всем кругам', async () => {
    const { findPuzzle: fp } = await import('./puzzleStore');
    expect((await fp('f'))?.id).toBe('f');
    expect(await fp('nope')).toBeUndefined();
  });

  it('findPuzzle для задачи из партии берёт её из базы, файлы кругов не грузит', async () => {
    const { db } = await import('./db');
    await db.delete();
    await db.open();
    await db.gamePuzzles.put({ id: 'g:x:5', gameId: 'x', ply: 5, endTime: 100, fen: FEN, moves: ['a1a2', 'h1h2'],
      kind: 'other', phrase: 'Фраза', loss: 0.3 });
    const { findPuzzle: fp } = await import('./puzzleStore');
    const p = await fp('g:x:5');
    expect(p?.id).toBe('g:x:5');
    expect(p?.game?.ply).toBe(5);
    expect(p?.moves).toEqual(['a1a2', 'h1h2']);
    expect(await fp('g:x:7')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
