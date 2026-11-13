import { describe, it, expect } from 'vitest';
import { expectedScore, updateRating, targetPuzzleRating, START_RATING } from './rating';

describe('rating', () => {
  it('стартовый рейтинг', () => expect(START_RATING).toBe(600));
  it('ожидаемый результат', () => expect(expectedScore(600, 600)).toBeCloseTo(0.5));
  it('первые 20 задач: K = 40', () => {
    expect(updateRating(600, 600, true, 0)).toBe(620);
    expect(updateRating(600, 600, false, 0)).toBe(580);
  });
  it('дальше K = 16', () => {
    expect(updateRating(600, 600, true, 20)).toBe(608);
    expect(updateRating(600, 1000, false, 30)).toBe(599);
  });
  it('пол 100', () => expect(updateRating(105, 100, false, 30)).toBeGreaterThanOrEqual(100));
  it('целевой рейтинг задачи', () => expect(targetPuzzleRating(1000)).toBe(880));
});
