import { describe, expect, it } from 'vitest';
import { expected, formatScore, lossOf, moveAccuracy, toWhite } from './score';

describe('expected', () => {
  it('переводит сантипешки в ожидаемый результат', () => {
    expect(expected({ cp: 0 }, 'white')).toBe(0.5);
    expect(expected({ cp: 100 }, 'white')).toBeCloseTo(0.591, 3);
    expect(expected({ cp: 100 }, 'black')).toBeCloseTo(0.409, 3);
    expect(expected({ cp: 300 }, 'white')).toBeCloseTo(0.751, 3);
  });
  it('мат и конец партии', () => {
    expect(expected({ mate: 2 }, 'white')).toBe(1);
    expect(expected({ mate: 2 }, 'black')).toBe(0);
    expect(expected({ mate: -1 }, 'white')).toBe(0);
    expect(expected({ over: 'draw' }, 'black')).toBe(0.5);
    expect(expected({ over: 'black' }, 'black')).toBe(1);
  });
});

describe('toWhite', () => {
  it('меняет знак для чёрных', () => {
    expect(toWhite({ cp: 50 }, 'black')).toEqual({ cp: -50 });
    expect(toWhite({ mate: 2 }, 'black')).toEqual({ mate: -2 });
    expect(toWhite({ cp: 50 }, 'white')).toEqual({ cp: 50 });
  });
});

describe('lossOf', () => {
  it('считает потерю ходившего', () => {
    expect(lossOf({ cp: 100 }, { cp: -200 }, 'white')).toBeCloseTo(0.267, 2);
    expect(lossOf({ cp: 0 }, { cp: 80 }, 'white')).toBe(0);
    expect(lossOf({ cp: 100 }, { cp: 300 }, 'black')).toBeCloseTo(0.751 - 0.591, 2);
  });
});

describe('moveAccuracy', () => {
  it('убывает с потерей', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 1);
    expect(moveAccuracy(0.1)).toBeCloseTo(63.6, 0);
    expect(moveAccuracy(0.5)).toBeCloseTo(8.5, 0);
    expect(moveAccuracy(1)).toBe(0);
  });
});

describe('formatScore', () => {
  it('пишет оценку по-русски', () => {
    expect(formatScore({ cp: 130 })).toBe('+1,3');
    expect(formatScore({ cp: -40 })).toBe('−0,4');
    expect(formatScore({ cp: 0 })).toBe('0,0');
    expect(formatScore({ mate: 3 })).toBe('М3');
    expect(formatScore({ mate: -2 })).toBe('−М2');
    expect(formatScore({ over: 'white' })).toBe('1–0');
    expect(formatScore({ over: 'black' })).toBe('0–1');
    expect(formatScore({ over: 'draw' })).toBe('½–½');
  });
});
