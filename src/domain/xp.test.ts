import { describe, it, expect } from 'vitest';
import { XP } from './xp';

describe('xp', () => {
  it('значения', () => expect(XP).toEqual({ clean: 10, other: 5, lesson: 20 }));
});
