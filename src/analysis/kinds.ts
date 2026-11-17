import { Chess, type Move, type PieceSymbol } from 'chess.js';
import type { AltMove, MistakeKind, Score, Side } from '../domain/gameTypes';
import { CONFIG } from './config';
import { PIECE_VALUE, playUci, see, swing } from './material';
import { ruSan } from './notation';
import { OTHER_PHRASE } from './phrases';

type Result = { kind: MistakeKind; phrase: string };

/** Названия фигур: именительный и винительный падеж, женский род. */
const PIECE: Record<PieceSymbol, { nom: string; acc: string; fem: boolean }> = {
  p: { nom: 'пешка', acc: 'пешку', fem: true },
  n: { nom: 'конь', acc: 'коня', fem: false },
  b: { nom: 'слон', acc: 'слона', fem: false },
  r: { nom: 'ладья', acc: 'ладью', fem: true },
  q: { nom: 'ферзь', acc: 'ферзя', fem: false },
  k: { nom: 'король', acc: 'короля', fem: false },
};
/** «нападал на две ладьи» — две одинаковые фигуры. */
const TWO: Record<PieceSymbol, string> = {
  p: 'две пешки', n: 'двух коней', b: 'двух слонов', r: 'две ладьи', q: 'двух ферзей', k: 'двух королей',
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const ending = (p: PieceSymbol, fem: string, masc: string) => (PIECE[p].fem ? fem : masc);

/** Число ходов до мата в пользу side, если мат не дольше MATE_KIND_MAX; иначе null. */
function mateFor(score: Score | undefined, side: Side): number | null {
  if (!score || !('mate' in score)) return null;
  const n = side === 'white' ? score.mate : -score.mate;
  return n > 0 && n <= CONFIG.MATE_KIND_MAX ? n : null;
}

/** Что отдано и что взято в первых трёх полуходах линии, начатой сыгравшим. */
function trade(fen: string, line: string[]): { given: PieceSymbol[]; taken: PieceSymbol[] } {
  const chess = new Chess(fen);
  const given: PieceSymbol[] = [];
  const taken: PieceSymbol[] = [];
  for (let i = 0; i < Math.min(3, line.length); i++) {
    const m = playUci(chess, line[i]);
    if (!m) break;
    if (m.captured) (i % 2 === 0 ? taken : given).push(m.captured);
  }
  return { given, taken };
}

/** Самая дорогая НЕ пешка среди взятых; если взяты одни пешки — undefined. */
function bestPrize(taken: PieceSymbol[]): PieceSymbol | undefined {
  return taken.filter((p) => p !== 'p').sort((x, y) => PIECE_VALUE[y] - PIECE_VALUE[x])[0];
}

/** Вилка после хода m: пришедшая фигура нападает на две фигуры соперника (дороже её или без защиты)
 *  либо даёт шах и нападает на одну такую. Пешки целями не считаются. Фраза или null. */
function forkPhrase(chess: Chess, m: Move): string | null {
  const own = m.color;
  const foe = own === 'w' ? 'b' : 'w';
  const piece = m.promotion ?? m.piece;
  const value = PIECE_VALUE[piece];
  let check = false;
  const targets: PieceSymbol[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== foe) continue;
      if (!chess.attackers(cell.square, own).includes(m.to)) continue;
      if (cell.type === 'k') check = true;
      else if (cell.type !== 'p' && (PIECE_VALUE[cell.type] > value || !chess.isAttacked(cell.square, foe))) {
        targets.push(cell.type);
      }
    }
  }
  targets.sort((x, y) => PIECE_VALUE[y] - PIECE_VALUE[x]);
  let whom: string;
  if (check && targets.length >= 1) whom = `короля и ${PIECE[targets[0]].acc}`;
  else if (targets.length >= 2) whom = targets[0] === targets[1] ? TWO[targets[0]]
    : `${PIECE[targets[0]].acc} и ${PIECE[targets[1]].acc}`;
  else return null;
  return `${cap(PIECE[piece].nom)} на ${m.to} нападал${ending(piece, 'а', '')} сразу на ${whom}`;
}

/** Вид ошибки по линиям движка. Все оценки — с точки зрения белых. При сомнении — other.
 *  reply — лучший ответ соперника после сыгранного хода (линия из позиции после хода) или null. */
export function classifyMistake(a: { fenBefore: string; played: string; best: AltMove[]; reply: AltMove | null;
  after: Score; mover: Side }): Result {
  const top = a.best[0] as AltMove | undefined;
  const foe: Side = a.mover === 'white' ? 'black' : 'white';

  // 1. Пропущен мат
  const mateIn = mateFor(top?.score, a.mover);
  if (mateIn !== null && mateFor(a.after, a.mover) === null) {
    return { kind: 'missedMate', phrase: `Здесь был мат в ${mateIn} ${mateIn === 1 ? 'ход' : 'хода'}` };
  }
  // 2. Допущен мат
  if (mateFor(a.after, foe) !== null && mateFor(top?.score, foe) === null) {
    return { kind: 'allowedMate', phrase: 'После этого хода соперник ставит мат' };
  }

  // 3–5. По ответу соперника
  const reply = a.reply?.pv ?? [];
  const chess = new Chess(a.fenBefore);
  const played = playUci(chess, a.played);
  if (played && reply.length > 0) {
    const fenAfter = chess.fen();
    const r = playUci(chess, reply[0]);
    // соперник отвечает на поле сыгранного хода (там фигура сыгравшего, так что это взятие)
    const sameSquare = r?.to === played.to;
    // 3. Невыгодный размен: сыгранный ход — взятие, соперник отбивает на том же поле
    if (played.captured && sameSquare && swing(a.fenBefore, [a.played, ...reply], 3) <= -CONFIG.MATERIAL_WIN) {
      const { given, taken } = trade(a.fenBefore, [a.played, ...reply]);
      if (given.length > 0 && taken.length > 0) {
        const gave = given.map((p) => PIECE[p].nom).join(' и ');
        const got = taken.map((p) => PIECE[p].acc).join(' и ');
        return { kind: 'badTrade', phrase: `Размен в пользу соперника: ${gave} за ${got}` };
      }
    }
    // 4–5. Соперник забирает фигуру (не пешку) с выигрышем материала
    // взятое сыгранным ходом вычитается только при размене на том же поле (равный размен не ошибка)
    const gained = played.captured && sameSquare ? PIECE_VALUE[played.captured] : 0;
    if (r?.captured && !r.flags.includes('e') && PIECE_VALUE[r.captured] >= CONFIG.MATERIAL_WIN
      && swing(fenAfter, reply, 3) - gained >= CONFIG.MATERIAL_WIN) {
      if (sameSquare) {
        const p = played.promotion ?? played.piece;
        return { kind: 'pieceEnPrise', phrase: `${cap(PIECE[p].nom)} поставлен${ending(p, 'а', '')} под бой: `
          + `${ending(p, 'её', 'его')} заберёт ${PIECE[r.piece].nom} ${r.from}` };
      }
      const left = `${cap(PIECE[r.captured].nom)} на ${r.to} остал${ending(r.captured, 'ась', 'ся')}`;
      // защищённую фигуру забирают с выгодой: она осталась под боем, а не без защиты
      const defended = new Chess(fenAfter).isAttacked(r.to, played.color);
      return { kind: 'pieceUndefended', phrase: defended
        ? `${left} под боем: ${ending(r.captured, 'её', 'его')} заберёт ${PIECE[r.piece].nom} ${r.from}`
        : `${left} без защиты` };
    }
  }

  if (top && top.move !== a.played) {
    const board = new Chess(a.fenBefore);
    const m = playUci(board, top.move);
    const wins = swing(a.fenBefore, top.pv, 3) >= CONFIG.MATERIAL_WIN;
    // 6. Пропущен захват: первым ходом лучшей линии берётся фигура; если берётся пешка, нужна
    // фигура, взятая в этих трёх полуходах. Сыгранный ход, забравший на том же поле, захват не пропустил
    const tookSame = played?.captured !== undefined && played.to === m?.to;
    if (m?.captured && !tookSame && wins) {
      if (PIECE_VALUE[m.captured] >= CONFIG.MATERIAL_WIN) {
        const free = see(a.fenBefore, top.move) === PIECE_VALUE[m.captured];
        return { kind: 'missedCapture', phrase: `Можно было забрать ${PIECE[m.captured].acc}${free ? ' бесплатно' : ''}` };
      }
      const prize = m.captured === 'p' ? bestPrize(trade(a.fenBefore, top.pv).taken) : undefined;
      if (prize) {
        // взятие пешки с вилкой (К:c7+, К:f7) — это пропущенная вилка (правило 7), а не захват
        const fork = forkPhrase(board, m);
        if (fork) return { kind: 'missedFork', phrase: fork };
        return { kind: 'missedCapture', phrase: `Взятие ${ruSan(m.san)} выигрывало ${PIECE[prize].acc}` };
      }
    }
    // 7. Пропущена вилка
    const fork = m && wins ? forkPhrase(board, m) : null;
    if (fork) return { kind: 'missedFork', phrase: fork };
    // 8. Пропущен сильный шах (мат ловит правило 1)
    if (m && board.isCheck() && !board.isCheckmate()) {
      const prize = wins ? bestPrize(trade(a.fenBefore, top.pv).taken) : undefined;
      return { kind: 'missedCheck', phrase: prize
        ? `Шах ${ruSan(m.san)} выигрывал ${PIECE[prize].acc}`
        : `Шах ${ruSan(m.san)} давал сильную атаку` };
    }
  }

  return { kind: 'other', phrase: OTHER_PHRASE };
}
