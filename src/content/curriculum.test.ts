import { describe, expect, it } from 'vitest';
import { CURRICULUM } from './curriculum';
import { THEMES } from './themes';

const sec = (id: string) => CURRICULUM.find((s) => s.id === id)!;
const nodeIds = (id: string) => sec(id).nodes.map((n) => n.id);

describe('CURRICULUM', () => {
  it('разделы по порядку с кругами', () => {
    expect(CURRICULUM.map((s) => [s.id, s.title, s.circle])).toEqual([
      ['basics', 'Проверка основ', 0],
      ['c1', 'Круг 1. Первые удары', 1],
      ['c2', 'Круг 2. Тактика глубже', 2],
      ['c3', 'Круг 3. Сложные удары', 3],
    ]);
  });

  it('основы — один авторский узел на 1 урок', () => {
    expect(sec('basics').nodes).toEqual([
      { id: 'basics:basics', kind: 'authored', title: 'Проверка основ', circle: 0, lessons: 1 },
    ]);
  });

  it('круг 1: порядок тем, дебютные принципы после вилки, контрольная в конце', () => {
    expect(nodeIds('c1')).toEqual(['c1:mateIn1', 'c1:hangingPiece', 'c1:fork', 'c1:openings', 'c1:pin',
      'c1:skewer', 'c1:discoveredAttack', 'c1:mateIn2', 'c1:backRankMate', 'c1:exam']);
    const openings = sec('c1').nodes[3];
    expect(openings).toMatchObject({ kind: 'authored', title: 'Дебютные принципы', lessons: 3, circle: 1 });
  });

  it('круги 2 и 3: сначала новые темы, потом старые, затем контрольная', () => {
    const order = (c: 2 | 3) => [
      ...THEMES.filter((t) => t.firstCircle === c),
      ...THEMES.filter((t) => t.firstCircle < c),
    ].map((t) => `c${c}:${t.id}`);
    expect(nodeIds('c2')).toEqual([...order(2), 'c2:exam']);
    expect(nodeIds('c3')).toEqual([...order(3), 'c3:exam']);
    expect(nodeIds('c2')).toHaveLength(16);
    expect(nodeIds('c3')).toHaveLength(20);
  });

  it('узлы тем: 5 уроков, название темы, themeId и круг раздела; контрольные — 1 урок', () => {
    for (const s of CURRICULUM) {
      for (const n of s.nodes) {
        expect(n.circle).toBe(s.circle);
        if (n.kind === 'theme') {
          expect(n.lessons).toBe(5);
          expect(n.id).toBe(`${s.id}:${n.themeId}`);
          expect(n.title).toBe(THEMES.find((t) => t.id === n.themeId)!.title);
        }
        if (n.kind === 'exam') expect(n).toMatchObject({ id: `${s.id}:exam`, title: 'Контрольная', lessons: 1 });
      }
    }
  });
});
