import { THEMES } from '../content/themes';
import type { Circle123 } from '../data/puzzleStore';
import type { PathView } from '../domain/path';
import type { ThemeId } from '../domain/types';

/** Темы открытых узлов пути (done или current) в порядке пути, у нового пользователя — темы круга 1,
 *  и старший открытый круг, по которому берётся коридор задач. */
export function openThemesOf(path: PathView): { themes: ThemeId[]; circle: Circle123 } {
  const open = path.sections.flatMap((s) => s.items).filter((i) => i.status !== 'locked').map((i) => i.node);
  let themes = [...new Set(open.flatMap((n) => (n.kind === 'theme' && n.themeId ? [n.themeId] : [])))];
  if (themes.length === 0) themes = THEMES.filter((t) => t.firstCircle === 1).map((t) => t.id);
  const circle = Math.max(1, ...open.map((n) => n.circle)) as Circle123;
  return { themes, circle };
}
