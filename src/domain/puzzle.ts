import { Chess, type Move } from 'chess.js';
import type { Puzzle, TaskResult } from './types';

export interface PuzzleState { puzzle: Puzzle; fen: string; step: number; mistakes: number;
  hintLevel: 0 | 1 | 2; status: 'playing' | 'solved' | 'revealed'; lastMove: [string, string] | null }

export type MoveOutcome = 'correct' | 'solved' | 'wrong' | 'illegal';

/** Делает ход в UCI (`e2e4`, `e7e8q`); null, если ход недопустим. */
function playUci(chess: Chess, uci: string): Move | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

export function startPuzzle(p: Puzzle): PuzzleState {
  const chess = new Chess(p.fen);
  const opening = p.moves[0];
  if (!playUci(chess, opening)) throw new Error(`Задача ${p.id}: недопустимый первый ход ${opening}`);
  return { puzzle: p, fen: chess.fen(), step: 1, mistakes: 0, hintLevel: 0, status: 'playing',
    lastMove: [opening.slice(0, 2), opening.slice(2, 4)] };
}

export function tryMove(s: PuzzleState, uci: string): { state: PuzzleState; outcome: MoveOutcome } {
  if (s.status !== 'playing') return { state: s, outcome: 'illegal' };
  const chess = new Chess(s.fen);
  const move = playUci(chess, uci);
  if (!move) return { state: s, outcome: 'illegal' };

  const expected = s.puzzle.moves[s.step];
  if (uci !== expected && !chess.isCheckmate()) {
    const mistakes = s.mistakes + 1;
    return { state: { ...s, mistakes, status: mistakes >= 2 ? 'revealed' : 'playing' }, outcome: 'wrong' };
  }

  const reply = s.puzzle.moves[s.step + 1];
  if (reply === undefined || chess.isCheckmate()) {
    return { state: { ...s, fen: chess.fen(), step: s.step + 1, status: 'solved',
      lastMove: [move.from, move.to] }, outcome: 'solved' };
  }
  if (!playUci(chess, reply)) throw new Error(`Задача ${s.puzzle.id}: недопустимый ответ ${reply}`);
  return { state: { ...s, fen: chess.fen(), step: s.step + 2,
    lastMove: [reply.slice(0, 2), reply.slice(2, 4)] }, outcome: 'correct' };
}

/** 1-й вызов — поле фигуры, которой надо ходить; 2-й и дальше — сам ход. */
export function takeHint(s: PuzzleState): { state: PuzzleState; square?: string; move?: string } {
  const expected = s.puzzle.moves[s.step];
  if (s.status === 'solved' || expected === undefined) return { state: s };
  if (s.hintLevel === 0) return { state: { ...s, hintLevel: 1 }, square: expected.slice(0, 2) };
  return { state: { ...s, hintLevel: 2 }, move: expected };
}

export function resultOf(s: PuzzleState): TaskResult {
  if (s.hintLevel > 0) return 'hint';
  if (s.mistakes > 0) return 'mistake';
  return 'clean';
}

export function sideToMove(s: PuzzleState): 'white' | 'black' {
  return new Chess(s.fen).turn() === 'w' ? 'white' : 'black';
}

/** Допустимые ходы стороны, чья очередь: поле фигуры → поля назначения (формат chessground). */
export function legalDests(fen: string): Map<string, string[]> {
  const dests = new Map<string, string[]>();
  for (const m of new Chess(fen).moves({ verbose: true })) {
    const list = dests.get(m.from);
    if (list) { if (!list.includes(m.to)) list.push(m.to); } else dests.set(m.from, [m.to]);
  }
  return dests;
}
