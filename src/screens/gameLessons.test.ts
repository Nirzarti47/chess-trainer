import 'fake-indexeddb/auto';
import { db } from '../data/db';
import type { GamePuzzle } from '../domain/gameTypes';
import type { LessonTask } from '../domain/types';
import { gameLesson, GAME_NODE_PREFIX } from './gameLessons';
import { LessonNotFoundError } from './lessonErrors';
import { lessonFactory } from './lessonFactory';

const puzzle = (gameId: string, ply: number, loss: number): GamePuzzle => ({
  id: `g:${gameId}:${ply}`, gameId, ply, endTime: 100,
  fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: ['a1a2', 'h1h2'],
  kind: 'pieceEnPrise', phrase: `Фраза ${ply}`, loss,
});

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
