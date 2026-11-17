// Задачи «исправь свою ошибку» из разобранной партии.
import { Chess } from 'chess.js';
import type { GameAnalysis, GamePuzzle, GameRecord, Side } from '../domain/gameTypes';
import type { Puzzle } from '../domain/types';
import { CONFIG } from './config';
import { OTHER_PHRASE, THEMES_OF_KIND } from './phrases';
import { expected } from './score';

export const gamePuzzleId = (gameId: string, ply: number) => `g:${gameId}:${ply}`;
export const isGamePuzzleId = (id: string) => id.startsWith('g:');

/** fen позиции после ply полуходов. */
function fenAt(moves: string[], ply: number): string {
  const chess = new Chess();
  for (const uci of moves.slice(0, ply)) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return chess.fen();
}

/** Ошибки владельца с единственным хорошим ответом — по убыванию потери, не больше PUZZLE_MAX.
 *  Верный ход, который уже есть в отобранной задаче, второй задачи не даёт. */
export function selectPuzzles(game: GameRecord, a: GameAnalysis): GamePuzzle[] {
  const owner: Side = game.userColor;
  const answers = new Set<string>();
  return a.moves
    .filter((m) => {
      if ((m.ply % 2 === 0) !== (owner === 'white')) return false;
      if (m.grade !== 'mistake' && m.grade !== 'blunder') return false;
      if (!m.deep || m.ply < 1 || m.best.length < 2) return false;
      const top = expected(m.best[0].score, owner);
      return top - expected(m.best[1].score, owner) >= CONFIG.UNIQUE_MARGIN && top >= CONFIG.PUZZLE_MIN_BEST;
    })
    .sort((x, y) => y.loss - x.loss)
    .filter((m) => {
      if (answers.has(m.best[0].move)) return false;
      answers.add(m.best[0].move);
      return true;
    })
    .slice(0, CONFIG.PUZZLE_MAX)
    .map((m) => ({
      id: gamePuzzleId(game.id, m.ply), gameId: game.id, ply: m.ply, endTime: game.endTime,
      fen: fenAt(game.moves, m.ply - 1), moves: [game.moves[m.ply - 1], m.best[0].move],
      kind: m.kind ?? 'other', phrase: m.phrase ?? OTHER_PHRASE, loss: m.loss,
    }));
}

/** old — сохранённые задачи этой партии, fresh — отбор по новому разбору. */
export function reconcile(old: GamePuzzle[], fresh: GamePuzzle[], a: GameAnalysis): { put: GamePuzzle[]; removeIds: string[] } {
  const kept = new Set<string>();
  const removeIds: string[] = [];
  for (const p of old) {
    // задача жива, пока лучший ход в её позиции не сменился
    if (a.moves[p.ply]?.best[0]?.move === p.moves[1]) kept.add(p.id);
    else removeIds.push(p.id);
  }
  // удалённая задача может вернуться с новым решением: saveAnalysis сначала удаляет, потом кладёт
  return { put: fresh.filter((p) => !kept.has(p.id)), removeIds };
}

export function toPuzzle(p: GamePuzzle): Puzzle {
  return { id: p.id, fen: p.fen, moves: [...p.moves], rating: 0, themes: [...THEMES_OF_KIND[p.kind]],
    game: { gameId: p.gameId, ply: p.ply, phrase: p.phrase } };
}
