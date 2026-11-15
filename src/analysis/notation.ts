const PIECES: Record<string, string> = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К' };

/** SAN chess.js → русская запись: K→Кр, Q→Ф, R→Л, B→С, N→К, x→:, O-O→0-0, =Q→Ф. */
export function ruSan(san: string): string {
  return san
    .replace(/O/g, '0')
    .replace(/=([KQRBN])/g, (_, p: string) => PIECES[p])
    .replace(/^[KQRBN]/, (p) => PIECES[p])
    .replace(/x/g, ':');
}

/** «8. К:g5» для хода белых, «8… h:g5» для хода чёрных. */
export function moveLabel(ply: number, san: string): string {
  const number = Math.floor(ply / 2) + 1;
  return `${number}${ply % 2 === 0 ? '. ' : '… '}${ruSan(san)}`;
}
