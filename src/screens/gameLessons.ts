// Уроки из задач своих партий.
import { CONFIG } from '../analysis/config';
import { toPuzzle } from '../analysis/gamePuzzles';
import { countKinds, gamesInRange, trainKinds } from '../analysis/patterns';
import { THEMES_OF_KIND } from '../analysis/phrases';
import {
  getAnalyses, getCleanPuzzleIds, getGamePuzzles, getGames, getPatternRange,
} from '../data/gamesRepo';
import { getLessonProgress, getProfile, getSeenPuzzleIds, getThemeStats } from '../data/repo';
import { buildFromThemes } from '../domain/lessonBuilder';
import { buildPath } from '../domain/path';
import type { LessonTask, Puzzle, ThemeId } from '../domain/types';
import { LessonNotFoundError } from './lessonErrors';
import type { Lesson } from './LessonScreen';
import { loadOpenPool, openBand, openThemesOf } from './openThemes';

/** Узел урока «Исправить ошибки»: `game:<gameId>`. */
export const GAME_NODE_PREFIX = 'game:';
/** Узел урока «Частые ошибки». */
export const PATTERN_NODE = 'pattern';

/** «Исправить ошибки»: задачи одной партии по ходу партии. */
export async function gameLesson(gameId: string): Promise<Lesson> {
  const puzzles = (await getGamePuzzles(gameId)).sort((a, b) => a.ply - b.ply);
  if (puzzles.length === 0) {
    throw new LessonNotFoundError(`В партии ${gameId} нет задач`, 'В этой партии нет задач на исправление');
  }
  return { title: 'Исправить ошибки', source: 'game',
    tasks: puzzles.map((p) => ({ kind: 'puzzle', puzzle: toPuzzle(p) })) };
}

/** Задачи общей базы на темы видов: пул и коридор как у «Слабых мест», около рейтинга владельца. */
async function basePuzzles(themes: ThemeId[], total: number): Promise<Puzzle[]> {
  if (themes.length === 0 || total <= 0) return [];
  const [stats, progress, profile, seen] = await Promise.all([
    getThemeStats(), getLessonProgress(), getProfile(), getSeenPuzzleIds(),
  ]);
  // Число задач со сроком на старший открытый круг не влияет.
  const { circle } = openThemesOf(buildPath(progress, stats, profile.fastTrackDeclined, 0));
  return buildFromThemes({ themes, total, near: profile.rating, pool: await loadOpenPool(circle),
    band: openBand(circle), seen, rng: Math.random });
}

/** Вперемешку: своя, из базы, своя… Остаток длинного списка — в конце. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/** «Частые ошибки»: свои задачи самых частых видов из выбранного промежутка и задачи базы на их темы. */
export async function patternLesson(now: Date = new Date()): Promise<Lesson> {
  const [range, allGames, analyses, allPuzzles, clean] = await Promise.all([
    getPatternRange(), getGames(), getAnalyses(), getGamePuzzles(), getCleanPuzzleIds(),
  ]);
  const games = gamesInRange(allGames, range, now.getTime());
  const kinds = trainKinds(countKinds(games, analyses));

  // Свои — только из партий с разбором нынешней версии правил, как в countKinds.
  // Сначала ещё не решённые чисто, внутри — от новых партий к старым и по ходу партии.
  const current = new Set(analyses.filter((a) => a.rulesVersion === CONFIG.RULES_VERSION).map((a) => a.gameId));
  const gameIds = new Set(games.filter((g) => current.has(g.id)).map((g) => g.id));
  const own = allPuzzles.filter((p) => gameIds.has(p.gameId) && kinds.includes(p.kind))
    .sort((a, b) => Number(clean.has(a.id)) - Number(clean.has(b.id)) || b.endTime - a.endTime || a.ply - b.ply)
    .slice(0, CONFIG.PATTERN_OWN_MAX)
    .map(toPuzzle);

  const themes = [...new Set(kinds.flatMap((k) => THEMES_OF_KIND[k]))];
  const base = await basePuzzles(themes, CONFIG.PATTERN_SIZE - own.length);

  const tasks: LessonTask[] = interleave(own, base).map((puzzle) => ({ kind: 'puzzle', puzzle }));
  if (tasks.length === 0) {
    throw new LessonNotFoundError('Для «Частых ошибок» нет задач',
      'Пока не из чего собрать тренировку: разбери больше партий');
  }
  return { title: 'Частые ошибки', source: 'pattern', tasks };
}
