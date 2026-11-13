import { describe, expect, it } from 'vitest';
import { computeStreak, dayCounts } from './streak';

// 9 ноября 2026 — понедельник.
const days = (...d: number[]) => new Set(d.map(n => `2026-11-${String(n).padStart(2, '0')}`));

describe('computeStreak', () => {
  it('будни подряд, суббота ещё идёт', () => {
    expect(computeStreak(days(9, 10, 11, 12, 13), '2026-11-09', '2026-11-14')).toMatchObject({ count: 5, skipUsedThisWeek: false });
    expect(computeStreak(days(9, 10, 11, 12, 13), '2026-11-09', '2026-11-14').week[5]).toEqual({ day: '2026-11-14', state: 'today' });
  });

  it('суббота пропущена и прощена, воскресенье засчитано', () => {
    expect(computeStreak(days(9, 10, 11, 12, 13, 15), '2026-11-09', '2026-11-16').count).toBe(6);
  });

  it('оба выходных пропущены: серия сгорела', () => {
    expect(computeStreak(days(9, 10, 11, 12, 13), '2026-11-09', '2026-11-16').count).toBe(0);
    expect(computeStreak(days(9, 10, 11, 12, 13, 16), '2026-11-09', '2026-11-16').count).toBe(1);
  });

  it('дни до первого запуска не пропуски', () => {
    const mid = computeStreak(days(11, 12, 13), '2026-11-11', '2026-11-13');
    expect(mid.count).toBe(3);
    expect(mid.week[0].state).toBe('before');
  });

  it('по одному прощённому пропуску в двух неделях подряд', () => {
    const two = computeStreak(days(9, 11, 12, 13, 14, 15, 17), '2026-11-09', '2026-11-17');
    expect(two.count).toBe(7);
    expect(two.skipUsedThisWeek).toBe(true);
    expect(two.week[0].state).toBe('forgiven');
  });

  it('дни сравниваются как строки, часовой пояс функции не важен', () => {
    expect(computeStreak(days(13), '2026-11-13', '2026-11-13').count).toBe(1);
  });

  it('второй пропуск недели — missed, дни после сегодня — future', () => {
    const r = computeStreak(days(9, 10, 11), '2026-11-09', '2026-11-14');
    expect(r.count).toBe(0);
    expect(r.skipUsedThisWeek).toBe(true);
    expect(r.week.map(w => w.state)).toEqual(['done', 'done', 'done', 'forgiven', 'missed', 'today', 'future']);
    expect(r.week.map(w => w.day)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('засчитанный сегодняшний день — done', () => {
    const r = computeStreak(days(14), '2026-11-14', '2026-11-14');
    expect(r.count).toBe(1);
    expect(r.week[5]).toEqual({ day: '2026-11-14', state: 'done' });
  });
});

describe('dayCounts', () => {
  it('один урок засчитывает день', () => {
    expect(dayCounts({ day: '2026-11-14', lessons: 1, freePuzzles: 0 })).toBe(true);
  });
  it('десять свободных задач засчитывают день', () => {
    expect(dayCounts({ day: '2026-11-14', lessons: 0, freePuzzles: 10 })).toBe(true);
  });
  it('девять задач без уроков — не засчитан', () => {
    expect(dayCounts({ day: '2026-11-14', lessons: 0, freePuzzles: 9 })).toBe(false);
  });
});
