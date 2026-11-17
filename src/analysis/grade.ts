import { Chess, type Square } from 'chess.js';
import type { AltMove, Grade, MoveReview, Score, Side, SideSummary } from '../domain/gameTypes';
import { CONFIG } from './config';
import { PIECE_VALUE, playUci, see } from './material';
import { expected, moveAccuracy } from './score';

export function gradeOf(loss: number, playedIsBest: boolean): Grade {
  if (playedIsBest) return 'best';
  if (loss < CONFIG.GOOD_MAX) return 'good';
  if (loss < CONFIG.INACCURACY_MAX) return 'inaccuracy';
  if (loss < CONFIG.MISTAKE_MAX) return 'mistake';
  return 'blunder';
}

/** «Сильный ход»: лучший, а второй по силе заметно хуже. best — линии из позиции перед ходом
 *  (белая точка зрения), сильнейшая первой. Ответное взятие не отмечается. Очевидные ходы тоже:
 *  взятие, мат и уход фигуры, на которую нападала более дешёвая фигура соперника. */
export function isGreat(a: { grade: Grade; best: AltMove[]; mover: Side; isRecapture: boolean; fenBefore: string;
  move: string }): boolean {
  if (a.grade !== 'best' || a.isRecapture || a.best.length < 2) return false;
  if (expected(a.best[0].score, a.mover) - expected(a.best[1].score, a.mover) < CONFIG.GREAT_GAP) return false;

  const chess = new Chess(a.fenBefore);
  const foe = chess.turn() === 'w' ? 'b' : 'w';
  const from = a.move.slice(0, 2) as Square;
  const own = chess.get(from);
  // король не в счёт: его «цена» 0, но нападение короля фигуру не гонит
  const chased = !!own && chess.attackers(from, foe).some((sq) => {
    const t = chess.get(sq)!.type;
    return t !== 'k' && PIECE_VALUE[t] < PIECE_VALUE[own.type];
  });
  const m = playUci(chess, a.move);
  return !!m && !m.captured && !chess.isCheckmate() && !chased;
}

/** «Блестящий ход»: почти лучший, отдаёт фигуру под бой, позиция после хода не хуже равной,
 *  а до хода не была уже выигранной. */
export function isBrilliant(a: { loss: number; fenBefore: string; move: string; before: Score; after: Score;
  mover: Side }): boolean {
  if (a.loss >= CONFIG.BRILLIANT_MAX_LOSS) return false;
  if (expected(a.before, a.mover) > CONFIG.BRILLIANT_MAX_BEFORE) return false;
  if (expected(a.after, a.mover) < 0.5) return false;

  const chess = new Chess(a.fenBefore);
  let taken: number;
  try {
    const m = chess.move({ from: a.move.slice(0, 2), to: a.move.slice(2, 4), promotion: a.move[4] });
    taken = (m.captured ? PIECE_VALUE[m.captured] : 0) + (m.promotion ? PIECE_VALUE[m.promotion] - 1 : 0);
  } catch {
    return false;
  }
  const fenAfter = chess.fen();
  // у соперника есть выгодное взятие фигуры (не пешки) сыгравшего, и сам ход столько не взял
  return chess.moves({ verbose: true }).some((m) => {
    if (!m.captured || PIECE_VALUE[m.captured] < 3) return false;
    const gain = see(fenAfter, m.from + m.to + (m.promotion ?? ''));
    return gain >= CONFIG.MATERIAL_WIN && taken < gain;
  });
}

const EMPTY_GRADES = (): Record<Grade, number> => ({ best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 });

/** Сводка по одной стороне: ходы с чётным ply — белые. */
export function summarize(moves: MoveReview[], side: Side): SideSummary {
  const own = moves.filter((m) => (m.ply % 2 === 0) === (side === 'white'));
  const s: SideSummary = { grades: EMPTY_GRADES(), brilliant: 0, great: 0, accuracy: 0, kinds: {} };
  for (const m of own) {
    s.grades[m.grade]++;
    if (m.mark === 'brilliant') s.brilliant++;
    if (m.mark === 'great') s.great++;
    if (m.kind && (m.grade === 'mistake' || m.grade === 'blunder')) s.kinds[m.kind] = (s.kinds[m.kind] ?? 0) + 1;
  }
  if (own.length > 0) s.accuracy = own.reduce((sum, m) => sum + moveAccuracy(m.loss), 0) / own.length;
  return s;
}
