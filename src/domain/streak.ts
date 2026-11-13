import { addDays, mondayOf } from './dates';
import type { DayLog } from './types';

export type DayState = 'done' | 'forgiven' | 'missed' | 'today' | 'future' | 'before';
export interface StreakInfo { count: number; skipUsedThisWeek: boolean; week: { day: string; state: DayState }[] }

/** День засчитан: хотя бы один урок или не меньше 10 свободных задач. */
export function dayCounts(log: DayLog): boolean {
  return log.lessons >= 1 || log.freePuzzles >= 10;
}

/** Серия: засчитанный день +1; первый пропуск в неделе (пн–вс) прощается, второй и следующие обнуляют.
 *  Сегодняшний день пропуском не считается. Дни — строки 'YYYY-MM-DD', сравниваются как строки. */
export function computeStreak(activeDays: ReadonlySet<string>, firstDay: string, today: string): StreakInfo {
  const states = new Map<string, DayState>();
  let count = 0;
  let week = '';
  let skipUsed = false;

  for (let day = firstDay; day <= today; day = addDays(day, 1)) {
    const monday = mondayOf(day);
    if (monday !== week) {
      week = monday;
      skipUsed = false;
    }
    if (activeDays.has(day)) {
      count += 1;
      states.set(day, 'done');
    } else if (day === today) {
      states.set(day, 'today');
    } else if (!skipUsed) {
      skipUsed = true;
      states.set(day, 'forgiven');
    } else {
      count = 0;
      states.set(day, 'missed');
    }
  }

  const monday = mondayOf(today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map(day => {
    let state: DayState;
    if (day < firstDay) state = 'before';
    else if (day > today) state = 'future';
    else state = states.get(day)!;
    return { day, state };
  });

  return {
    count,
    skipUsedThisWeek: weekDays.some(d => d.state === 'forgiven'),
    week: weekDays,
  };
}
