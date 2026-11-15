export type TimeClass = 'rapid' | 'blitz' | 'bullet' | 'daily';
export type Side = 'white' | 'black';

export interface GameRecord {
  id: string;              // uuid партии на Chess.com
  url: string; endTime: number /* мс */; timeClass: TimeClass; timeControl: string;
  userColor: Side; userRating: number; opponent: string; opponentRating: number;
  result: 'win' | 'loss' | 'draw'; endReason: string /* код Chess.com: checkmated, resigned, timeout… */;
  moves: string[];         // ходы в UCI с начальной позиции
}

/** Оценка всегда с точки зрения белых. mate > 0 — мат ставят белые. over — партия на доске закончена. */
export type Score = { cp: number } | { mate: number } | { over: Side | 'draw' };
export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type Mark = 'brilliant' | 'great';
export type MistakeKind = 'missedMate' | 'allowedMate' | 'pieceEnPrise' | 'pieceUndefended'
  | 'missedCapture' | 'missedFork' | 'badTrade' | 'other';

export interface AltMove { move: string; score: Score; pv: string[] }

export interface MoveReview {
  ply: number;             // 0 — первый ход белых
  move: string; loss: number /* 0..1, потеря ожидаемого результата сыгравшего */;
  grade: Grade; mark?: Mark;
  kind?: MistakeKind; phrase?: string;   // только у mistake и blunder
  best: AltMove[];         // 1–3 лучших хода из позиции перед ходом, сильнейший первым
  deep: boolean;           // true — данные второго прохода
}

export interface SideSummary {
  grades: Record<Grade, number>; brilliant: number; great: number;
  accuracy: number /* 0..100 */; kinds: Partial<Record<MistakeKind, number>>;
}

export interface GameAnalysis {
  gameId: string; rulesVersion: number; analysedAt: number; tookMs: number;
  scores: Score[];         // scores[i] — позиция после i полуходов; длина moves.length + 1
  moves: MoveReview[]; white: SideSummary; black: SideSummary;
}

export interface GamePuzzle {
  id: string /* `g:${gameId}:${ply}` */; gameId: string; ply: number; endTime: number;
  fen: string /* позиция перед ходом соперника (ply − 1) */; moves: [string, string] /* ход соперника, верный ход */;
  kind: MistakeKind; phrase: string; loss: number;
}

export interface ChessUser { nick: string; loadedThrough: string | null /* 'YYYY/MM' */ }
export type RangeChoice =
  | { by: 'count'; n: 10 | 20 | 50 }
  | { by: 'time'; span: 'week' | 'month' | 'quarter' | 'all' };
