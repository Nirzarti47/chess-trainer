import { START_RATING, updateRating } from './rating';
import type { TaskResult, ThemeId, ThemeStat } from './types';

/** Статистика темы после оценённой попытки. Решённой считается только чистая задача, подсказка — нет. */
export function applyAttempt(stat: ThemeStat | undefined, theme: ThemeId, puzzleRating: number, result: TaskResult): ThemeStat {
  const cur = stat ?? { theme, rating: START_RATING, solved: 0, clean: 0 };
  const solved = result === 'clean';
  return {
    theme,
    rating: updateRating(cur.rating, puzzleRating, solved, cur.solved),
    solved: cur.solved + 1,
    clean: cur.clean + (solved ? 1 : 0),
  };
}

/** Самые слабые темы из among (не меньше 5 оценённых попыток), по возрастанию рейтинга, не больше n. */
export function weakestThemes(stats: ThemeStat[], among: ThemeId[], n: number): ThemeId[] {
  const allowed = new Set(among);
  return stats
    .filter(s => allowed.has(s.theme) && s.solved >= 5)
    .sort((a, b) => a.rating - b.rating)
    .slice(0, Math.max(n, 0))
    .map(s => s.theme);
}
