// Разбор партии в два прохода: быстрый по всем позициям, глубокий — по подозрительным ходам.
import { Chess, type Move } from 'chess.js';
import type { AltMove, GameAnalysis, GameRecord, MoveReview, Score, Side } from '../domain/gameTypes';
import type { AnalysisEngine, AnalysisPriority, EngineLine } from '../engine/analysisEngine';
import { CONFIG } from './config';
import { gradeOf, isBrilliant, isGreat, summarize } from './grade';
import { classifyMistake } from './kinds';
import { OTHER_PHRASE } from './phrases';
import { expected, lossOf, toWhite } from './score';

export interface AnalyseDeps { engine: Pick<AnalysisEngine, 'analyse'>; priority: AnalysisPriority;
  signal?: AbortSignal; onProgress?(done: number, total: number): void; now?: () => number }

/** Позиция партии: fen, чей ход и итог, если ходов нет. */
interface Position { fen: string; turn: Side; over: Score | null }

const sideOf = (ply: number): Side => (ply % 2 === 0 ? 'white' : 'black');

function positionOf(chess: Chess): Position {
  const turn: Side = chess.turn() === 'w' ? 'white' : 'black';
  let over: Score | null = null;
  if (chess.isCheckmate()) over = { over: turn === 'white' ? 'black' : 'white' };
  else if (chess.isStalemate()) over = { over: 'draw' };
  return { fen: chess.fen(), turn, over };
}

const toAlt = (l: EngineLine, turn: Side): AltMove => ({ move: l.move, score: toWhite(l.score, turn), pv: l.pv });

/** null — движок не ответил хотя бы на один запрос или разбор отменён. Частичного результата не бывает. */
export async function analyseGame(game: GameRecord, deps: AnalyseDeps): Promise<GameAnalysis | null> {
  const now = deps.now ?? Date.now;
  const started = now();
  const { engine, priority, signal } = deps;

  // Позиции 0..N и сыгранные ходы
  const chess = new Chess();
  const positions: Position[] = [positionOf(chess)];
  const played: Move[] = [];
  for (const uci of game.moves) {
    try {
      played.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }));
    } catch {
      return null;
    }
    positions.push(positionOf(chess));
  }
  const n = game.moves.length;

  let done = 0;
  let total = positions.filter((p) => !p.over).length;
  /** Запрос к движку; null — сбой, отмена или пустой ответ. */
  async function ask(i: number, nodes: number, multipv: 1 | 2 | 3): Promise<EngineLine[] | null> {
    if (signal?.aborted) return null;
    const lines = await engine.analyse(positions[i].fen, { nodes, multipv, priority, signal });
    if (signal?.aborted || !lines || lines.length === 0) return null;
    deps.onProgress?.(++done, total);
    return lines;
  }

  // Первый проход
  const fast: (EngineLine[] | null)[] = [];
  const scores: Score[] = [];
  for (let i = 0; i <= n; i++) {
    const p = positions[i];
    if (p.over) {
      fast.push(null);
      scores.push(p.over);
      continue;
    }
    const lines = await ask(i, CONFIG.FAST_NODES, CONFIG.FAST_MULTIPV);
    if (!lines) return null;
    fast.push(lines);
    scores.push(toWhite(lines[0].score, p.turn));
  }

  const moves: MoveReview[] = game.moves.map((move, ply) => {
    const best = fast[ply]!.map((l) => toAlt(l, positions[ply].turn));
    const loss = lossOf(scores[ply], scores[ply + 1], sideOf(ply));
    return { ply, move, loss, grade: gradeOf(loss, move === best[0].move), best, deep: false };
  });

  // Отбор во второй проход
  const owner = (ply: number) => sideOf(ply) === game.userColor;
  const picked = moves.filter((m) => {
    const mover = sideOf(m.ply);
    if (m.loss >= CONFIG.DEEP_TRIGGER_LOSS) return true;
    if (m.grade === 'best' && m.best.length >= 2
      && expected(m.best[0].score, mover) - expected(m.best[1].score, mover) >= CONFIG.GREAT_GAP) return true;
    return isBrilliant({ loss: m.loss, fenBefore: positions[m.ply].fen, move: m.move,
      before: scores[m.ply], after: scores[m.ply + 1], mover });
  })
    .sort((a, b) => Number(owner(b.ply)) - Number(owner(a.ply)) || b.loss - a.loss)
    .slice(0, CONFIG.DEEP_MAX_MOVES)
    .sort((a, b) => a.ply - b.ply);
  total += picked.reduce((sum, m) => sum + (positions[m.ply + 1].over ? 1 : 2), 0);

  // Второй проход
  for (const m of picked) {
    const i = m.ply;
    const mover = sideOf(i);
    const lines = await ask(i, CONFIG.DEEP_NODES, CONFIG.DEEP_MULTIPV);
    if (!lines) return null;
    let reply: AltMove | null = null;
    let next: Score | null = positions[i + 1].over;
    if (!next) {
      const replies = await ask(i + 1, CONFIG.DEEP_NODES, 1);
      if (!replies) return null;
      reply = toAlt(replies[0], positions[i + 1].turn);
      next = reply.score;
    }
    const best = lines.map((l) => toAlt(l, positions[i].turn));
    const before = best[0].score;
    // конец партии на доске — всегда «партия закончена», а не оценка движка
    const after = positions[i + 1].over ?? best.find((b) => b.move === m.move)?.score ?? next;
    scores[i] = before;
    scores[i + 1] = after;
    m.best = best;
    m.loss = lossOf(before, after, mover);
    m.grade = gradeOf(m.loss, m.move === best[0].move);
    m.deep = true;
    if (m.grade === 'mistake' || m.grade === 'blunder') {
      const k = classifyMistake({ fenBefore: positions[i].fen, played: m.move, best, reply, after, mover });
      m.kind = k.kind;
      m.phrase = k.phrase;
    }
    const prev = played[i - 1];
    const isRecapture = !!played[i].captured && !!prev?.captured && prev.to === played[i].to;
    if (isBrilliant({ loss: m.loss, fenBefore: positions[i].fen, move: m.move, before, after, mover })) {
      m.mark = 'brilliant';
    } else if (isGreat({ grade: m.grade, best, mover, isRecapture })) {
      m.mark = 'great';
    }
  }

  // Ошибки без глубокого разбора
  for (const m of moves) {
    if (!m.deep && (m.grade === 'mistake' || m.grade === 'blunder')) {
      m.kind = 'other';
      m.phrase = OTHER_PHRASE;
    }
  }

  const finished = now();
  return {
    gameId: game.id, rulesVersion: CONFIG.RULES_VERSION, analysedAt: finished, tookMs: finished - started,
    scores, moves, white: summarize(moves, 'white'), black: summarize(moves, 'black'),
  };
}
