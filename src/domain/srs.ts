import type { ReviewItem, TaskResult } from './types';
import { addDays } from './dates';

export const INTERVALS = [1, 3, 7, 21];

/** Новое состояние повторения задачи или null, если повторять больше не нужно. */
export function schedule(
  item: ReviewItem | undefined,
  puzzleId: string,
  result: TaskResult,
  today: string,
): ReviewItem | null {
  if (result !== 'clean') {
    return { puzzleId, stage: 0, dueDay: addDays(today, INTERVALS[0]) };
  }
  if (!item || item.stage === 3) return null;
  const stage = (item.stage + 1) as 1 | 2 | 3;
  return { puzzleId, stage, dueDay: addDays(today, INTERVALS[stage]) };
}

export function dueItems(items: ReviewItem[], today: string): ReviewItem[] {
  return items.filter(i => i.dueDay <= today);
}
