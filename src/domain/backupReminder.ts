import { localDay } from './dates';
import type { Profile } from './types';

/** Сколько дней можно жить без резервной копии и сколько держится «Позже». */
export const BACKUP_REMINDER_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Число календарных дней от одного дня 'YYYY-MM-DD' до другого. */
function daysBetween(from: string, to: string): number {
  const utc = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

const daysSince = (ms: number, today: string) => daysBetween(localDay(new Date(ms)), today);

/** Напоминание нужно, если с последней копии (или с первого дня, если копии не было) прошло больше 14 дней
 *  и «Позже» не нажимали в последние 14 дней. Дни календарные, по местному времени. */
export function backupReminderDue(
  p: Pick<Profile, 'firstDay' | 'lastBackupAt' | 'backupSnoozedAt'>, now: Date,
): boolean {
  const today = localDay(now);
  const sinceBackup = p.lastBackupAt === null ? daysBetween(p.firstDay, today) : daysSince(p.lastBackupAt, today);
  const snoozed = p.backupSnoozedAt !== null && daysSince(p.backupSnoozedAt, today) <= BACKUP_REMINDER_DAYS;
  return sinceBackup > BACKUP_REMINDER_DAYS && !snoozed;
}
