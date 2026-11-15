import 'fake-indexeddb/auto';
import { CURRICULUM } from '../content/curriculum';
import { BANDS, THEMES } from '../content/themes';
import { db } from '../data/db';
import { localDay } from '../domain/dates';
import { makePuzzles } from '../domain/testPool';
import type { ExplainStep, LessonProgress, LessonTask, Puzzle, ThemeStat } from '../domain/types';
import { lessonFactory } from './lessonFactory';

// Задачи кругов: по 30 на каждую тему в коридоре круга.
const pools = vi.hoisted(() => ({ byCircle: new Map<number, Puzzle[]>() }));
vi.mock('../data/puzzleStore', async (importOriginal) => {
  const { fakePool: makePool } = await import('../domain/testPool');
  return {
    ...(await importOriginal<typeof import('../data/puzzleStore')>()),
    loadCircle: vi.fn(async (c: number) => makePool(pools.byCircle.get(c) ?? [])),
    findPuzzle: vi.fn(async (id: string) => [...pools.byCircle.values()].flat().find((p) => p.id === id)),
  };
});

vi.mock('../content/explanations', () => ({
  getExplain: vi.fn((themeId: string, mode: string): ExplainStep[] => [{ fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    text: `${themeId} ${mode}` }]),
  getAuthoredLesson: vi.fn((nodeId: string, lessonIndex: number): LessonTask[] => [
    { kind: 'explain', step: { fen: '8/8/8/8/8/8/8/K6k w - - 0 1', text: `${nodeId} ${lessonIndex}` } }]),
}));

// Настоящие построители, но с записью аргументов.
vi.mock('../domain/lessonBuilder', async (importOriginal) => {
  const real = await importOriginal<typeof import('../domain/lessonBuilder')>();
  return { ...real, buildThemeLesson: vi.fn(real.buildThemeLesson), buildExam: vi.fn(real.buildExam),
    buildWeakSpots: vi.fn(real.buildWeakSpots) };
});

const builder = await import('../domain/lessonBuilder');
const buildThemeLesson = vi.mocked(builder.buildThemeLesson);
const buildExam = vi.mocked(builder.buildExam);
const buildWeakSpots = vi.mocked(builder.buildWeakSpots);

for (const c of [1, 2, 3] as const) {
  const [lo, hi] = BANDS[c];
  pools.byCircle.set(c, THEMES.flatMap((t) => makePuzzles(t.id, 30, lo, hi).map((p) => ({ ...p, id: `c${c}-${p.id}` }))));
}

const stat = (theme: string, rating: number, solved = 5): ThemeStat => ({ theme, rating, solved, clean: solved });
const row = (nodeId: string, lessonIndex: number, clean = 10, total = 10): LessonProgress =>
  ({ nodeId, lessonIndex, clean, total });
const texts = (tasks: LessonTask[]) => tasks.flatMap((t) => (t.kind === 'explain' ? [t.step.text] : []));
const puzzles = (tasks: LessonTask[]) => tasks.flatMap((t) => (t.kind === 'puzzle' ? [t.puzzle] : []));

beforeEach(async () => {
  await db.delete();
  await db.open();
  vi.clearAllMocks();
});

describe('lessonFactory: урок темы', () => {
  it('урок 0 на первом круге темы: полное объяснение, потом 12 задач коридора', async () => {
    const lesson = await lessonFactory('c1:fork', 0);
    expect(lesson.title).toBe('Вилка');
    expect(lesson.source).toBe('lesson');
    expect(lesson.tasks[0]).toEqual({ kind: 'explain', step: expect.objectContaining({ text: 'fork full' }) });
    expect(texts(lesson.tasks)).toEqual(['fork full']);
    const ps = puzzles(lesson.tasks);
    expect(ps).toHaveLength(12);
    expect(ps.every((p) => p.rating >= 400 && p.rating < 900)).toBe(true);
    expect(lesson.tasks.slice(1).every((t) => t.kind === 'puzzle')).toBe(true);
  });

  it('урок 1 и дальше: напоминание', async () => {
    expect(texts((await lessonFactory('c1:fork', 1)).tasks)).toEqual(['fork reminder']);
    expect(texts((await lessonFactory('c1:fork', 4)).tasks)).toEqual(['fork reminder']);
  });

  it('урок 0 темы на более позднем круге: напоминание, задачи коридора этого круга', async () => {
    const lesson = await lessonFactory('c2:fork', 0);
    expect(texts(lesson.tasks)).toEqual(['fork reminder']);
    expect(puzzles(lesson.tasks).every((p) => p.rating >= 900 && p.rating < 1300)).toBe(true);
    // Новая для второго круга тема получает полное объяснение.
    expect(texts((await lessonFactory('c2:attraction', 0)).tasks)).toEqual(['attraction full']);
  });

  it('подстройка: рейтинг темы, слабые темы только из пройденных раньше, виденные задачи', async () => {
    await db.themeStats.bulkPut([
      stat('fork', 750), stat('mateIn1', 500), stat('hangingPiece', 550),
      stat('pin', 300), // идёт после вилки — не слабая тема для неё
    ]);
    await db.attempts.add({ puzzleId: 'c1-fork-0', themes: ['fork'], result: 'clean', source: 'free', rated: true,
      at: 1 });
    await lessonFactory('c1:fork', 2);
    expect(buildThemeLesson).toHaveBeenCalledTimes(1);
    const args = buildThemeLesson.mock.calls[0][0];
    expect(args.node.id).toBe('c1:fork');
    expect(args.themeRating).toBe(750);
    expect(args.weakThemes).toEqual(['mateIn1', 'hangingPiece']);
    expect(args.weakRatings).toMatchObject({ mateIn1: 500, hangingPiece: 550 });
    expect([...args.seen]).toEqual(['c1-fork-0']);
  });

  it('без статистики темы — общий рейтинг и нет слабых тем', async () => {
    await lessonFactory('c1:mateIn1', 0);
    expect(buildThemeLesson.mock.calls[0][0].themeRating).toBe(600);
    await db.kv.put({ key: 'profile', value: { ...(await db.kv.get('profile'))!.value as object, rating: 820 } });
    await lessonFactory('c1:mateIn1', 1);
    const args = buildThemeLesson.mock.calls[1][0];
    expect(args.themeRating).toBe(820);
    expect(args.weakThemes).toEqual([]);
  });

  it('слабые темы предыдущих кругов тоже учитываются, своя тема — нет', async () => {
    await db.themeStats.bulkPut([stat('fork', 200), stat('pin', 400), stat('mateIn1', 450), stat('skewer', 500),
      stat('attraction', 100)]);
    await lessonFactory('c2:deflection', 0);
    // attraction идёт в круге 2 раньше deflection; fork в круге 2 позже, но был в круге 1.
    expect(buildThemeLesson.mock.calls[0][0].weakThemes).toEqual(['attraction', 'fork', 'pin']);
  });
});

describe('lessonFactory: закрепление', () => {
  it('напоминание и задачи темы, название «Закрепление: …»', async () => {
    const lesson = await lessonFactory('c1:fork:reinforce', 0);
    expect(lesson.title).toBe('Закрепление: Вилка');
    expect(lesson.source).toBe('lesson');
    expect(texts(lesson.tasks)).toEqual(['fork reminder']);
    expect(puzzles(lesson.tasks)).toHaveLength(12);
    expect(buildThemeLesson.mock.calls[0][0].node.id).toBe('c1:fork');
  });
});

describe('lessonFactory: контрольная', () => {
  it('задачи раздела по рейтингам тем, источник exam', async () => {
    await db.themeStats.bulkPut([stat('fork', 800)]);
    const lesson = await lessonFactory('c1:exam', 0);
    expect(lesson.title).toBe('Контрольная');
    expect(lesson.source).toBe('exam');
    expect(lesson.tasks.every((t) => t.kind === 'puzzle')).toBe(true);
    expect(lesson.tasks).toHaveLength(15);
    const args = buildExam.mock.calls[0][0];
    expect(args.section).toBe(CURRICULUM.find((s) => s.id === 'c1'));
    expect(args.ratings).toEqual({ fork: 800 });
  });
});

describe('lessonFactory: «Слабые места»', () => {
  it('новый пользователь: темы круга 1, коридор круга 1, задачи со сроком из базы', async () => {
    const today = localDay(new Date());
    await db.reviews.bulkPut([
      { puzzleId: 'c1-pin-3', stage: 1, dueDay: today },
      { puzzleId: 'нет-такой', stage: 1, dueDay: today },
      { puzzleId: 'c1-fork-4', stage: 1, dueDay: '2999-01-01' },
    ]);
    const lesson = await lessonFactory('weak', 0);
    expect(lesson.title).toBe('Слабые места');
    expect(lesson.source).toBe('weak');
    expect(lesson.tasks).toHaveLength(12);
    const args = buildWeakSpots.mock.calls[0][0];
    expect(args.due.map((p) => p.id)).toEqual(['c1-pin-3']);
    expect(args.band).toEqual(BANDS[1]);
    expect(args.weakThemes).toEqual(['mateIn1', 'hangingPiece', 'fork']);
    expect(puzzles(lesson.tasks)[0].id).toBe('c1-pin-3');
    expect(await db.reviews.get('нет-такой')).toBeUndefined();
    expect(await db.reviews.count()).toBe(2);
  });

  it('слабейшие открытые темы по статистике', async () => {
    await db.lessons.bulkPut([row('basics:basics', 0), ...[0, 1, 2, 3, 4].map((i) => row('c1:mateIn1', i))]);
    await db.themeStats.bulkPut([stat('mateIn1', 500), stat('pin', 100)]);
    await lessonFactory('weak', 0);
    expect(buildWeakSpots.mock.calls[0][0].weakThemes).toEqual(['mateIn1']);
  });

  it('если слабейших нет: открытые темы с наименьшим рейтингом; коридор кругов 1..старший открытый', async () => {
    const all = CURRICULUM.flatMap((s) => s.nodes);
    const upTo = all.findIndex((n) => n.id === 'c2:deflection');
    await db.lessons.bulkPut(all.slice(0, upTo).flatMap((n) => Array.from({ length: n.lessons }, (_, i) => row(n.id, i))));
    await db.themeStats.bulkPut([stat('mateIn1', 700, 3), stat('fork', 650, 3), stat('pin', 640, 3),
      stat('skewer', 800, 3), stat('hangingPiece', 900, 3), stat('discoveredAttack', 900, 3), stat('mateIn2', 900, 3),
      stat('backRankMate', 900, 3), stat('attraction', 900, 3)]);
    await lessonFactory('weak', 0);
    const args = buildWeakSpots.mock.calls[0][0];
    // deflection текущая и без статистики — стартовые 600.
    expect(args.weakThemes).toEqual(['deflection', 'pin', 'fork']);
    expect(args.band).toEqual([BANDS[1][0], BANDS[2][1]]);
    // Рейтинги около 600: задачи из коридора круга 1, хотя открыт круг 2.
    expect(args.pool.byId('c1-fork-0')).toBeDefined();
    expect(args.pool.byId('c2-fork-0')).toBeDefined();
    expect(puzzles((await lessonFactory('weak', 1)).tasks).every((p) => p.id.startsWith('c1-'))).toBe(true);
  });
});

describe('lessonFactory: авторские уроки', () => {
  it('берёт урок из содержания', async () => {
    const lesson = await lessonFactory('c1:openings', 2);
    expect(lesson.title).toBe('Дебютные принципы');
    expect(lesson.source).toBe('lesson');
    expect(texts(lesson.tasks)).toEqual(['c1:openings 2']);
    expect(texts((await lessonFactory('basics:basics', 0)).tasks)).toEqual(['basics:basics 0']);
  });

  it('неизвестный узел — ошибка', async () => {
    await expect(lessonFactory('c9:nothing', 0)).rejects.toThrow();
    await expect(lessonFactory('c1:openings:reinforce', 0)).rejects.toThrow();
  });
});

