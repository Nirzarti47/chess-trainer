import 'fake-indexeddb/auto';
import { CONFIG } from '../analysis/config';
import { BANDS } from '../content/themes';
import { db } from '../data/db';
import { putGames, saveAnalysis } from '../data/gamesRepo';
import type { GameAnalysis, GamePuzzle, GameRecord, MistakeKind, MoveReview, SideSummary, TimeClass } from '../domain/gameTypes';
import { makePuzzles } from '../domain/testPool';
import type { LessonTask, Puzzle } from '../domain/types';
import { gameLesson, GAME_NODE_PREFIX, PATTERN_NODE, patternLesson } from './gameLessons';
import { LessonNotFoundError } from './lessonErrors';
import { lessonFactory } from './lessonFactory';

// Общая база: по 30 задач каждой нужной темы в коридоре круга 1.
const base = vi.hoisted(() => ({ puzzles: [] as Puzzle[] }));
vi.mock('../data/puzzleStore', async (importOriginal) => {
  const { fakePool } = await import('../domain/testPool');
  return {
    ...(await importOriginal<typeof import('../data/puzzleStore')>()),
    loadCircle: vi.fn(async (c: number) => fakePool(c === 1 ? base.puzzles : [])),
  };
});
base.puzzles = (['hangingPiece', 'mateIn1', 'mateIn2', 'fork', 'pin'] as const)
  .flatMap((t) => makePuzzles(t, 30, BANDS[1][0], BANDS[1][1]));

const puzzle = (gameId: string, ply: number, loss: number): GamePuzzle => ({
  id: `g:${gameId}:${ply}`, gameId, ply, endTime: 100,
  fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: ['a1a2', 'h1h2'],
  kind: 'pieceEnPrise', phrase: `Фраза ${ply}`, loss,
});

const DAY = 24 * 60 * 60 * 1000;

function game(id: string, endTime: number, timeClass: TimeClass = 'rapid'): GameRecord {
  return {
    id, url: `https://www.chess.com/game/live/${id}`, endTime, timeClass, timeControl: '600', userColor: 'white',
    userRating: 800, opponent: 'rival_one', opponentRating: 820, result: 'loss', endReason: 'resigned', moves: [],
  };
}

const side: SideSummary = {
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 70, kinds: {},
};

/** Разбор, где у владельца (белые) ошибки перечисленных видов на ходах 0, 2, 4… */
const analysis = (gameId: string, kinds: MistakeKind[]): GameAnalysis => ({
  gameId, rulesVersion: CONFIG.RULES_VERSION, analysedAt: 1, tookMs: 1, scores: [], white: side, black: side,
  moves: kinds.map((kind, i): MoveReview => ({ ply: i * 2, move: 'e2e4', loss: 0.3, grade: 'blunder', kind, best: [], deep: false })),
});

const own = (gameId: string, ply: number, kind: MistakeKind, endTime: number): GamePuzzle =>
  ({ ...puzzle(gameId, ply, 0.3), kind, endTime });

/** Партия с разбором и задачами из неё. */
async function addGame(g: GameRecord, kinds: MistakeKind[], puzzles: Array<[number, MistakeKind]>) {
  await putGames([g]);
  await saveAnalysis(analysis(g.id, kinds), { put: puzzles.map(([ply, kind]) => own(g.id, ply, kind, g.endTime)), removeIds: [] });
}

async function markClean(...puzzleIds: string[]) {
  await db.attempts.bulkAdd(puzzleIds.map((puzzleId) =>
    ({ puzzleId, themes: [], result: 'clean' as const, source: 'pattern' as const, rated: false, at: 1 })));
}

const ids = (tasks: LessonTask[]) => tasks.map((t) => (t.kind === 'puzzle' ? t.puzzle.id : t.kind));

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('gameLesson', () => {
  it('урок из задач партии по возрастанию хода, источник game', async () => {
    // В базе задачи лежат в порядке потерь; урок идёт по ходу партии.
    await db.gamePuzzles.bulkPut([puzzle('x', 21, 0.5), puzzle('x', 5, 0.2), puzzle('x', 12, 0.4), puzzle('y', 3, 0.9)]);
    const lesson = await gameLesson('x');
    expect(lesson.title).toBe('Исправить ошибки');
    expect(lesson.source).toBe('game');
    expect(ids(lesson.tasks)).toEqual(['g:x:5', 'g:x:12', 'g:x:21']);
    const first = lesson.tasks[0];
    expect(first.kind === 'puzzle' && first.puzzle.game).toEqual({ gameId: 'x', ply: 5, phrase: 'Фраза 5' });
  });

  it('партия без задач: LessonNotFoundError', async () => {
    await db.gamePuzzles.put(puzzle('y', 3, 0.9));
    await expect(gameLesson('x')).rejects.toBeInstanceOf(LessonNotFoundError);
  });

  it('lessonFactory: узел game:<id> — урок этой партии', async () => {
    await db.gamePuzzles.bulkPut([puzzle('x', 9, 0.3), puzzle('x', 7, 0.6)]);
    expect(GAME_NODE_PREFIX).toBe('game:');
    const lesson = await lessonFactory('game:x', 0);
    expect(ids(lesson.tasks)).toEqual(['g:x:7', 'g:x:9']);
    await expect(lessonFactory('game:nothing', 0)).rejects.toBeInstanceOf(LessonNotFoundError);
  });
});

describe('patternLesson', () => {
  const now = Date.now();
  const isOwn = (id: string) => id.startsWith('g:');
  const baseThemes = (tasks: LessonTask[]) =>
    tasks.flatMap((t) => (t.kind === 'puzzle' && !t.puzzle.game ? [t.puzzle.themes[0]] : []));

  it('8 своих, 3 решены чисто: 6 своих (нерешённые первыми), 4 из базы, вперемешку', async () => {
    await addGame(game('new', now - DAY), ['pieceEnPrise', 'pieceEnPrise', 'missedMate'],
      [[2, 'pieceEnPrise'], [4, 'missedMate'], [6, 'pieceEnPrise'], [8, 'missedMate']]);
    await addGame(game('old', now - 2 * DAY), ['pieceEnPrise', 'missedMate'],
      [[2, 'missedMate'], [4, 'pieceEnPrise'], [6, 'pieceEnPrise'], [8, 'missedMate'], [10, 'missedFork']]);
    // Блиц в промежуток не входит: его задачи не берутся.
    await addGame(game('fast', now, 'blitz'), ['pieceEnPrise'], [[2, 'pieceEnPrise']]);
    await markClean('g:new:2', 'g:new:4', 'g:old:2');

    const lesson = await patternLesson();
    expect(lesson.title).toBe('Частые ошибки');
    expect(lesson.source).toBe('pattern');
    const all = ids(lesson.tasks);
    expect(all).toHaveLength(CONFIG.PATTERN_SIZE);
    expect(all.filter(isOwn)).toEqual(['g:new:6', 'g:new:8', 'g:old:4', 'g:old:6', 'g:old:8', 'g:new:2']);
    expect(all.map(isOwn)).toEqual([true, false, true, false, true, false, true, false, true, true]);
    // Темы видов pieceEnPrise и missedMate поровну: hangingPiece, mateIn1, mateIn2 по очереди.
    expect(baseThemes(lesson.tasks).sort()).toEqual(['hangingPiece', 'hangingPiece', 'mateIn1', 'mateIn2']);
  });

  it('своих 2: 2 своих и 8 из базы', async () => {
    await addGame(game('a', now - DAY), ['missedMate', 'pieceEnPrise'], [[2, 'missedMate'], [4, 'pieceEnPrise']]);
    const all = ids((await patternLesson()).tasks);
    expect(all).toHaveLength(10);
    expect(all.filter(isOwn)).toEqual(['g:a:2', 'g:a:4']);
    expect(all.slice(0, 4).map(isOwn)).toEqual([true, false, true, false]);
    expect(new Set(baseThemes((await patternLesson()).tasks))).toEqual(new Set(['hangingPiece', 'mateIn1', 'mateIn2']));
  });

  it('вид без темы в базе (badTrade) и 3 своих: урок из 3 задач', async () => {
    await addGame(game('a', now - DAY), ['badTrade', 'badTrade', 'badTrade'],
      [[2, 'badTrade'], [4, 'badTrade'], [6, 'badTrade']]);
    expect(ids((await patternLesson()).tasks)).toEqual(['g:a:2', 'g:a:4', 'g:a:6']);
  });

  it('задачи партии с устаревшим разбором (другая версия правил) в урок не попадают', async () => {
    await addGame(game('a', now - DAY), ['badTrade', 'badTrade'], [[2, 'badTrade'], [4, 'badTrade']]);
    // Партия промежутка с задачами, но разбор её старой версии правил.
    await putGames([game('stale', now - 2 * DAY)]);
    await saveAnalysis({ ...analysis('stale', ['badTrade']), rulesVersion: CONFIG.RULES_VERSION - 1 },
      { put: [own('stale', 2, 'badTrade', now - 2 * DAY)], removeIds: [] });
    expect(ids((await patternLesson()).tasks)).toEqual(['g:a:2', 'g:a:4']);
  });

  it('ничего нет: LessonNotFoundError с текстом для экрана; lessonFactory ведёт узел pattern сюда', async () => {
    expect(PATTERN_NODE).toBe('pattern');
    await expect(patternLesson()).rejects.toMatchObject({
      name: 'LessonNotFoundError', screenText: 'Пока не из чего собрать тренировку: разбери больше партий',
    });
    await expect(lessonFactory('pattern', 0)).rejects.toBeInstanceOf(LessonNotFoundError);
    await addGame(game('a', now - DAY), ['badTrade'], [[2, 'badTrade']]);
    expect(ids((await lessonFactory('pattern', 3)).tasks)).toEqual(['g:a:2']);
  });
});
