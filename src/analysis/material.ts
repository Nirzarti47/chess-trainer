import { Chess, type Move } from 'chess.js';

export const PIECE_VALUE: Record<'p' | 'n' | 'b' | 'r' | 'q' | 'k', number> =
  { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Порядок «от дешёвой к дорогой»; король — последним, хотя его цена 0. */
const ORDER = ['p', 'n', 'b', 'r', 'q', 'k'];

/** Делает ход в UCI; null, если хода нет или он недопустим. */
export function playUci(chess: Chess, uci: string | undefined): Move | null {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

/** Выигрыш материала от одного хода: взятая фигура плюс прибавка от превращения. */
function gainOf(m: Move): number {
  const taken = m.captured ? PIECE_VALUE[m.captured] : 0;
  const promo = m.promotion ? PIECE_VALUE[m.promotion] - 1 : 0;
  return taken + promo;
}

/** Что получит сторона, чей ход, продолжая размен на поле sq (не меньше 0 — можно не бить). */
function recapture(chess: Chess, sq: string): number {
  const captures = chess.moves({ verbose: true })
    .filter((m) => m.to === sq && m.captured && (!m.promotion || m.promotion === 'q'));
  if (captures.length === 0) return 0;
  captures.sort((a, b) => ORDER.indexOf(a.piece) - ORDER.indexOf(b.piece));
  const move = captures[0];
  chess.move(move.san);
  const gain = gainOf(move) - recapture(chess, sq);
  chess.undo();
  return Math.max(0, gain);
}

/** Итог размена для стороны, чей ход, если она начинает взятием uci и обе стороны бьют на этом поле
 *  самой дешёвой фигурой, пока это выгодно. Не взятие → 0. */
export function see(fen: string, uci: string): number {
  const chess = new Chess(fen);
  const move = playUci(chess, uci);
  if (!move || !move.captured) return 0;
  return gainOf(move) - recapture(chess, move.to);
}

/** Изменение материала для стороны, чей ход в fen, после первых plies ходов линии (взятия и превращения). */
export function swing(fen: string, line: string[], plies: number): number {
  const chess = new Chess(fen);
  let total = 0;
  for (let i = 0; i < Math.min(plies, line.length); i++) {
    const move = playUci(chess, line[i]);
    if (!move) break;
    total += (i % 2 === 0 ? 1 : -1) * gainOf(move);
  }
  return total;
}
