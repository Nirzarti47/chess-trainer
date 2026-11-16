import { describe, expect, it } from 'vitest';
import { CURRICULUM } from '../content/curriculum';
import type { LessonProgress, ThemeStat } from './types';
import { buildPath, cleanShare, FAST_TRACK_FROM, REINFORCE_BELOW, EXAM_ADVICE_BELOW, WEAK_MIN_SOLVED,
  type PathItem, type PathView } from './path';

const ALL_NODES = CURRICULUM.flatMap((s) => s.nodes);

const row = (nodeId: string, lessonIndex: number, clean: number, total = 10): LessonProgress =>
  ({ nodeId, lessonIndex, clean, total });

/** Все уроки всех узлов до указанного (не включая его), без ошибок. */
function doneBefore(nodeId: string): LessonProgress[] {
  const out: LessonProgress[] = [];
  for (const n of ALL_NODES) {
    if (n.id === nodeId) return out;
    for (let i = 0; i < n.lessons; i++) out.push(row(n.id, i, 10));
  }
  return out;
}

const items = (v: PathView): PathItem[] => v.sections.flatMap((s) => s.items);
const item = (v: PathView, id: string): PathItem => items(v).find((i) => i.node.id === id)!;
const build = (progress: LessonProgress[], declined: string[] = []) => buildPath(progress, [], declined, 0);

describe('константы', () => {
  it('значения из плана', () => {
    expect([REINFORCE_BELOW, FAST_TRACK_FROM, EXAM_ADVICE_BELOW, WEAK_MIN_SOLVED]).toEqual([0.70, 0.90, 0.60, 20]);
  });
});

describe('cleanShare', () => {
  it('сумма чистых / сумма всех по записям узла', () => {
    const p = [row('c1:fork', 0, 8, 10), row('c1:fork', 1, 4, 10), row('c1:pin', 0, 0, 10)];
    expect(cleanShare('c1:fork', p)).toBeCloseTo(0.6);
  });
  it('нет записей или нулевой итог — 1', () => {
    expect(cleanShare('c1:fork', [])).toBe(1);
    expect(cleanShare('c1:fork', [row('c1:fork', 0, 0, 0)])).toBe(1);
  });
});

describe('buildPath', () => {
  it('пустой прогресс: первый узел current, остальные locked, слабые места скрыты', () => {
    const v = build([]);
    expect(v.sections.map((s) => s.section.id)).toEqual(CURRICULUM.map((s) => s.id));
    const all = items(v);
    expect(all).toHaveLength(ALL_NODES.length);
    expect(all[0]).toMatchObject({ status: 'current', lessonsDone: 0, nextLesson: 0, reinforcement: false,
      fastTrackOffer: false });
    expect(all.slice(1).every((i) => i.status === 'locked' && i.nextLesson === null)).toBe(true);
    expect(v.weakSpots).toEqual({ visible: false, dueCount: 0 });
  });

  it('5 уроков темы с долей 0,8: узел done, следующий current, закрепления нет', () => {
    const p = [...doneBefore('c1:mateIn1'), ...[0, 1, 2, 3, 4].map((i) => row('c1:mateIn1', i, 8))];
    const v = build(p);
    expect(item(v, 'c1:mateIn1')).toMatchObject({ status: 'done', lessonsDone: 5, nextLesson: null });
    expect(item(v, 'c1:hangingPiece')).toMatchObject({ status: 'current', nextLesson: 0 });
    expect(items(v).some((i) => i.reinforcement)).toBe(false);
  });

  it('доля 0,6: после узла закрепление, следующий узел всё равно current; после прохождения исчезает', () => {
    const p = [...doneBefore('c1:mateIn1'), ...[0, 1, 2, 3, 4].map((i) => row('c1:mateIn1', i, 6))];
    const v = build(p);
    const c1 = v.sections.find((s) => s.section.id === 'c1')!.items;
    expect(c1[0].node.id).toBe('c1:mateIn1');
    expect(c1[1]).toMatchObject({
      node: { id: 'c1:mateIn1:reinforce', kind: 'theme', themeId: 'mateIn1', circle: 1, lessons: 1,
        title: `Закрепление: ${c1[0].node.title}` },
      status: 'current', reinforcement: true, fastTrackOffer: false, lessonsDone: 0, nextLesson: 0,
    });
    expect(c1[2]).toMatchObject({ node: { id: 'c1:hangingPiece' }, status: 'current', reinforcement: false });
    expect(items(v).filter((i) => i.status === 'current' && !i.reinforcement)).toHaveLength(1);

    const after = build([...p, row('c1:mateIn1:reinforce', 0, 3)]);
    expect(items(after).some((i) => i.reinforcement)).toBe(false);
    expect(items(after)).toHaveLength(ALL_NODES.length);
  });

  describe('ускорение', () => {
    const base = doneBefore('c1:mateIn1');
    const twoLessons = (clean0: number, clean1: number) =>
      [...base, row('c1:mateIn1', 0, clean0, 25), row('c1:mateIn1', 1, clean1, 25)];

    it('уроки 0 и 1 с долей 0,92 — предложение; следующий урок по порядку 2', () => {
      const v = build(twoLessons(23, 23));
      expect(item(v, 'c1:mateIn1')).toMatchObject({ status: 'current', fastTrackOffer: true, lessonsDone: 2,
        nextLesson: 2 });
    });
    it('узел в declined — нет предложения', () => {
      expect(item(build(twoLessons(23, 23), ['c1:mateIn1']), 'c1:mateIn1').fastTrackOffer).toBe(false);
    });
    it('доля 0,85 — нет предложения', () => {
      const p = [...base, row('c1:mateIn1', 0, 17, 20), row('c1:mateIn1', 1, 17, 20)];
      expect(item(build(p), 'c1:mateIn1').fastTrackOffer).toBe(false);
    });
    it('пройден только урок 0 — нет предложения', () => {
      expect(item(build([...base, row('c1:mateIn1', 0, 10)]), 'c1:mateIn1').fastTrackOffer).toBe(false);
    });
    it('урок 2 уже начат — нет предложения', () => {
      const v = build([...twoLessons(25, 25), row('c1:mateIn1', 2, 0)]);
      expect(item(v, 'c1:mateIn1')).toMatchObject({ fastTrackOffer: false, nextLesson: 3, lessonsDone: 3 });
    });
    it('после уроков 0, 1 и 4 узел done, следующий current', () => {
      const v = build([...twoLessons(23, 23), row('c1:mateIn1', 4, 5)]);
      expect(item(v, 'c1:mateIn1')).toMatchObject({ status: 'done', lessonsDone: 3, nextLesson: null,
        fastTrackOffer: false });
      expect(item(v, 'c1:hangingPiece').status).toBe('current');
    });
    it('уроки 0, 1 и 4 при доле уроков 0–1 ниже 0,9 — узел не пройден, следующий урок 2', () => {
      const v = build([...twoLessons(10, 10), row('c1:mateIn1', 4, 25, 25)]);
      expect(item(v, 'c1:mateIn1')).toMatchObject({ status: 'current', nextLesson: 2 });
    });
    it('авторский узел и контрольная не получают предложение', () => {
      const p = [...doneBefore('c1:openings'), row('c1:openings', 0, 10), row('c1:openings', 1, 10)];
      expect(item(build(p), 'c1:openings')).toMatchObject({ status: 'current', fastTrackOffer: false, nextLesson: 2 });
      expect(item(build(doneBefore('c1:exam')), 'c1:exam')).toMatchObject({ status: 'current', fastTrackOffer: false });
    });
  });

  it('контрольная с долей 0,3 пройдена и открывает следующий раздел', () => {
    const v = build([...doneBefore('c1:exam'), row('c1:exam', 0, 3)]);
    expect(item(v, 'c1:exam')).toMatchObject({ status: 'done', reinforcement: false });
    const c2 = v.sections.find((s) => s.section.id === 'c2')!.items;
    expect(c2[0].status).toBe('current');
    expect(items(v).some((i) => i.reinforcement)).toBe(false);
  });

  it('авторский узел пройден, когда есть все уроки, при любом результате', () => {
    const p = [...doneBefore('c1:openings'), ...[0, 1, 2].map((i) => row('c1:openings', i, 0))];
    const v = build(p);
    expect(item(v, 'c1:openings')).toMatchObject({ status: 'done', lessonsDone: 3 });
    expect(items(v).some((i) => i.reinforcement)).toBe(false);
    expect(item(v, 'c1:pin').status).toBe('current');
  });

  it('переход между разделами: основы пройдены — открыт первый узел круга 1', () => {
    const v = build([row('basics:basics', 0, 1, 5)]);
    expect(item(v, 'basics:basics').status).toBe('done');
    expect(item(v, 'c1:mateIn1').status).toBe('current');
  });

  it('следующий урок — наименьший непройденный; lessonsDone — число разных уроков', () => {
    const p = [...doneBefore('c1:fork'), row('c1:fork', 0, 10), row('c1:fork', 2, 10), row('c1:fork', 0, 10)];
    expect(item(build(p), 'c1:fork')).toMatchObject({ status: 'current', lessonsDone: 2, nextLesson: 1 });
  });

  it('записи с чужими nodeId (weak, неизвестные) не влияют на путь', () => {
    const noise = [row('weak', 0, 0), row('weak', 1, 0), row('c9:nothing', 0, 0), row('basics:basics:extra', 0, 0)];
    expect(build(noise)).toEqual(build([]));
  });

  it('уроки «Исправить ошибки» (nodeId game:<id>) не влияют на путь', () => {
    const p = doneBefore('c1:fork');
    const games = [row('game:x', 0, 0), row('game:x', 1, 2), row('game:y', 0, 10)];
    expect(build([...p, ...games])).toEqual(build(p));
    expect(build(games)).toEqual(build([]));
  });

  it('current ровно один — первый непройденный, даже если дальше есть пройденные узлы', () => {
    const p = [...doneBefore('c1:mateIn1'), ...[0, 1, 2, 3, 4].map((i) => row('c1:hangingPiece', i, 10))];
    const v = build(p);
    expect(item(v, 'c1:mateIn1').status).toBe('current');
    expect(item(v, 'c1:hangingPiece').status).toBe('done');
    expect(item(v, 'c1:fork').status).toBe('locked');
    expect(items(v).filter((i) => i.status === 'current')).toHaveLength(1);
  });

  it('всё пройдено: нет current узла', () => {
    const v = build(doneBefore('__end__'));
    expect(items(v).every((i) => i.status === 'done' && i.nextLesson === null)).toBe(true);
  });

  it('weakSpots: тема с solved 20 включает видимость, dueCount пробрасывается', () => {
    const stat = (solved: number): ThemeStat => ({ theme: 'fork', rating: 1200, solved, clean: 0 });
    expect(buildPath([], [stat(19)], [], 7).weakSpots).toEqual({ visible: false, dueCount: 7 });
    expect(buildPath([], [stat(19), stat(20)], [], 3).weakSpots).toEqual({ visible: true, dueCount: 3 });
  });
});
