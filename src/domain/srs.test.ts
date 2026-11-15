import { describe, it, expect } from 'vitest';
import { schedule, dueItems, INTERVALS } from './srs';

describe('srs', () => {
  const s0 = { puzzleId: 'p1', stage: 0 as const, dueDay: '2026-11-14' };
  it('интервалы', () => expect(INTERVALS).toEqual([1, 3, 7, 21]));
  it('чистое решение новой задачи не планируется', () =>
    expect(schedule(undefined, 'p1', 'clean', '2026-11-13')).toBeNull());
  it('ошибка или подсказка ставят задачу на завтра', () => {
    expect(schedule(undefined, 'p1', 'mistake', '2026-11-13')).toEqual(s0);
    expect(schedule(undefined, 'p1', 'hint', '2026-11-13')).toEqual(s0);
  });
  it('чистое решение двигает вперёд', () => {
    expect(schedule(s0, 'p1', 'clean', '2026-11-14')).toEqual({ puzzleId: 'p1', stage: 1, dueDay: '2026-11-17' });
    expect(schedule({ ...s0, stage: 1 }, 'p1', 'clean', '2026-11-17')).toEqual({ puzzleId: 'p1', stage: 2, dueDay: '2026-11-24' });
    expect(schedule({ ...s0, stage: 2 }, 'p1', 'clean', '2026-11-24')).toEqual({ puzzleId: 'p1', stage: 3, dueDay: '2026-12-15' });
  });
  it('чистое решение раньше срока ступень не двигает', () => {
    expect(schedule(s0, 'p1', 'clean', '2026-11-13')).toBe(s0);
    const s1 = { puzzleId: 'p1', stage: 1 as const, dueDay: '2026-11-17' };
    expect(schedule(s1, 'p1', 'clean', '2026-11-15')).toBe(s1);
  });
  it('последняя ступень чисто — задача выходит из повторения', () =>
    expect(schedule({ ...s0, stage: 3 }, 'p1', 'clean', '2026-12-15')).toBeNull());
  it('подсказка сбрасывает на начало', () =>
    expect(schedule({ ...s0, stage: 2 }, 'p1', 'hint', '2026-11-24')).toEqual({ puzzleId: 'p1', stage: 0, dueDay: '2026-11-25' }));
  it('dueItems отбирает наступившие', () => {
    const items = [
      { puzzleId: 'a', stage: 0 as const, dueDay: '2026-11-13' },
      { puzzleId: 'b', stage: 0 as const, dueDay: '2026-11-14' },
      { puzzleId: 'c', stage: 1 as const, dueDay: '2026-11-15' },
    ];
    expect(dueItems(items, '2026-11-14').map(i => i.puzzleId)).toEqual(['a', 'b']);
  });
});
