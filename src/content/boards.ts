/** Цветовые схемы доски. hiLight/hiDark — подсветка последнего хода на светлой и тёмной клетке. */
export interface BoardScheme {
  id: string;
  name: string;
  light: string;
  dark: string;
  hiLight: string;
  hiDark: string;
}

export const DEFAULT_BOARD = 'night';

// Подсветка первых шести схем взята из mockups/boards.html, для двух последних подобрана в том же духе.
export const BOARDS: BoardScheme[] = [
  { id: 'night', name: 'Ночная', light: '#AEBCCB', dark: '#4E657E', hiLight: '#E7CB7A', hiDark: '#C19A3B' },
  { id: 'green', name: 'Зелёная', light: '#EBECD0', dark: '#739552', hiLight: '#F5F682', hiDark: '#B9CA43' },
  { id: 'wood', name: 'Дерево', light: '#F0D9B5', dark: '#B58863', hiLight: '#E6D774', hiDark: '#C9A63C' },
  { id: 'blue', name: 'Серо-голубая', light: '#DEE3E6', dark: '#8CA2AD', hiLight: '#E9DC8B', hiDark: '#C2B25C' },
  { id: 'lilac', name: 'Сиреневая', light: '#E4DFF5', dark: '#8577C2', hiLight: '#FFE08A', hiDark: '#E0A93A' },
  { id: 'teal', name: 'Бирюзовая', light: '#CBD8D1', dark: '#4C7C7E', hiLight: '#E3D58B', hiDark: '#C7A546' },
  { id: 'graphite', name: 'Графитовая', light: '#C9CDD2', dark: '#5E6670', hiLight: '#E5D387', hiDark: '#BF9D44' },
  { id: 'sand', name: 'Песочная', light: '#EFE6D2', dark: '#C2A878', hiLight: '#F4E58E', hiDark: '#D4B24E' },
];

/** Схема по id; неизвестный id (например, из старой копии) даёт схему по умолчанию. */
export function boardById(id: string): BoardScheme {
  return BOARDS.find((b) => b.id === id) ?? BOARDS.find((b) => b.id === DEFAULT_BOARD)!;
}
