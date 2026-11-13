import type { PathNode, Section } from '../content/curriculum';
import { BANDS, THEMES } from '../content/themes';
import type { PuzzlePool } from '../data/puzzleStore';
import { START_RATING, targetPuzzleRating } from './rating';
import type { Circle, Puzzle, ThemeId } from './types';

export const LESSON_SIZE = 12;
export const TAIL = 3;
export const EXAM_SIZE = 15;
export const WEAK_SIZE = 12;
/** Сколько задач со сроком повторения берёт урок «Слабые места» в первую очередь. */
const WEAK_DUE = 6;
/** Сколько слабых тем идёт в урок «Слабые места». */
const WEAK_THEMES = 3;

export type Band = [number, number];
type Rng = () => number;

const TOP = BANDS[3][1];

/** Коридоры полуоткрытые: [400, 900), [900, 1300), и только верхний [1300, 1700] включает правую границу. */
export function inBand(rating: number, [lo, hi]: Band): boolean {
  return rating >= lo && (rating < hi || (hi === TOP && rating === hi));
}

/** Наибольший рейтинг, который можно передать в pool.query как max (query включает max). */
export function bandMax([, hi]: Band): number {
  return hi === TOP ? hi : hi - 1e-6;
}

export function clampToBand(rating: number, band: Band): number {
  return Math.min(Math.max(rating, band[0]), bandMax(band));
}

export function bandOf(circle: Circle): Band {
  if (circle === 0) throw new Error('У круга 0 нет коридора задач');
  return BANDS[circle];
}

export function targetIn(rating: number, band: Band): number {
  return clampToBand(targetPuzzleRating(rating), band);
}

/** Множество для exclude: виденные плюс уже взятые в урок. */
function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const s = new Set(a);
  for (const x of b) s.add(x);
  return s;
}

/** Окно ближайших кандидатов шире нужного, чтобы генератор выбирал среди почти равных. */
const windowFor = (need: number) => need * 2 + 2;

/** need случайных задач из кандидатов (частичная тасовка Фишера — Йетса). */
function sample(cands: Puzzle[], need: number, rng: Rng): Puzzle[] {
  const arr = cands.slice();
  const n = Math.min(need, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

interface Ctx { pool: PuzzlePool; band: Band; seen: ReadonlySet<string>; taken: Set<string>; rng: Rng }

function nearest(c: Ctx, theme: ThemeId, exclude: ReadonlySet<string>, near: number, limit: number): Puzzle[] {
  return c.pool.query({ theme, min: c.band[0], max: bandMax(c.band), exclude, limit, near });
}

function takeAll(c: Ctx, ps: Puzzle[]): Puzzle[] {
  for (const p of ps) c.taken.add(p.id);
  return ps;
}

/** До need задач темы около target: сначала новые, потом уже виденные. Без повторов внутри урока. */
function fromTheme(c: Ctx, theme: ThemeId, target: number, need: number): Puzzle[] {
  const fresh = takeAll(c, sample(nearest(c, theme, union(c.seen, c.taken), target, windowFor(need)), need, c.rng));
  const left = need - fresh.length;
  if (left <= 0) return fresh;
  // Новых не хватило, значит все оставшиеся кандидаты темы уже виденные.
  return [...fresh, ...takeAll(c, sample(nearest(c, theme, c.taken, target, windowFor(left)), left, c.rng))];
}

/** Добор из любых тем того же коридора: сначала новые, потом виденные. */
function fromAnyTheme(c: Ctx, target: number, need: number): Puzzle[] {
  const out: Puzzle[] = [];
  for (const exclude of [() => union(c.seen, c.taken), () => c.taken]) {
    const left = need - out.length;
    if (left <= 0) break;
    const ex = exclude();
    const byId = new Map<string, Puzzle>();
    for (const t of THEMES) for (const p of nearest(c, t.id, ex, target, windowFor(left))) byId.set(p.id, p);
    const cands = [...byId.values()]
      .sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target) || a.rating - b.rating)
      .slice(0, windowFor(left));
    out.push(...takeAll(c, sample(cands, left, c.rng)));
  }
  return out;
}

const byRating = (ps: Puzzle[]) => ps.slice().sort((a, b) => a.rating - b.rating);

/** Раскладывает total задач по темам по очереди: при 8 темах и 15 задачах семь тем по 2, одна 1. */
function roundRobin(themes: ThemeId[], total: number): Map<ThemeId, number> {
  const counts = new Map<ThemeId, number>();
  for (let i = 0; i < total && themes.length > 0; i++) {
    const t = themes[i % themes.length];
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

export function buildThemeLesson(a: { node: PathNode; pool: PuzzlePool; themeRating: number; weakThemes: ThemeId[];
  weakRatings: Record<ThemeId, number>; seen: ReadonlySet<string>; rng: () => number }): Puzzle[] {
  if (!a.node.themeId) throw new Error(`Узел ${a.node.id} не тематический`);
  const band = bandOf(a.node.circle);
  const c: Ctx = { pool: a.pool, band, seen: a.seen, taken: new Set(), rng: a.rng };
  const target = targetIn(a.themeRating, band);

  const tailThemes = a.weakThemes.length === 0 ? []
    : Array.from({ length: TAIL }, (_, i) => a.weakThemes[i % a.weakThemes.length]);
  const mainSize = LESSON_SIZE - tailThemes.length;

  const main = fromTheme(c, a.node.themeId, target, mainSize);
  const tailTargets = tailThemes.map((t) => targetIn(a.weakRatings[t] ?? START_RATING, band));
  const tail = tailThemes.flatMap((t, i) => fromTheme(c, t, tailTargets[i], 1));

  main.push(...fromAnyTheme(c, target, mainSize - main.length));
  const tailTarget = tailTargets.length ? tailTargets[0] : target;
  tail.push(...fromAnyTheme(c, tailTarget, tailThemes.length - tail.length));
  return [...byRating(main), ...tail];
}

export function buildExam(a: { section: Section; pool: PuzzlePool; ratings: Record<ThemeId, number>;
  seen: ReadonlySet<string>; rng: () => number }): Puzzle[] {
  const band = bandOf(a.section.circle);
  const c: Ctx = { pool: a.pool, band, seen: a.seen, taken: new Set(), rng: a.rng };
  const themes = a.section.nodes.flatMap((n) => (n.kind === 'theme' && n.themeId ? [n.themeId] : []));
  const size = Math.max(EXAM_SIZE, themes.length);

  const out: Puzzle[] = [];
  for (const [t, n] of roundRobin(themes, size)) out.push(...fromTheme(c, t, targetIn(a.ratings[t] ?? START_RATING, band), n));
  out.push(...fromAnyTheme(c, targetIn(START_RATING, band), size - out.length));
  return byRating(out);
}

export function buildWeakSpots(a: { due: Puzzle[]; weakThemes: ThemeId[]; ratings: Record<ThemeId, number>;
  pool: PuzzlePool; band: [number, number]; seen: ReadonlySet<string>; rng: () => number }): Puzzle[] {
  const c: Ctx = { pool: a.pool, band: a.band, seen: a.seen, taken: new Set(), rng: a.rng };
  const due = a.due.filter((p, i) => a.due.findIndex((q) => q.id === p.id) === i);
  const takeDue = (limit: number) => takeAll(c, due.filter((p) => !c.taken.has(p.id)).slice(0, Math.max(limit, 0)));

  const duePart = takeDue(WEAK_DUE);
  const themes = a.weakThemes.slice(0, WEAK_THEMES);
  const weakPart: Puzzle[] = [];
  for (const [t, n] of roundRobin(themes, WEAK_SIZE - duePart.length)) {
    weakPart.push(...fromTheme(c, t, targetIn(a.ratings[t] ?? START_RATING, a.band), n));
  }
  // Не хватило слабых тем: сначала остальные задачи со сроком, потом любые темы коридора.
  duePart.push(...takeDue(WEAK_SIZE - duePart.length - weakPart.length));
  const fillTarget = targetIn(themes.length ? a.ratings[themes[0]] ?? START_RATING : START_RATING, a.band);
  weakPart.push(...fromAnyTheme(c, fillTarget, WEAK_SIZE - duePart.length - weakPart.length));
  return [...duePart, ...byRating(weakPart)];
}
