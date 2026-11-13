import { describe, expect, it } from 'vitest';
import { getAuthoredLesson, getExplain } from './explanations';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('explanations (заглушка)', () => {
  it('отдаёт по одному шагу-заполнителю', () => {
    expect(getAuthoredLesson('c1:openings', 0)).toEqual([
      { kind: 'explain', step: { fen: START, text: 'Объяснение появится позже' } },
    ]);
    expect(getExplain('fork', 'full')).toEqual([{ fen: START, text: 'Объяснение появится позже' }]);
    expect(getExplain('fork', 'reminder')).toHaveLength(1);
  });
});
