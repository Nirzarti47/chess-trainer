import { describe, it, expect } from 'vitest';
import { localDay, addDays, mondayOf } from './dates';

describe('dates', () => {
  it('mondayOf', () => {
    expect(mondayOf('2026-11-13')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
  });
  it('addDays через границу месяца и назад', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('localDay', () => expect(localDay(new Date(2026, 10, 13, 23, 59))).toBe('2026-11-13'));
});
