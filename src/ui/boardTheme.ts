import { boardById } from '../content/boards';
import { pieceUrl } from '../content/pieceSets';
import type { Settings } from '../domain/types';

const ROLES = [
  ['king', 'K'],
  ['queen', 'Q'],
  ['rook', 'R'],
  ['bishop', 'B'],
  ['knight', 'N'],
  ['pawn', 'P'],
] as const;

/** Стили всех досок приложения по текущим настройкам: цвета клеток (CSS-переменные) и картинки фигур.
 *  Статичная часть оформления доски лежит в board.css и опирается на эти переменные. */
export function boardThemeCss(settings: Settings): string {
  const b = boardById(settings.board);
  const vars =
    `.board {\n  --board-light: ${b.light};\n  --board-dark: ${b.dark};\n` +
    `  --board-hi-light: ${b.hiLight};\n  --board-hi-dark: ${b.hiDark};\n}\n`;
  const pieces = (['white', 'black'] as const)
    .flatMap((color) =>
      ROLES.map(
        ([role, letter]) =>
          `.board piece.${color}.${role} { background-image: url("${pieceUrl(settings.pieceSet, color[0] + letter)}"); }`,
      ),
    )
    .join('\n');
  return vars + pieces + '\n';
}
