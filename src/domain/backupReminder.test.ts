import { backupReminderDue } from './backupReminder';

const NOW = new Date(2026, 10, 30, 9, 0);
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime();
const profile = (over: Partial<{ firstDay: string; lastBackupAt: number | null; backupSnoozedAt: number | null }> = {}) =>
  ({ firstDay: '2026-11-01', lastBackupAt: null, backupSnoozedAt: null, ...over });

describe('backupReminderDue', () => {
  it('без копии считает от firstDay: 14 дней — рано, 15 — пора', () => {
    expect(backupReminderDue(profile({ firstDay: '2026-11-16' }), NOW)).toBe(false);
    expect(backupReminderDue(profile({ firstDay: '2026-11-15' }), NOW)).toBe(true);
  });

  it('с копией считает от дня копии, а не от firstDay', () => {
    expect(backupReminderDue(profile({ lastBackupAt: at(16) }), NOW)).toBe(false);
    expect(backupReminderDue(profile({ lastBackupAt: at(15) }), NOW)).toBe(true);
  });

  it('считает календарные дни: час суток не важен', () => {
    expect(backupReminderDue(profile({ lastBackupAt: at(16, 23) }), new Date(2026, 10, 30, 0, 5))).toBe(false);
    expect(backupReminderDue(profile({ lastBackupAt: at(15, 23) }), new Date(2026, 10, 30, 0, 5))).toBe(true);
  });

  it('«Позже» прячет напоминание на 14 дней', () => {
    expect(backupReminderDue(profile({ backupSnoozedAt: at(30) }), NOW)).toBe(false);
    expect(backupReminderDue(profile({ backupSnoozedAt: at(16) }), NOW)).toBe(false);
    expect(backupReminderDue(profile({ backupSnoozedAt: at(15) }), NOW)).toBe(true);
  });

  it('свежая копия важнее старой отсрочки', () => {
    expect(backupReminderDue(profile({ lastBackupAt: at(20), backupSnoozedAt: at(2) }), NOW)).toBe(false);
  });

  it('работает через границу месяца', () => {
    const now = new Date(2026, 11, 3, 10);
    expect(backupReminderDue(profile({ firstDay: '2026-11-19' }), now)).toBe(false);
    expect(backupReminderDue(profile({ firstDay: '2026-11-18' }), now)).toBe(true);
  });
});
