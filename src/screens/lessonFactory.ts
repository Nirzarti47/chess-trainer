import { CURRICULUM, type PathNode, type Section } from '../content/curriculum';
import { getAuthoredLesson, getExplain } from '../content/explanations';
import { THEMES } from '../content/themes';
import { findPuzzle, loadCircle, type Circle123 } from '../data/puzzleStore';
import { getDueReviews, getLessonProgress, getProfile, getSeenPuzzleIds, getThemeStats } from '../data/repo';
import { localDay } from '../domain/dates';
import { bandOf, buildExam, buildThemeLesson, buildWeakSpots } from '../domain/lessonBuilder';
import { buildPath } from '../domain/path';
import { START_RATING } from '../domain/rating';
import { weakestThemes } from '../domain/themeStats';
import type { LessonTask, Puzzle, ThemeId, ThemeStat } from '../domain/types';
import type { Lesson } from './LessonScreen';
import { openThemesOf } from './openThemes';

const REINFORCE_SUFFIX = ':reinforce';
const WEAK_NODE = 'weak';
const WEAK_THEMES = 3;

const ALL_NODES: PathNode[] = CURRICULUM.flatMap((s) => s.nodes);

type Ratings = Record<ThemeId, number>;

const ratingsOf = (stats: ThemeStat[]): Ratings => Object.fromEntries(stats.map((s) => [s.theme, s.rating]));
const asPuzzleTasks = (ps: Puzzle[]): LessonTask[] => ps.map((puzzle) => ({ kind: 'puzzle', puzzle }));

/** Темы тематических узлов, стоящих на пути раньше node, без её собственной темы. */
function themesBefore(node: PathNode): ThemeId[] {
  const before = ALL_NODES.slice(0, ALL_NODES.indexOf(node));
  return [...new Set(before.flatMap((n) => (n.kind === 'theme' && n.themeId && n.themeId !== node.themeId
    ? [n.themeId] : [])))];
}

/** Урок темы: объяснение, затем задачи с подстройкой под рейтинг и с хвостом из слабых тем. */
async function themeLesson(node: PathNode, mode: 'full' | 'reminder', title: string): Promise<Lesson> {
  const themeId = node.themeId!;
  const [pool, stats, seen] = await Promise.all([
    loadCircle(node.circle as Circle123), getThemeStats(), getSeenPuzzleIds(),
  ]);
  const ratings = ratingsOf(stats);
  const puzzles = buildThemeLesson({
    node, pool, themeRating: ratings[themeId] ?? START_RATING,
    weakThemes: weakestThemes(stats, themesBefore(node), WEAK_THEMES), weakRatings: ratings, seen, rng: Math.random,
  });
  const explain: LessonTask[] = getExplain(themeId, mode).map((step) => ({ kind: 'explain', step }));
  return { title, source: 'lesson', tasks: [...explain, ...asPuzzleTasks(puzzles)] };
}

function explainMode(node: PathNode, lessonIndex: number): 'full' | 'reminder' {
  const theme = THEMES.find((t) => t.id === node.themeId);
  return lessonIndex === 0 && theme?.firstCircle === node.circle ? 'full' : 'reminder';
}

async function examLesson(section: Section): Promise<Lesson> {
  const [pool, stats, seen] = await Promise.all([
    loadCircle(section.circle as Circle123), getThemeStats(), getSeenPuzzleIds(),
  ]);
  const puzzles = buildExam({ section, pool, ratings: ratingsOf(stats), seen, rng: Math.random });
  return { title: 'Контрольная', source: 'exam', tasks: asPuzzleTasks(puzzles) };
}

/** «Слабые места»: задачи со сроком повторения плюс слабейшие из открытых тем в коридоре самого высокого открытого круга. */
async function weakLesson(): Promise<Lesson> {
  const today = localDay(new Date());
  const [stats, progress, profile, reviews, seen] = await Promise.all([
    getThemeStats(), getLessonProgress(), getProfile(), getDueReviews(today), getSeenPuzzleIds(),
  ]);
  const { themes: openThemes, circle } = openThemesOf(
    buildPath(progress, stats, profile.fastTrackDeclined, reviews.length));

  const ratings = ratingsOf(stats);
  let weakThemes = weakestThemes(stats, openThemes, WEAK_THEMES);
  if (weakThemes.length === 0) {
    // sort стабилен: при равном рейтинге остаётся порядок пути.
    weakThemes = openThemes.slice().sort((a, b) => (ratings[a] ?? START_RATING) - (ratings[b] ?? START_RATING))
      .slice(0, WEAK_THEMES);
  }

  const [pool, found] = await Promise.all([
    loadCircle(circle), Promise.all(reviews.map((r) => findPuzzle(r.puzzleId))),
  ]);
  const due = found.filter((p): p is Puzzle => p !== undefined);
  const puzzles = buildWeakSpots({ due, weakThemes, ratings, pool, band: bandOf(circle), seen, rng: Math.random });
  return { title: 'Слабые места', source: 'weak', tasks: asPuzzleTasks(puzzles) };
}

/** Задания урока по узлу пути: тема, закрепление темы (`<узел>:reinforce`), контрольная, «Слабые места» (`weak`)
 *  или авторский урок. */
export async function lessonFactory(nodeId: string, lessonIndex: number): Promise<Lesson> {
  if (nodeId === WEAK_NODE) return weakLesson();

  const reinforce = nodeId.endsWith(REINFORCE_SUFFIX);
  const id = reinforce ? nodeId.slice(0, -REINFORCE_SUFFIX.length) : nodeId;
  const node = ALL_NODES.find((n) => n.id === id);
  if (!node || (reinforce && node.kind !== 'theme')) throw new Error(`Урок ${nodeId} не найден`);

  if (reinforce) return themeLesson(node, 'reminder', `Закрепление: ${node.title}`);
  switch (node.kind) {
    case 'theme':
      return themeLesson(node, explainMode(node, lessonIndex), node.title);
    case 'exam':
      return examLesson(CURRICULUM.find((s) => s.nodes.includes(node))!);
    case 'authored':
      return { title: node.title, source: 'lesson', tasks: getAuthoredLesson(nodeId, lessonIndex) };
  }
}
