import { describe, expect, it } from 'vitest';
import type { GameAnalysis, Grade, Mark, MoveReview, Score, SideSummary } from '../domain/gameTypes';
import { CONFIG } from './config';
import { CATEGORY_TITLE } from './phrases';
import { CATEGORY_ORDER, categorize, reportOf, type Category } from './report';

const SUMMARY: SideSummary = {
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 0, kinds: {},
};

interface Spec { loss?: number; grade?: Grade; mark?: Mark }

/** Разбор из заготовок ходов; scores — по умолчанию ровные {cp:0}. */
function analysis(specs: Spec[], scores?: Score[]): GameAnalysis {
  const moves: MoveReview[] = specs.map((s, ply) => ({
    ply, move: 'e2e4', loss: s.loss ?? 0, grade: s.grade ?? 'good', mark: s.mark, best: [], deep: false,
  }));
  return {
    gameId: 'g', rulesVersion: 2, analysedAt: 0, tookMs: 0,
    scores: scores ?? Array.from({ length: specs.length + 1 }, () => ({ cp: 0 })),
    moves, white: SUMMARY, black: SUMMARY,
  };
}

const one = (s: Spec, book = 0): Category => categorize(analysis([s]), book)[0];

describe('categorize: правила по одному', () => {
  it('теория: первые bookPlies ходов, даже зевок', () => {
    const r = categorize(analysis([{ grade: 'blunder', loss: 0.5 }, { grade: 'blunder', loss: 0.5 }, { loss: 0.08 }]), 2);
    expect(r).toEqual(['book', 'book', 'inaccuracy']);
  });
  it('блестящий', () => expect(one({ mark: 'brilliant', grade: 'best' })).toBe('brilliant'));
  it('замечательный', () => expect(one({ mark: 'great', grade: 'best' })).toBe('great'));
  it('лучший', () => expect(one({ grade: 'best' })).toBe('best'));
  it('отлично', () => expect(one({ loss: 0.01 })).toBe('excellent'));
  it('хорошо', () => expect(one({ loss: 0.03 })).toBe('good'));
  it('неточность', () => expect(one({ loss: 0.07 })).toBe('inaccuracy'));
  it('ошибка', () => expect(one({ loss: 0.15 })).toBe('mistake'));
  it('зевок', () => expect(one({ loss: 0.3 })).toBe('blunder'));
  it('теория важнее знака', () => expect(one({ mark: 'brilliant' }, 1)).toBe('book'));
});

describe('categorize: упущенная возможность', () => {
  // ход 0 — белые дарят, ход 1 — чёрные; оценки с точки зрения белых
  const build = (giftLoss: number, loss: number, after: Score) =>
    analysis([{ loss: giftLoss }, { loss }], [{ cp: 0 }, { cp: -300 }, after]);

  it('вернул подарок до равного — miss', () => {
    expect(categorize(build(0.3, 0.2, { cp: 0 }), 0)[1]).toBe('miss');
  });
  it('упал ниже, чем был до подарка, больше чем на 0.05 — зевок', () => {
    expect(categorize(build(0.3, 0.2, { cp: 300 }), 0)[1]).toBe('blunder');
  });
  it('отдал меньше половины подарка — ошибка', () => {
    expect(categorize(build(0.3, 0.12, { cp: 0 }), 0)[1]).toBe('mistake');
  });
  it('соперник сыграл лишь неточность — не miss', () => {
    expect(categorize(build(0.07, 0.12, { cp: 0 }), 0)[1]).toBe('mistake');
  });
  it('ошибка 0.19, опустившая ниже, чем до подарка, — mistake, не miss', () => {
    expect(categorize(build(0.3, 0.19, { cp: 300 }), 0)[1]).toBe('mistake');
  });
  it('граница доли подарка: loss ровно MISS_SHARE × подарок — miss', () => {
    expect(categorize(build(0.3, 0.3 * CONFIG.MISS_SHARE, { cp: 0 }), 0)[1]).toBe('miss');
  });
  it('граница допуска: на 0.05 ниже прежнего — miss, чуть ниже — нет', () => {
    // чёрные до подарка стояли на 0.5; допуск 0.05 → 0.45 у чёрных ≈ +54,5 cp у белых
    expect(categorize(build(0.3, 0.2, { cp: 54 }), 0)[1]).toBe('miss');
    expect(categorize(build(0.3, 0.2, { cp: 55 }), 0)[1]).toBe('blunder');
  });
  it('теоретический ход соперника не подарок — blunder, не miss', () => {
    expect(categorize(build(0.3, 0.2, { cp: 0 }), 1)).toEqual(['book', 'blunder']);
  });
  it('первый ход партии не бывает miss', () => {
    expect(categorize(analysis([{ loss: 0.12 }]), 0)[0]).toBe('mistake');
  });
});

describe('reportOf', () => {
  it('считает по сторонам, сумма равна числу ходов', () => {
    const a = analysis([{ grade: 'best' }, { loss: 0.3 }, { loss: 0.01 }, { loss: 0.3 }, { loss: 0.03 }]);
    const r = reportOf(a, 1);
    expect(r.categories).toEqual(['book', 'blunder', 'excellent', 'blunder', 'good']);
    expect(r.white.counts).toMatchObject({ book: 1, excellent: 1, good: 1, blunder: 0 });
    expect(r.black.counts).toMatchObject({ blunder: 2 });
    const sum = (c: Record<Category, number>) => Object.values(c).reduce((x, y) => x + y, 0);
    expect(sum(r.white.counts)).toBe(3);
    expect(sum(r.black.counts)).toBe(2);
    expect(r.white.accuracy).toBeNull();
  });
  it('без знаков и deep: false сумма тоже сходится', () => {
    const a = analysis(Array.from({ length: 7 }, (_, i) => ({ loss: i * 0.04 })));
    const r = reportOf(a, 0);
    const total = [r.white, r.black].reduce((s, x) => s + Object.values(x.counts).reduce((p, q) => p + q, 0), 0);
    expect(total).toBe(7);
  });
  it('в счёте есть все десять видов', () => {
    expect(Object.keys(reportOf(analysis([{}]), 0).white.counts).sort()).toEqual([...CATEGORY_ORDER].sort());
  });
});

describe('CATEGORY_TITLE', () => {
  it('десять строк', () => {
    expect(CATEGORY_TITLE).toEqual({
      brilliant: 'Блестящий ход', great: 'Замечательный', best: 'Лучший', excellent: 'Отлично', good: 'Хорошо',
      book: 'Теоретический ход', inaccuracy: 'Неточность', mistake: 'Ошибка', miss: 'Упущенная возможность',
      blunder: 'Зевок',
    });
  });
});
