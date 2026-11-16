import type { Puzzle, Source, ThemeId } from './types';

/** Что записывать о попытке задачи. Задача из партии рейтинга не имеет и рейтинг владельца не двигает;
 *  обычная идёт в рейтинг, если её ещё не видели и это не повторение. */
export function puzzleAttempt(puzzle: Puzzle, source: Source, seen: ReadonlySet<string>):
  { puzzleId: string; themes: ThemeId[]; puzzleRating: number | undefined; rated: boolean } {
  if (puzzle.game) return { puzzleId: puzzle.id, themes: puzzle.themes, puzzleRating: undefined, rated: false };
  return { puzzleId: puzzle.id, themes: puzzle.themes, puzzleRating: puzzle.rating,
    rated: source !== 'review' && !seen.has(puzzle.id) };
}
