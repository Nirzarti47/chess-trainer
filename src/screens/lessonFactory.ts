import { CURRICULUM } from '../content/curriculum';
import { getAuthoredLesson } from '../content/explanations';
import { loadCircle, type Circle123 } from '../data/puzzleStore';
import { getSeenPuzzleIds } from '../data/repo';
import { buildThemeLesson } from '../domain/lessonBuilder';
import { START_RATING } from '../domain/rating';
import type { Lesson } from './LessonScreen';

/** Задания урока узла пути. Пока минимально: тема — задачи из базы без подстройки, остальное — авторские шаги.
 *  Задача 12 добавит подстройку под рейтинг, слабые темы, закрепление и «Слабые места». */
export async function lessonFactory(nodeId: string, lessonIndex: number): Promise<Lesson> {
  const node = CURRICULUM.flatMap((s) => s.nodes).find((n) => n.id === nodeId);
  if (!node) throw new Error(`Урок ${nodeId} не найден`);
  if (node.kind === 'theme') {
    const [pool, seen] = await Promise.all([loadCircle(node.circle as Circle123), getSeenPuzzleIds()]);
    const puzzles = buildThemeLesson({ node, pool, themeRating: START_RATING, weakThemes: [], weakRatings: {}, seen,
      rng: Math.random });
    return { title: node.title, source: 'lesson', tasks: puzzles.map((puzzle) => ({ kind: 'puzzle', puzzle })) };
  }
  return { title: node.title, source: 'lesson', tasks: getAuthoredLesson(nodeId, lessonIndex) };
}
