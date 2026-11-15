import { describe, expect, it } from 'vitest';
import { moveLabel, ruSan } from './notation';

describe('ruSan', () => {
  it('переводит фигуры, взятие, рокировку и превращение', () => {
    expect(ruSan('Nxg5')).toBe('К:g5');
    expect(ruSan('Kf1')).toBe('Крf1');
    expect(ruSan('Qh5+')).toBe('Фh5+');
    expect(ruSan('O-O')).toBe('0-0');
    expect(ruSan('O-O-O+')).toBe('0-0-0+');
    expect(ruSan('exd5')).toBe('e:d5');
    expect(ruSan('e8=Q#')).toBe('e8Ф#');
    expect(ruSan('Rae1')).toBe('Лae1');
    expect(ruSan('Bb5')).toBe('Сb5');
  });
});

describe('moveLabel', () => {
  it('нумерует ходы белых и чёрных', () => {
    expect(moveLabel(14, 'Nxg5')).toBe('8. К:g5');
    expect(moveLabel(15, 'hxg5')).toBe('8… h:g5');
    expect(moveLabel(0, 'e4')).toBe('1. e4');
  });
});
