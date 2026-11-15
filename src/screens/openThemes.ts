import { BANDS, THEMES } from '../content/themes';
import { loadCircle, mergePools, type Circle123, type PuzzlePool } from '../data/puzzleStore';
import type { PathView } from '../domain/path';
import type { ThemeId } from '../domain/types';

/** Темы открытых узлов пути (done или current) в порядке пути, у нового пользователя — темы круга 1,
 *  и старший открытый круг. */
export function openThemesOf(path: PathView): { themes: ThemeId[]; circle: Circle123 } {
  const open = path.sections.flatMap((s) => s.items).filter((i) => i.status !== 'locked').map((i) => i.node);
  let themes = [...new Set(open.flatMap((n) => (n.kind === 'theme' && n.themeId ? [n.themeId] : [])))];
  if (themes.length === 0) themes = THEMES.filter((t) => t.firstCircle === 1).map((t) => t.id);
  const circle = Math.max(1, ...open.map((n) => n.circle)) as Circle123;
  return { themes, circle };
}

/** Коридор свободных задач и «Слабых мест»: от низа круга 1 до верха старшего открытого круга.
 *  Уроки пути берут коридор своего круга. */
export function openBand(circle: Circle123): [number, number] {
  return [BANDS[1][0], BANDS[circle][1]];
}

/** Задачи кругов 1..circle одним пулом. */
export async function loadOpenPool(circle: Circle123): Promise<PuzzlePool> {
  const circles = ([1, 2, 3] as const).filter((c) => c <= circle);
  return mergePools(await Promise.all(circles.map((c) => loadCircle(c))));
}
