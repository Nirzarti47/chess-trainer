import { THEMES } from '../content/themes';
import type { PuzzlePool } from '../data/puzzleStore';
import { bandMax, targetIn } from './lessonBuilder';
import { weakestThemes } from './themeStats';
import type { Puzzle, ThemeId, ThemeStat } from './types';

/** Вероятность взять одну из слабейших тем, когда тема не задана. */
const WEAK_SHARE = 0.6;
const WEAK_COUNT = 3;
/** Разброс рейтинга вокруг целевого. */
const SPREAD = 75;
/** Из скольких ближайших задач выбирать, когда в разбросе новых нет. */
const NEAREST = 5;

const CIRCLE1 = THEMES.filter((t) => t.firstCircle === 1).map((t) => t.id);
const NONE: ReadonlySet<string> = new Set();

const pickOne = <T>(xs: T[], rng: () => number): T => xs[Math.floor(rng() * xs.length)];

/** С вероятностью 0,6 одна из трёх слабейших открытых тем, иначе одна из остальных открытых. */
function chooseTheme(open: ThemeId[], stats: ThemeStat[], rng: () => number): ThemeId {
  const weak = weakestThemes(stats, open, WEAK_COUNT);
  const others = open.filter((t) => !weak.includes(t));
  if (weak.length > 0 && (others.length === 0 || rng() < WEAK_SHARE)) return pickOne(weak, rng);
  return pickOne(others, rng);
}

export function nextFreePuzzle(a: { pool: PuzzlePool; band: [number, number]; openThemes: ThemeId[]; stats: ThemeStat[];
  overall: number; seen: ReadonlySet<string>; rng: () => number; theme?: ThemeId }): Puzzle {
  const open = a.openThemes.length > 0 ? a.openThemes : CIRCLE1;
  const theme = a.theme ?? chooseTheme(open, a.stats, a.rng);
  const rating = a.stats.find((s) => s.theme === theme)?.rating ?? a.overall;
  const target = targetIn(rating, a.band);
  const lo = a.band[0];
  const hi = bandMax(a.band);

  const inSpread = a.pool.query({ theme, min: Math.max(lo, target - SPREAD), max: Math.min(hi, target + SPREAD),
    exclude: a.seen, limit: Number.MAX_SAFE_INTEGER });
  if (inSpread.length > 0) return pickOne(inSpread, a.rng);
  // В разбросе новых нет: ближайшие новые по всему коридору, а если все виденные — ближайшие виденные.
  for (const exclude of [a.seen, NONE]) {
    const near = a.pool.query({ theme, min: lo, max: hi, exclude, limit: NEAREST, near: target });
    if (near.length > 0) return pickOne(near, a.rng);
  }
  throw new Error(`Нет задач темы ${theme} в коридоре ${a.band[0]}–${a.band[1]}`);
}
