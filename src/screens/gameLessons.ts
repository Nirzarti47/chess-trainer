// Уроки из задач своих партий.
import { toPuzzle } from '../analysis/gamePuzzles';
import { getGamePuzzles } from '../data/gamesRepo';
import { LessonNotFoundError } from './lessonErrors';
import type { Lesson } from './LessonScreen';

/** Узел урока «Исправить ошибки»: `game:<gameId>`. */
export const GAME_NODE_PREFIX = 'game:';

/** «Исправить ошибки»: задачи одной партии по ходу партии. */
export async function gameLesson(gameId: string): Promise<Lesson> {
  const puzzles = (await getGamePuzzles(gameId)).sort((a, b) => a.ply - b.ply);
  if (puzzles.length === 0) {
    throw new LessonNotFoundError(`В партии ${gameId} нет задач`, 'В этой партии нет задач на исправление');
  }
  return { title: 'Исправить ошибки', source: 'game',
    tasks: puzzles.map((p) => ({ kind: 'puzzle', puzzle: toPuzzle(p) })) };
}
