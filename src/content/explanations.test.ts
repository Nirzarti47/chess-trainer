import { describe, expect, it } from 'vitest';
import { getAuthoredLesson, getExplain } from './explanations';

describe('explanations', () => {
  it('отдаёт уроки авторских узлов по номеру', () => {
    expect(getAuthoredLesson('basics:basics', 0).length).toBeGreaterThan(0);
    for (const i of [0, 1, 2]) expect(getAuthoredLesson('c1:openings', i).length).toBeGreaterThan(0);
  });

  it('для неизвестного узла или номера урока возвращает пустой список', () => {
    expect(getAuthoredLesson('basics:basics', 1)).toEqual([]);
    expect(getAuthoredLesson('c1:openings', 3)).toEqual([]);
    expect(getAuthoredLesson('c1:fork', 0)).toEqual([]);
  });

  it('полное объяснение длиннее напоминания', () => {
    expect(getExplain('fork', 'full').length).toBeGreaterThan(1);
    expect(getExplain('fork', 'reminder')).toHaveLength(1);
  });

  it('для неизвестной темы возвращает пустой список', () => {
    expect(getExplain('unknown', 'full')).toEqual([]);
    expect(getExplain('constructor', 'full')).toEqual([]);
    expect(getAuthoredLesson('constructor', 0)).toEqual([]);
  });
});
