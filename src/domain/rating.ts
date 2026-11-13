export const START_RATING = 600;
const FLOOR = 100;

export function expectedScore(player: number, puzzle: number): number {
  return 1 / (1 + 10 ** ((puzzle - player) / 400));
}

export function updateRating(player: number, puzzle: number, solved: boolean, ratedCount: number): number {
  const k = ratedCount < 20 ? 40 : 16;
  const next = player + k * ((solved ? 1 : 0) - expectedScore(player, puzzle));
  return Math.max(FLOOR, Math.round(next));
}

/** Задача на 120 пунктов легче игрока: ожидаемый успех около 2 из 3. */
export function targetPuzzleRating(player: number): number {
  return player - 120;
}
