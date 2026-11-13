import type { ThemeId } from '../domain/types';

export interface Theme { id: ThemeId; title: string; firstCircle: 1 | 2 | 3 }

/** Идентификаторы совпадают с метками Lichess. scripts/build_puzzles.py читает этот файл. */
export const THEMES: Theme[] = [
  { id: 'mateIn1', title: 'Мат в один ход', firstCircle: 1 },
  { id: 'hangingPiece', title: 'Незащищённая фигура', firstCircle: 1 },
  { id: 'fork', title: 'Вилка', firstCircle: 1 },
  { id: 'pin', title: 'Связка', firstCircle: 1 },
  { id: 'skewer', title: 'Сквозной удар', firstCircle: 1 },
  { id: 'discoveredAttack', title: 'Открытое нападение', firstCircle: 1 },
  { id: 'mateIn2', title: 'Мат в два хода', firstCircle: 1 },
  { id: 'backRankMate', title: 'Мат по последней горизонтали', firstCircle: 1 },
  { id: 'attraction', title: 'Завлечение', firstCircle: 2 },
  { id: 'deflection', title: 'Отвлечение', firstCircle: 2 },
  { id: 'capturingDefender', title: 'Уничтожение защитника', firstCircle: 2 },
  { id: 'trappedPiece', title: 'Ловля фигуры', firstCircle: 2 },
  { id: 'doubleCheck', title: 'Двойной шах', firstCircle: 2 },
  { id: 'smotheredMate', title: 'Спёртый мат', firstCircle: 2 },
  { id: 'promotion', title: 'Превращение пешки', firstCircle: 2 },
  { id: 'intermezzo', title: 'Промежуточный ход', firstCircle: 3 },
  { id: 'sacrifice', title: 'Жертва', firstCircle: 3 },
  { id: 'pawnEndgame', title: 'Пешечные окончания', firstCircle: 3 },
  { id: 'rookEndgame', title: 'Ладейные окончания', firstCircle: 3 },
];

export const BANDS: Record<1 | 2 | 3, [number, number]> = {
  1: [400, 900],
  2: [900, 1300],
  3: [1300, 1700],
};
