import { act, renderHook } from '@testing-library/react';
import { Chess } from 'chess.js';
import { CONFIG } from '../../analysis/config';
import { tableEngine } from '../../analysis/testEngine';
import type { AnalyseOptions, AnalysisEngine, EngineLine } from '../../engine/analysisEngine';
import { useExplore } from './useExplore';

const START = new Chess().fen();
const after = (fen: string, ...moves: string[]) => {
  const chess = new Chess(fen);
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return chess.fen();
};
const line = (move: string, score: EngineLine['score']): EngineLine => ({ move, score, pv: [move] });

/** Движок, который отвечает только по команде: видно каждый запрос и его signal. */
function manualEngine() {
  const calls: { fen: string; opts: AnalyseOptions; answer(lines: EngineLine[] | null): void }[] = [];
  const engine: Pick<AnalysisEngine, 'analyse'> = {
    analyse: (fen, opts) => new Promise((answer) => calls.push({ fen, opts, answer })),
  };
  return { engine, calls };
}

describe('useExplore', () => {
  it('start: режим включён, идёт счёт, ответ — оценка глазами белых и лучший ход', async () => {
    const e4 = after(START, 'e2e4');
    const engine = tableEngine({ [e4]: [line('e7e5', { cp: 80 })] });
    const { result } = renderHook(() => useExplore(engine));
    expect(result.current.active).toBe(false);
    act(() => result.current.start(START, 'e2e4'));
    expect(result.current).toMatchObject({ active: true, fen: e4, lastMove: ['e2', 'e4'], thinking: true, depth: 1 });
    await act(async () => {});
    expect(result.current).toMatchObject({ thinking: false, failed: false, score: { cp: -80 } });
    expect(result.current.best).toEqual({ move: 'e7e5', score: { cp: -80 }, pv: ['e7e5'] });
    expect(engine.calls).toEqual([{ fen: e4, nodes: CONFIG.EXPLORE_NODES, multipv: 1 }]);
  });

  it('второй ход до ответа отменяет первый запрос; поздний ответ первого ничего не меняет', async () => {
    const { engine, calls } = manualEngine();
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    act(() => result.current.move('e7e5'));
    expect(calls).toHaveLength(2);
    expect(calls[0].opts).toMatchObject({ nodes: CONFIG.EXPLORE_NODES, multipv: 1, priority: 'screen' });
    expect(calls[0].opts.signal!.aborted).toBe(true);
    expect(calls[1].opts.signal!.aborted).toBe(false);
    await act(async () => calls[0].answer([line('d7d5', { cp: 500 })]));
    expect(result.current).toMatchObject({ thinking: true, best: null, depth: 2 });
    await act(async () => calls[1].answer([line('g1f3', { cp: 30 })]));
    expect(result.current).toMatchObject({ thinking: false, score: { cp: 30 } });
    expect(result.current.best!.move).toBe('g1f3');
  });

  it('пока идёт счёт, оценка держит прежнее значение', async () => {
    const engine = tableEngine({ [after(START, 'e2e4')]: [line('e7e5', { cp: 40 })] });
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    expect(result.current.score).toBeNull();
    await act(async () => {});
    act(() => result.current.move('e7e5'));
    expect(result.current).toMatchObject({ thinking: true, score: { cp: -40 }, best: null });
    await act(async () => {});
    expect(result.current).toMatchObject({ thinking: false, score: { cp: 0 } });
  });

  it('back с глубины 2 возвращает позицию глубины 1 вместе с её ответом', async () => {
    const e4 = after(START, 'e2e4');
    const engine = tableEngine({ [e4]: [line('e7e5', { cp: 80 })] });
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    await act(async () => {});
    act(() => result.current.move('c7c5'));
    await act(async () => {});
    expect(result.current.depth).toBe(2);
    act(() => result.current.back());
    expect(result.current).toMatchObject({
      active: true, depth: 1, fen: e4, lastMove: ['e2', 'e4'], thinking: false, score: { cp: -80 },
    });
    expect(result.current.best!.move).toBe('e7e5');
  });

  it('back с глубины 1 и exit выключают режим и отменяют запрос', () => {
    const { engine, calls } = manualEngine();
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    act(() => result.current.back());
    expect(result.current).toMatchObject({ active: false, depth: 0 });
    expect(calls[0].opts.signal!.aborted).toBe(true);
    act(() => result.current.start(START, 'd2d4'));
    act(() => result.current.exit());
    expect(result.current).toMatchObject({ active: false, depth: 0 });
    expect(calls[1].opts.signal!.aborted).toBe(true);
  });

  it('уход с экрана отменяет запрос', () => {
    const { engine, calls } = manualEngine();
    const { result, unmount } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    unmount();
    expect(calls[0].opts.signal!.aborted).toBe(true);
  });

  it('ответ null — failed; следующий ход работает', async () => {
    const { engine, calls } = manualEngine();
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    await act(async () => calls[0].answer(null));
    expect(result.current).toMatchObject({ active: true, failed: true, thinking: false, best: null });
    act(() => result.current.move('e7e5'));
    expect(result.current).toMatchObject({ failed: false, thinking: true, depth: 2 });
    await act(async () => calls[1].answer([line('g1f3', { cp: 20 })]));
    expect(result.current).toMatchObject({ failed: false, score: { cp: 20 } });
  });

  it('back во время счёта второго хода: поздний ответ не меняет глубину 1 (прежние score и best)', async () => {
    const { engine, calls } = manualEngine();
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    await act(async () => calls[0].answer([line('e7e5', { cp: 80 })]));
    act(() => result.current.move('c7c5'));
    expect(result.current).toMatchObject({ depth: 2, thinking: true });
    act(() => result.current.back());
    expect(calls[1].opts.signal!.aborted).toBe(true);
    await act(async () => calls[1].answer([line('g1f3', { cp: 300 })]));
    expect(result.current).toMatchObject({ depth: 1, thinking: false, failed: false, score: { cp: -80 } });
    expect(result.current.best).toEqual({ move: 'e7e5', score: { cp: -80 }, pv: ['e7e5'] });
  });

  it('exit во время счёта: поздний ответ режим не включает', async () => {
    const { engine, calls } = manualEngine();
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    act(() => result.current.exit());
    await act(async () => calls[0].answer([line('e7e5', { cp: 80 })]));
    expect(result.current).toMatchObject({ active: false, depth: 0, score: null, best: null });
  });

  it('ответ null, пришедший после отмены, не ставит failed', async () => {
    const { engine, calls } = manualEngine();
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e4'));
    act(() => result.current.move('e7e5'));
    // Отменённый первый запрос отвечает null (так analyse сообщает об отмене).
    await act(async () => calls[0].answer(null));
    expect(result.current).toMatchObject({ depth: 2, thinking: true, failed: false });
  });

  it('недопустимый ход ничего не меняет', () => {
    const engine = tableEngine({});
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(START, 'e2e5'));
    expect(result.current.active).toBe(false);
    expect(engine.calls).toHaveLength(0);
  });

  it('мат: движок не вызван, оценка — победа поставившего мат', () => {
    const engine = tableEngine({});
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start(after(START, 'f2f3', 'e7e5', 'g2g4'), 'd8h4'));
    expect(engine.calls).toHaveLength(0);
    expect(result.current).toMatchObject({ active: true, thinking: false, failed: false, score: { over: 'black' }, best: null });
  });

  it('пат: движок не вызван, оценка — ничья', () => {
    const engine = tableEngine({});
    const { result } = renderHook(() => useExplore(engine));
    act(() => result.current.start('7k/4Q3/6K1/8/8/8/8/8 w - - 0 1', 'e7f7'));
    expect(engine.calls).toHaveLength(0);
    expect(result.current).toMatchObject({ thinking: false, score: { over: 'draw' }, best: null });
  });
});
