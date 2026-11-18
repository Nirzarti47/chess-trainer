import type { GameAnalysis, Side } from '../domain/gameTypes';
import { CONFIG } from './config';
import { expected } from './score';

export type Category = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';

/** Порядок строк сводки, как у Chess.com. */
export const CATEGORY_ORDER: readonly Category[] =
  ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

const moverOf = (ply: number): Side => (ply % 2 === 0 ? 'white' : 'black');

/** Ход i вернул не меньше половины подаренного и не опустил сторону ниже, чем до ошибки соперника. */
function isMiss(a: GameAnalysis, i: number): boolean {
  if (i < 1) return false;
  const m = a.moves[i];
  const prev = a.moves[i - 1];
  if (prev.loss < CONFIG.INACCURACY_MAX || m.loss < CONFIG.INACCURACY_MAX) return false;
  if (m.loss < CONFIG.MISS_SHARE * prev.loss) return false;
  const mover = moverOf(m.ply);
  return expected(a.scores[i + 1], mover) >= expected(a.scores[i - 1], mover) - CONFIG.MISS_SLACK;
}

/** Вид каждого хода: результат[i] — для a.moves[i]. bookPlies — сколько первых полуходов партии теоретические. */
export function categorize(a: GameAnalysis, bookPlies: number): Category[] {
  return a.moves.map((m, i): Category => {
    if (i < bookPlies) return 'book';
    if (m.mark === 'brilliant') return 'brilliant';
    if (m.mark === 'great') return 'great';
    if (m.grade === 'best') return 'best';
    if (m.loss < CONFIG.EXCELLENT_MAX) return 'excellent';
    if (m.loss < CONFIG.GOOD_MAX) return 'good';
    if (m.loss < CONFIG.INACCURACY_MAX) return 'inaccuracy';
    if (isMiss(a, i)) return 'miss';
    if (m.loss < CONFIG.MISTAKE_MAX) return 'mistake';
    return 'blunder';
  });
}

export interface SideReport { counts: Record<Category, number>; accuracy: number | null }
export interface GameReport { categories: Category[]; white: SideReport; black: SideReport }

const emptyCounts = (): Record<Category, number> =>
  Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<Category, number>;

/** Счёт видов по сторонам. Точность пока null: её подставит задача 2. */
export function reportOf(a: GameAnalysis, bookPlies: number): GameReport {
  const categories = categorize(a, bookPlies);
  const white: SideReport = { counts: emptyCounts(), accuracy: null };
  const black: SideReport = { counts: emptyCounts(), accuracy: null };
  categories.forEach((c, i) => (moverOf(a.moves[i].ply) === 'white' ? white : black).counts[c]++);
  return { categories, white, black };
}
