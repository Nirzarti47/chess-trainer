import type { PuzzlePool } from '../data/puzzleStore';
import type { Puzzle, ThemeId } from './types';

/** Поддельный пул задач для тестов: та же семантика query, что у createPool. */
export function fakePool(puzzles: Puzzle[]): PuzzlePool {
  return {
    query({ theme, min, max, exclude, limit, near }) {
      const found = puzzles.filter((p) => p.themes.includes(theme)
        && p.rating >= min && p.rating <= max && !exclude.has(p.id));
      if (near !== undefined) found.sort((a, b) => Math.abs(a.rating - near) - Math.abs(b.rating - near));
      return found.slice(0, Math.max(limit, 0));
    },
    byId: (id) => puzzles.find((p) => p.id === id),
    count: (theme) => puzzles.filter((p) => p.themes.includes(theme)).length,
  };
}

const FEN = '8/8/8/8/8/8/8/K6k w - - 0 1';

/** n задач темы с рейтингами, равномерно идущими от lo до hi (hi не включается). */
export function makePuzzles(theme: ThemeId, n: number, lo = 400, hi = 900): Puzzle[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${theme}-${i}`, fen: FEN, moves: ['e2e4', 'e7e5'],
    rating: lo + Math.floor((i * (hi - lo)) / n), themes: [theme],
  }));
}

/** Детерминированный генератор mulberry32. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
