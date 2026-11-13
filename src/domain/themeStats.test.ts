import { describe, expect, it } from 'vitest';
import { applyAttempt, weakestThemes } from './themeStats';
import type { ThemeStat } from './types';

describe('applyAttempt', () => {
  it('новая тема начинается с 600: чистое решение задачи 600 даёт 620', () => {
    expect(applyAttempt(undefined, 'fork', 600, 'clean')).toEqual({ theme: 'fork', rating: 620, solved: 1, clean: 1 });
  });

  it('ошибка снижает рейтинг и не увеличивает clean', () => {
    expect(applyAttempt(undefined, 'fork', 600, 'mistake')).toEqual({ theme: 'fork', rating: 580, solved: 1, clean: 0 });
  });

  it('подсказка считается нерешённой задачей', () => {
    expect(applyAttempt(undefined, 'pin', 600, 'hint')).toEqual({ theme: 'pin', rating: 580, solved: 1, clean: 0 });
  });

  it('после 20 попыток темы шаг рейтинга меньше', () => {
    const stat: ThemeStat = { theme: 'fork', rating: 600, solved: 20, clean: 10 };
    expect(applyAttempt(stat, 'fork', 600, 'clean')).toEqual({ theme: 'fork', rating: 608, solved: 21, clean: 11 });
  });

  it('не меняет исходный объект', () => {
    const stat: ThemeStat = { theme: 'fork', rating: 700, solved: 3, clean: 2 };
    applyAttempt(stat, 'fork', 700, 'clean');
    expect(stat).toEqual({ theme: 'fork', rating: 700, solved: 3, clean: 2 });
  });
});

describe('weakestThemes', () => {
  const s = (theme: string, rating: number, solved: number): ThemeStat => ({ theme, rating, solved, clean: 0 });
  const stats = [s('fork', 700, 5), s('pin', 500, 10), s('skewer', 400, 4), s('mate', 600, 6), s('other', 300, 9)];

  it('по возрастанию рейтинга, только темы с solved >= 5 из списка among', () => {
    expect(weakestThemes(stats, ['fork', 'pin', 'skewer', 'mate'], 10)).toEqual(['pin', 'mate', 'fork']);
  });

  it('не больше n тем', () => {
    expect(weakestThemes(stats, ['fork', 'pin', 'skewer', 'mate', 'other'], 2)).toEqual(['other', 'pin']);
  });

  it('пусто, если подходящих тем нет', () => {
    expect(weakestThemes(stats, ['skewer'], 3)).toEqual([]);
  });
});
