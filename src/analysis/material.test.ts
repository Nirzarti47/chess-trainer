import { describe, expect, it } from 'vitest';
import { see, swing } from './material';

const DEFENDED = '4k3/8/4p3/3n4/8/8/3R4/4K3 w - - 0 1';
const FREE = '4k3/8/8/3r4/8/8/3R4/4K3 w - - 0 1';

describe('see', () => {
  it('ладья берёт защищённого коня — проигрыш', () => {
    expect(see(DEFENDED, 'd2d5')).toBe(-2);
  });
  it('ладья берёт ладью без защиты', () => {
    expect(see(FREE, 'd2d5')).toBe(5);
  });
  it('не взятие — ноль', () => {
    expect(see(FREE, 'e1e2')).toBe(0);
  });
  it('сторона прекращает бить, когда невыгодно', () => {
    // пешка берёт коня, ладья чёрных не берёт пешку: за ней ладья белых
    expect(see('3rk3/8/8/3n4/4P3/8/8/3RK3 w - - 0 1', 'e4d5')).toBe(3);
  });
  it('взятие на проходе и превращение не падают', () => {
    expect(see('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6')).toBe(1);
    expect(see('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'b7a8q')).toBe(5 + 8);
  });
});

describe('swing', () => {
  it('считает взятия в первых plies ходах', () => {
    expect(swing(DEFENDED, ['d2d5', 'e6d5'], 2)).toBe(-2);
    expect(swing(DEFENDED, ['d2d5', 'e6d5'], 1)).toBe(3);
  });
  it('короткая линия и недопустимый ход', () => {
    expect(swing(DEFENDED, ['d2d5'], 5)).toBe(3);
    expect(swing(DEFENDED, ['d2d5', 'a1a8', 'e6d5'], 3)).toBe(3);
    expect(swing(DEFENDED, ['bad'], 2)).toBe(0);
  });
});
