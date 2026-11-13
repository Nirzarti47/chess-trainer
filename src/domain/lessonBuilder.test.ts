import { describe, expect, it } from 'vitest';
import { CURRICULUM, type PathNode } from '../content/curriculum';
import { THEMES } from '../content/themes';
import { buildExam, buildThemeLesson, buildWeakSpots, EXAM_SIZE, LESSON_SIZE, TAIL, WEAK_SIZE } from './lessonBuilder';
import { fakePool, makePuzzles, seededRng } from './testPool';
import type { Puzzle, ThemeId } from './types';

const C1 = THEMES.filter((t) => t.firstCircle === 1).map((t) => t.id);
const pool = fakePool(C1.flatMap((t) => makePuzzles(t, 200)));
const none = new Set<string>();
const node = (id: string): PathNode => CURRICULUM.flatMap((s) => s.nodes).find((n) => n.id === id)!;
const section = (id: string) => CURRICULUM.find((s) => s.id === id)!;
const ids = (ps: Puzzle[]) => ps.map((p) => p.id);
const mean = (ps: Puzzle[]) => ps.reduce((s, p) => s + p.rating, 0) / ps.length;

const lesson = (over: Partial<Parameters<typeof buildThemeLesson>[0]> = {}) => buildThemeLesson({
  node: node('c1:fork'), pool, themeRating: 600, weakThemes: [], weakRatings: {}, seen: none,
  rng: seededRng(1), ...over,
});

describe('buildThemeLesson', () => {
  it('12 задач без повторов и без уже виденных', () => {
    const seen = new Set(ids(makePuzzles('fork', 200)).filter((_, i) => i % 3 === 0));
    const res = lesson({ seen, weakThemes: ['pin', 'mateIn1'] });
    expect(res).toHaveLength(LESSON_SIZE);
    expect(new Set(ids(res)).size).toBe(LESSON_SIZE);
    expect(res.some((p) => seen.has(p.id))).toBe(false);
  });

  it('без слабых тем все 12 из темы узла', () => {
    expect(lesson().every((p) => p.themes.includes('fork'))).toBe(true);
  });

  it('со слабыми темами последние 3 из них по очереди, первые 9 из темы узла', () => {
    const res = lesson({ weakThemes: ['pin', 'mateIn1'] });
    expect(TAIL).toBe(3);
    expect(res.slice(0, 9).every((p) => p.themes.includes('fork'))).toBe(true);
    expect(res.slice(9).map((p) => p.themes[0])).toEqual(['pin', 'mateIn1', 'pin']);
  });

  it('задачи хвоста около рейтинга своей слабой темы', () => {
    const res = lesson({ weakThemes: ['pin', 'skewer', 'mateIn1'], weakRatings: { pin: 900, skewer: 700 } });
    const [pin, skewer, mate] = res.slice(9);
    expect(Math.abs(pin.rating - 780)).toBeLessThanOrEqual(40);
    expect(Math.abs(skewer.rating - 580)).toBeLessThanOrEqual(40);
    expect(Math.abs(mate.rating - 480)).toBeLessThanOrEqual(40);
  });

  it('первые 9 по неубыванию рейтинга и в коридоре круга', () => {
    const first = lesson({ weakThemes: ['pin'] }).slice(0, 9);
    for (let i = 1; i < first.length; i++) expect(first[i].rating).toBeGreaterThanOrEqual(first[i - 1].rating);
    expect(first.every((p) => p.rating >= 400 && p.rating < 900)).toBe(true);
  });

  it('при рейтинге темы 600 средний рейтинг около 480', () => {
    const avg = mean(lesson({ weakThemes: ['pin'] }).slice(0, 9));
    expect(avg).toBeGreaterThanOrEqual(380);
    expect(avg).toBeLessThanOrEqual(580);
  });

  it('при рейтинге темы 300 задачи не ниже коридора', () => {
    expect(lesson({ themeRating: 300 }).every((p) => p.rating >= 400)).toBe(true);
  });

  it('при высоком рейтинге задачи не выходят за верх полуоткрытого коридора', () => {
    const edge = fakePool([...makePuzzles('fork', 50, 850, 950)]);
    const res = lesson({ pool: edge, themeRating: 2000 });
    expect(res).toHaveLength(12);
    expect(res.every((p) => p.rating < 900)).toBe(true);
  });

  it('Review Focus 1: 5 новых и 20 решённых — урок всё равно из 12 без повторов', () => {
    const fork = makePuzzles('fork', 25);
    const seen = new Set(ids(fork.slice(5)));
    const res = lesson({ pool: fakePool(fork), seen });
    expect(res).toHaveLength(12);
    expect(new Set(ids(res)).size).toBe(12);
    expect(ids(res).filter((id) => !seen.has(id)).sort()).toEqual(ids(fork.slice(0, 5)).sort());
  });

  it('если в теме мало задач, добирает из других тем того же коридора', () => {
    const small = fakePool([...makePuzzles('fork', 4), ...makePuzzles('pin', 30), ...makePuzzles('attraction', 30, 900, 1300)]);
    const res = lesson({ pool: small });
    expect(res).toHaveLength(12);
    expect(new Set(ids(res)).size).toBe(12);
    expect(res.filter((p) => p.themes.includes('fork'))).toHaveLength(4);
    expect(res.every((p) => p.rating < 900)).toBe(true);
  });

  it('если весь пул меньше урока, отдаёт всё, что есть', () => {
    expect(lesson({ pool: fakePool(makePuzzles('fork', 7)) })).toHaveLength(7);
  });

  it('одинаковые входы и генератор дают одинаковый урок, разные генераторы — разное начало', () => {
    expect(ids(lesson({ rng: seededRng(5) }))).toEqual(ids(lesson({ rng: seededRng(5) })));
    expect(ids(lesson({ rng: seededRng(5) })).slice(0, 3)).not.toEqual(ids(lesson({ rng: seededRng(6) })).slice(0, 3));
  });

  it('берёт коридор из круга узла', () => {
    const p2 = fakePool([...makePuzzles('fork', 200), ...makePuzzles('fork', 200, 900, 1300).map((p) => ({ ...p, id: `h${p.id}` }))]);
    const res = lesson({ node: node('c2:fork'), pool: p2, themeRating: 1100 });
    expect(res.every((p) => p.rating >= 900 && p.rating < 1300)).toBe(true);
  });
});

describe('buildExam', () => {
  const ratings: Record<ThemeId, number> = {};
  it('15 задач без повторов, каждая тема раздела хотя бы раз', () => {
    const res = buildExam({ section: section('c1'), pool, ratings, seen: none, rng: seededRng(2) });
    expect(res).toHaveLength(EXAM_SIZE);
    expect(new Set(ids(res)).size).toBe(EXAM_SIZE);
    for (const t of C1) expect(res.some((p) => p.themes.includes(t))).toBe(true);
  });

  it('в круге 3 задач не меньше числа тем раздела', () => {
    const big = fakePool(THEMES.flatMap((t) => makePuzzles(t.id, 30, 1300, 1700)));
    const res = buildExam({ section: section('c3'), pool: big, ratings, seen: none, rng: seededRng(3) });
    expect(res).toHaveLength(19);
    for (const t of THEMES) expect(res.some((p) => p.themes.includes(t.id))).toBe(true);
  });
});

describe('buildWeakSpots', () => {
  const due = makePuzzles('mateIn1', 8).map((p) => ({ ...p, id: `due-${p.id}` }));
  const base = { weakThemes: ['pin', 'skewer', 'fork'], ratings: {}, pool, band: [400, 900] as [number, number],
    seen: none, rng: seededRng(4) };

  it('при 8 задачах со сроком берёт 6 из них и 6 из слабых тем', () => {
    const res = buildWeakSpots({ ...base, due });
    expect(res).toHaveLength(WEAK_SIZE);
    expect(ids(res.slice(0, 6))).toEqual(ids(due.slice(0, 6)));
    expect(res.slice(6).every((p) => ['pin', 'skewer', 'fork'].includes(p.themes[0]))).toBe(true);
    expect(new Set(ids(res)).size).toBe(WEAK_SIZE);
  });

  it('при 0 задачах со сроком все 12 из слабых тем', () => {
    const res = buildWeakSpots({ ...base, due: [] });
    expect(res).toHaveLength(12);
    expect(res.every((p) => ['pin', 'skewer', 'fork'].includes(p.themes[0]))).toBe(true);
    for (const t of ['pin', 'skewer', 'fork']) expect(res.some((p) => p.themes[0] === t)).toBe(true);
  });

  it('без слабых тем добирает задачами со сроком', () => {
    const res = buildWeakSpots({ ...base, weakThemes: [], due });
    expect(res.slice(0, 8).map((p) => p.id)).toEqual(ids(due));
    expect(res).toHaveLength(12);
  });
});
