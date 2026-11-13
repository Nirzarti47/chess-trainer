/** Наборы фигур из репозитория lichess-org/lila (public/piece/<id>), файлы лежат в public/pieces/<id>.
 *  Авторы и лицензии — по COPYING.md того же репозитория. */
export interface PieceSet {
  id: string;
  name: string;
  author: string;
  license: string;
}

export const DEFAULT_PIECE_SET = 'maestro';

export const PIECE_SETS: PieceSet[] = [
  { id: 'maestro', name: 'Изящные', author: 'sadsnake1', license: 'CC BY-NC-SA 4.0' },
  { id: 'cburnett', name: 'Классические', author: 'Colin M.L. Burnett', license: 'GPLv2+' },
  { id: 'merida', name: 'Турнирные', author: 'Armando Hernandez Marroquin', license: 'GPLv2+' },
  { id: 'cardinal', name: 'Плотные', author: 'sadsnake1', license: 'CC BY-NC-SA 4.0' },
  { id: 'staunty', name: 'Мягкие', author: 'sadsnake1', license: 'CC BY-NC-SA 4.0' },
  { id: 'california', name: 'Плоские', author: 'Jerry S.', license: 'CC BY-NC-SA 4.0' },
  { id: 'fresca', name: 'Свежие', author: 'sadsnake1', license: 'CC BY-NC-SA 4.0' },
  { id: 'gioco', name: 'Строгие', author: 'sadsnake1', license: 'CC BY-NC-SA 4.0' },
];

/** Набор по id; неизвестный id даёт набор по умолчанию. */
export function pieceSetById(id: string): PieceSet {
  return PIECE_SETS.find((p) => p.id === id) ?? PIECE_SETS.find((p) => p.id === DEFAULT_PIECE_SET)!;
}

/** Относительный адрес картинки фигуры. code — цвет и фигура: 'wN', 'bQ'. */
export function pieceUrl(setId: string, code: string): string {
  return `./pieces/${pieceSetById(setId).id}/${code}.svg`;
}
