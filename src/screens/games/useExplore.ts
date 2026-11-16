import { Chess } from 'chess.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG } from '../../analysis/config';
import { toWhite } from '../../analysis/score';
import type { AltMove, Score } from '../../domain/gameTypes';
import type { AnalysisEngine } from '../../engine/analysisEngine';

export interface ExploreState { active: boolean; fen: string; lastMove: [string, string] | null;
  score: Score | null; best: AltMove | null; thinking: boolean; failed: boolean; depth: number /* ходов в варианте */ }

/** Позиция варианта и ответ движка на неё (если уже есть). */
interface Step {
  fen: string;
  lastMove: [string, string];
  score: Score | null;
  best: AltMove | null;
  thinking: boolean;
  failed: boolean;
}

const turnOf = (chess: Chess) => (chess.turn() === 'w' ? 'white' : 'black');

/** Ход в UCI из позиции fen; null — ход недопустим. Позиция без ходов (мат, пат) сразу получает итог. */
function play(fen: string, uci: string): Step | null {
  const chess = new Chess(fen);
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
  const step: Step = { fen: chess.fen(), lastMove: [uci.slice(0, 2), uci.slice(2, 4)],
    score: null, best: null, thinking: true, failed: false };
  if (chess.moves().length > 0) return step;
  const over = chess.isCheckmate() ? (turnOf(chess) === 'white' ? 'black' : 'white') : 'draw';
  return { ...step, score: { over }, thinking: false };
}

/** «Свой вариант» в разборе: стек позиций и оценка движка для верхней. Что рисовать — решает экран. */
export function useExplore(engine: Pick<AnalysisEngine, 'analyse'>): ExploreState & {
  start(fen: string, uci: string): void; move(uci: string): void; back(): void; exit(): void } {
  const [steps, setSteps] = useState<Step[]>([]);
  // Копия для обработчиков: стек нужен сразу, не дожидаясь перерисовки.
  const stepsRef = useRef<Step[]>([]);
  const request = useRef<AbortController | null>(null);

  const commit = useCallback((next: Step[]) => {
    stepsRef.current = next;
    setSteps(next);
  }, []);

  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
  }, []);

  /** Спрашивает движок о верхней позиции стека; прежний запрос отменяется. */
  const ask = useCallback((next: Step[]) => {
    cancel();
    const top = next[next.length - 1];
    if (!top.thinking) return;
    const ctrl = new AbortController();
    request.current = ctrl;
    void engine.analyse(top.fen, { nodes: CONFIG.EXPLORE_NODES, multipv: 1, priority: 'screen', signal: ctrl.signal })
      .then((lines) => {
        const now = stepsRef.current;
        // Ответ отменённого или устаревшего запроса не трогает состояние.
        if (ctrl.signal.aborted || now[now.length - 1] !== top) return;
        request.current = null;
        const line = lines?.[0];
        const turn = turnOf(new Chess(top.fen));
        const done: Step = line
          ? { ...top, thinking: false, score: toWhite(line.score, turn),
            best: { move: line.move, score: toWhite(line.score, turn), pv: line.pv } }
          : { ...top, thinking: false, failed: true };
        commit([...now.slice(0, -1), done]);
      });
  }, [engine, cancel, commit]);

  const push = useCallback((base: Step[], fen: string, uci: string) => {
    const step = play(fen, uci);
    if (!step) return;
    const next = [...base, step];
    commit(next);
    ask(next);
  }, [ask, commit]);

  const start = useCallback((fen: string, uci: string) => push([], fen, uci), [push]);

  const move = useCallback((uci: string) => {
    const now = stepsRef.current;
    if (now.length > 0) push(now, now[now.length - 1].fen, uci);
  }, [push]);

  const exit = useCallback(() => {
    cancel();
    commit([]);
  }, [cancel, commit]);

  const back = useCallback(() => {
    const now = stepsRef.current;
    if (now.length <= 1) {
      exit();
      return;
    }
    const next = now.slice(0, -1);
    commit(next);
    ask(next);
  }, [ask, commit, exit]);

  // Уход с экрана отменяет запрос.
  useEffect(() => cancel, [cancel]);

  const top = steps[steps.length - 1];
  // Пока идёт счёт, оценка остаётся прежней: последняя известная в варианте.
  const score = [...steps].reverse().find((s) => s.score)?.score ?? null;
  return {
    active: steps.length > 0,
    fen: top?.fen ?? '',
    lastMove: top?.lastMove ?? null,
    score,
    best: top?.best ?? null,
    thinking: top?.thinking ?? false,
    failed: top?.failed ?? false,
    depth: steps.length,
    start, move, back, exit,
  };
}
