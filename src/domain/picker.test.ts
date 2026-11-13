import { describe, expect, it } from 'vitest';
import { THEMES } from '../content/themes';
import { nextFreePuzzle } from './picker';
import { fakePool, makePuzzles, seededRng } from './testPool';
import type { ThemeStat } from './types';

const C1 = THEMES.filter((t) => t.firstCircle === 1).map((t) => t.id);
const pool = fakePool(C1.flatMap((t) => makePuzzles(t, 200)));
const band: [number, number] = [400, 900];
const none = new Set<string>();
const stat = (theme: string, rating: number): ThemeStat => ({ theme, rating, solved: 10, clean: 5 });
const stats = [stat('pin', 450), stat('skewer', 480), stat('fork', 500), stat('mateIn1', 800), stat('mateIn2', 850)];
const base = { pool, band, openThemes: C1, stats, overall: 600, seen: none };

describe('nextFreePuzzle', () => {
  it('заданная тема всегда соблюдается', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 100; i++) {
      expect(nextFreePuzzle({ ...base, rng, theme: 'backRankMate' }).themes).toContain('backRankMate');
    }
  });

  it('на 1000 вызовов доля слабых тем между 0,5 и 0,7', () => {
    const rng = seededRng(7);
    const weak = new Set(['pin', 'skewer', 'fork']);
    let hits = 0;
    for (let i = 0; i < 1000; i++) if (weak.has(nextFreePuzzle({ ...base, rng }).themes[0])) hits++;
    expect(hits / 1000).toBeGreaterThanOrEqual(0.5);
    expect(hits / 1000).toBeLessThanOrEqual(0.7);
  });

  it('не берёт виденные, пока есть новые', () => {
    const fork = makePuzzles('fork', 30);
    const seen = new Set(fork.slice(0, 29).map((p) => p.id));
    const res = nextFreePuzzle({ ...base, pool: fakePool(fork), seen, rng: seededRng(3), theme: 'fork' });
    expect(res.id).toBe(fork[29].id);
    const rng = seededRng(4);
    const seen2 = new Set(makePuzzles('pin', 200).filter((_, i) => i % 2 === 0).map((p) => p.id));
    for (let i = 0; i < 200; i++) expect(seen2.has(nextFreePuzzle({ ...base, seen: seen2, rng, theme: 'pin' }).id)).toBe(false);
  });

  it('рейтинг около targetPuzzleRating(рейтинг темы) ± 75 и в коридоре', () => {
    const rng = seededRng(5);
    for (let i = 0; i < 200; i++) {
      const r = nextFreePuzzle({ ...base, rng, theme: 'mateIn1' }).rating;
      expect(r).toBeGreaterThanOrEqual(680 - 75);
      expect(r).toBeLessThanOrEqual(680 + 75);
    }
    for (let i = 0; i < 50; i++) {
      const r = nextFreePuzzle({ ...base, rng, theme: 'backRankMate', overall: 200 }).rating;
      expect(r).toBeGreaterThanOrEqual(400);
      expect(r).toBeLessThanOrEqual(475);
    }
  });

  it('когда все задачи темы виденные, возвращает виденную', () => {
    const fork = makePuzzles('fork', 10);
    const seen = new Set(fork.map((p) => p.id));
    const res = nextFreePuzzle({ ...base, pool: fakePool(fork), seen, rng: seededRng(6), theme: 'fork' });
    expect(res.themes).toContain('fork');
  });

  it('без открытых тем берёт темы круга 1', () => {
    const rng = seededRng(8);
    for (let i = 0; i < 50; i++) expect(C1).toContain(nextFreePuzzle({ ...base, openThemes: [], stats: [], rng }).themes[0]);
  });

  it('одинаковый генератор даёт одинаковую задачу', () => {
    expect(nextFreePuzzle({ ...base, rng: seededRng(9) }).id).toBe(nextFreePuzzle({ ...base, rng: seededRng(9) }).id);
  });
});
