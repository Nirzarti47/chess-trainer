import type { Circle, ThemeId } from '../domain/types';
import { THEMES, type Theme } from './themes';

export interface PathNode { id: string; kind: 'theme' | 'authored' | 'exam'; title: string;
  themeId?: ThemeId; circle: Circle; lessons: number }
export interface Section { id: string; title: string; circle: Circle; nodes: PathNode[] }

const THEME_LESSONS = 5;

function themeNode(section: string, circle: Circle, t: Theme): PathNode {
  return { id: `${section}:${t.id}`, kind: 'theme', title: t.title, themeId: t.id, circle, lessons: THEME_LESSONS };
}

function examNode(section: string, circle: Circle): PathNode {
  return { id: `${section}:exam`, kind: 'exam', title: 'Контрольная', circle, lessons: 1 };
}

const theme = (id: ThemeId): Theme => THEMES.find((t) => t.id === id)!;

/** Круг 2 и 3: сначала темы, новые в этом круге, потом возвращаются прежние (каждая группа в порядке THEMES). */
function laterCircle(id: string, title: string, circle: 2 | 3): Section {
  const themes = [...THEMES.filter((t) => t.firstCircle === circle), ...THEMES.filter((t) => t.firstCircle < circle)];
  return { id, title, circle, nodes: [...themes.map((t) => themeNode(id, circle, t)), examNode(id, circle)] };
}

export const CURRICULUM: Section[] = [
  {
    id: 'basics', title: 'Проверка основ', circle: 0,
    nodes: [{ id: 'basics:basics', kind: 'authored', title: 'Проверка основ', circle: 0, lessons: 1 }],
  },
  {
    id: 'c1', title: 'Круг 1. Первые удары', circle: 1,
    nodes: [
      ...['mateIn1', 'hangingPiece', 'fork'].map((id) => themeNode('c1', 1, theme(id))),
      { id: 'c1:openings', kind: 'authored', title: 'Дебютные принципы', circle: 1, lessons: 3 },
      ...['pin', 'skewer', 'discoveredAttack', 'mateIn2', 'backRankMate'].map((id) => themeNode('c1', 1, theme(id))),
      examNode('c1', 1),
    ],
  },
  laterCircle('c2', 'Круг 2. Тактика глубже', 2),
  laterCircle('c3', 'Круг 3. Сложные удары', 3),
];
