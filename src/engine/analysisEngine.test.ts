import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnalysisEngine, type AnalyseOptions } from './analysisEngine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

type Respond = (cmd: string) => string[];

/** Поддельный воркер: отвечает строками асинхронно, как настоящий. */
class FakeWorker {
  sent: string[] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(private respond: Respond) {}
  postMessage(cmd: string) {
    this.sent.push(cmd);
    for (const line of this.respond(cmd)) queueMicrotask(() => this.emit(line));
  }
  emit(line: unknown) {
    if (!this.terminated) this.onmessage?.({ data: line });
  }
  crash() {
    this.onerror?.(new Event('error'));
  }
  terminate() {
    this.terminated = true;
  }
}

/** Ответы движка по протоколу UCI. onGo получает номер запроса `go` (сквозной для всех воркеров). */
function uci(onGo: (n: number) => string[] = () => []): () => Respond {
  let goes = 0;
  return () => cmd => {
    if (cmd === 'uci') return ['id name Fake', 'uciok'];
    if (cmd === 'isready') return ['readyok'];
    if (cmd.startsWith('go ')) return onGo(goes++);
    return [];
  };
}

function setup(makeRespond: () => Respond) {
  const workers: FakeWorker[] = [];
  const factory = vi.fn(() => {
    const w = new FakeWorker(makeRespond());
    workers.push(w);
    return w as unknown as Worker;
  });
  return { engine: createAnalysisEngine(factory), workers, factory };
}

/** Следит, выполнилось ли обещание, без await. */
function track<T>(p: Promise<T>) {
  const state: { done: boolean; value?: T } = { done: false };
  p.then(v => {
    state.done = true;
    state.value = v;
  });
  return state;
}

const BG: AnalyseOptions = { nodes: 100000, multipv: 1, priority: 'background' };
const SCREEN: AnalyseOptions = { nodes: 100000, multipv: 1, priority: 'screen' };

const goCount = (w: FakeWorker | undefined) => w?.sent.filter(c => c.startsWith('go ')).length ?? 0;
const positionsOf = (w: FakeWorker, fen: string) => w.sent.filter(c => c === `position fen ${fen}`).length;

afterEach(() => {
  vi.useRealTimers();
});

describe('analyse: разбор строк', () => {
  it('собирает линии по multipv, сильнейшая первой', async () => {
    const { engine } = setup(
      uci(() => [
        'info depth 12 multipv 1 score cp 35 pv e2e4 e7e5',
        'info depth 12 multipv 2 score mate -3 pv d2d4',
        'bestmove e2e4',
      ]),
    );
    expect(await engine.analyse(START, { ...SCREEN, multipv: 2 })).toEqual([
      { move: 'e2e4', score: { cp: 35 }, pv: ['e2e4', 'e7e5'] },
      { move: 'd2d4', score: { mate: -3 }, pv: ['d2d4'] },
    ]);
  });

  it('берёт последнюю глубину', async () => {
    const { engine } = setup(
      uci(() => [
        'info depth 10 multipv 1 score cp 10 pv e2e4',
        'info depth 11 multipv 1 score cp 50 pv e2e4',
        'bestmove e2e4',
      ]),
    );
    expect(await engine.analyse(START, SCREEN)).toEqual([{ move: 'e2e4', score: { cp: 50 }, pv: ['e2e4'] }]);
  });

  it('пропускает строки upperbound и lowerbound', async () => {
    const { engine } = setup(
      uci(() => [
        'info depth 11 multipv 1 score cp 20 pv e2e4',
        'info depth 12 multipv 1 score cp 90 upperbound pv e2e4',
        'info depth 12 multipv 1 score cp -90 lowerbound pv e2e4',
        'bestmove e2e4',
      ]),
    );
    expect(await engine.analyse(START, SCREEN)).toEqual([{ move: 'e2e4', score: { cp: 20 }, pv: ['e2e4'] }]);
  });

  it('недоделанная глубина не берётся: линии последней завершённой', async () => {
    const { engine } = setup(
      uci(() => [
        'info depth 9 multipv 1 score cp 30 pv e2e4',
        'info depth 9 multipv 2 score cp 20 pv d2d4',
        'info depth 10 multipv 1 score cp 40 pv e2e4',
        'bestmove e2e4',
      ]),
    );
    expect(await engine.analyse(START, { ...SCREEN, multipv: 2 })).toEqual([
      { move: 'e2e4', score: { cp: 30 }, pv: ['e2e4'] },
      { move: 'd2d4', score: { cp: 20 }, pv: ['d2d4'] },
    ]);
  });

  it('отправляет MultiPV, позицию и лимит узлов', async () => {
    const { engine, workers } = setup(uci(() => ['bestmove e2e4']));
    await engine.analyse(START, { nodes: 300000, multipv: 3, priority: 'screen' });
    expect(workers[0].sent).toEqual([
      'uci',
      'isready',
      'setoption name MultiPV value 3',
      `position fen ${START}`,
      'go nodes 300000',
    ]);
  });

  it('ничего не создаёт до первого запроса', () => {
    const { factory } = setup(uci());
    expect(factory).not.toHaveBeenCalled();
  });

  it('FEN с переводом строки → null без обращения к воркеру', async () => {
    const { engine, factory } = setup(uci(() => ['bestmove e2e4']));
    expect(await engine.analyse(`${START}\ngo infinite`, SCREEN)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('analyse: очередь и приоритеты', () => {
  it('screen прерывает background, прерванный запрос выполняется заново', async () => {
    const { engine, workers } = setup(uci());
    const a = track(engine.analyse(START, BG));
    await vi.waitFor(() => expect(goCount(workers[0])).toBe(1));

    const b = track(engine.analyse(AFTER_E4, SCREEN));
    await vi.waitFor(() => expect(workers[0].sent).toContain('stop'));
    expect(positionsOf(workers[0], AFTER_E4)).toBe(0);

    // Ответ прерванного поиска выбрасывается.
    workers[0].emit('info depth 5 multipv 1 score cp 11 pv e2e4');
    workers[0].emit('bestmove e2e4');
    await vi.waitFor(() => expect(positionsOf(workers[0], AFTER_E4)).toBe(1));
    expect(a.done).toBe(false);

    workers[0].emit('info depth 8 multipv 1 score cp -20 pv e7e5');
    workers[0].emit('bestmove e7e5');
    await vi.waitFor(() => expect(b.done).toBe(true));
    expect(b.value).toEqual([{ move: 'e7e5', score: { cp: -20 }, pv: ['e7e5'] }]);

    await vi.waitFor(() => expect(positionsOf(workers[0], START)).toBe(2));
    expect(a.done).toBe(false);
    workers[0].emit('info depth 9 multipv 1 score cp 77 pv d2d4');
    workers[0].emit('bestmove d2d4');
    await vi.waitFor(() => expect(a.done).toBe(true));
    expect(a.value).toEqual([{ move: 'd2d4', score: { cp: 77 }, pv: ['d2d4'] }]);
    expect(workers).toHaveLength(1);
  });

  it('screen идут раньше background в порядке прихода', async () => {
    const { engine, workers } = setup(uci(() => ['bestmove e2e4']));
    const order: string[] = [];
    await Promise.all([
      engine.analyse(START, BG).then(() => order.push('bg')),
      engine.analyse(START, SCREEN).then(() => order.push('s1')),
      engine.analyse(AFTER_E4, SCREEN).then(() => order.push('s2')),
    ]);
    expect(order).toEqual(['s1', 's2', 'bg']);
    expect(workers[0].sent).not.toContain('stop');
  });

  it('прерванный background заново получает свой таймаут с момента повторного запуска', async () => {
    vi.useFakeTimers();
    const { engine, workers } = setup(uci());
    const a = track(engine.analyse(START, { ...BG, timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(800);
    const b = track(engine.analyse(AFTER_E4, SCREEN));
    await vi.advanceTimersByTimeAsync(0);
    workers[0].emit('bestmove e2e4');
    await vi.advanceTimersByTimeAsync(500);
    workers[0].emit('bestmove e7e5');
    await vi.advanceTimersByTimeAsync(0);
    expect(b.done).toBe(true);
    expect(positionsOf(workers[0], START)).toBe(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(a.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(a).toEqual({ done: true, value: null });
  });
});

describe('analyse: отмена', () => {
  it('abort запроса в очереди → null, позиция для него не отправляется', async () => {
    const { engine, workers } = setup(uci());
    const a = track(engine.analyse(START, SCREEN));
    await vi.waitFor(() => expect(goCount(workers[0])).toBe(1));
    const ctrl = new AbortController();
    const b = engine.analyse(AFTER_E4, { ...SCREEN, signal: ctrl.signal });
    ctrl.abort();
    expect(await b).toBeNull();

    workers[0].emit('bestmove e2e4');
    await vi.waitFor(() => expect(a.done).toBe(true));
    await new Promise(r => setTimeout(r, 0));
    expect(positionsOf(workers[0], AFTER_E4)).toBe(0);
  });

  it('abort идущего поиска шлёт stop и даёт null, следующий запрос ждёт bestmove', async () => {
    const { engine, workers } = setup(uci());
    const ctrl = new AbortController();
    const a = engine.analyse(START, { ...SCREEN, signal: ctrl.signal });
    await vi.waitFor(() => expect(goCount(workers[0])).toBe(1));
    const b = track(engine.analyse(AFTER_E4, SCREEN));
    ctrl.abort();
    expect(await a).toBeNull();
    expect(workers[0].sent).toContain('stop');
    expect(positionsOf(workers[0], AFTER_E4)).toBe(0);

    workers[0].emit('bestmove e2e4');
    await vi.waitFor(() => expect(positionsOf(workers[0], AFTER_E4)).toBe(1));
    workers[0].emit('info depth 3 multipv 1 score cp 5 pv g8f6');
    workers[0].emit('bestmove g8f6');
    await vi.waitFor(() => expect(b.done).toBe(true));
    expect(b.value).toEqual([{ move: 'g8f6', score: { cp: 5 }, pv: ['g8f6'] }]);
  });

  it('уже отменённый сигнал → null без обращения к воркеру', async () => {
    const { engine, factory } = setup(uci(() => ['bestmove e2e4']));
    expect(await engine.analyse(START, { ...SCREEN, signal: AbortSignal.abort() })).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('analyse: сбои', () => {
  it('нет bestmove за timeoutMs → null, воркер завершён, следующий запрос создаёт новый', async () => {
    vi.useFakeTimers();
    const { engine, workers } = setup(uci(n => (n === 0 ? [] : ['bestmove e2e4'])));
    const first = track(engine.analyse(START, { ...SCREEN, timeoutMs: 500 }));
    await vi.advanceTimersByTimeAsync(499);
    expect(first.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first).toEqual({ done: true, value: null });
    expect(workers[0].terminated).toBe(true);

    const second = track(engine.analyse(START, SCREEN));
    await vi.advanceTimersByTimeAsync(0);
    expect(workers).toHaveLength(2);
    expect(second).toEqual({ done: true, value: [] });
  });

  it('по умолчанию таймаут 20 секунд', async () => {
    vi.useFakeTimers();
    const { engine } = setup(uci());
    const r = track(engine.analyse(START, SCREEN));
    await vi.advanceTimersByTimeAsync(19999);
    expect(r.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(r).toEqual({ done: true, value: null });
  });

  it('onerror во время поиска → null, следующий запрос поднимает новый воркер', async () => {
    const { engine, workers } = setup(uci(n => (n === 0 ? [] : ['bestmove e2e4'])));
    const p = engine.analyse(START, SCREEN);
    await vi.waitFor(() => expect(goCount(workers[0])).toBe(1));
    workers[0].crash();
    expect(await p).toBeNull();
    expect(workers[0].terminated).toBe(true);
    expect(await engine.analyse(START, SCREEN)).toEqual([]);
    expect(workers).toHaveLength(2);
  });

  it('три сбоя подряд → 60 секунд null без создания воркера, потом снова пробует', async () => {
    vi.useFakeTimers();
    const factory = vi.fn((): Worker => {
      throw new Error('no wasm');
    });
    const engine = createAnalysisEngine(factory);
    for (let i = 0; i < 3; i++) expect(await engine.analyse(START, SCREEN)).toBeNull();
    expect(factory).toHaveBeenCalledTimes(3);

    expect(await engine.analyse(START, SCREEN)).toBeNull();
    expect(factory).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(59999);
    expect(await engine.analyse(START, SCREEN)).toBeNull();
    expect(factory).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1);
    expect(await engine.analyse(START, SCREEN)).toBeNull();
    expect(factory).toHaveBeenCalledTimes(4);
  });

  it('удачный ответ обнуляет счёт неудач, отмена неудачей не считается', async () => {
    vi.useFakeTimers();
    let fail = true;
    const { engine, factory } = setup(() => {
      const respond = uci(() => ['bestmove e2e4'])();
      return cmd => (fail && cmd.startsWith('go ') ? [] : respond(cmd));
    });
    const timedOut = () => {
      const r = track(engine.analyse(START, { ...SCREEN, timeoutMs: 100 }));
      return vi.advanceTimersByTimeAsync(100).then(() => expect(r.value).toBeNull());
    };
    await timedOut();
    await timedOut();
    fail = false;
    const ok = track(engine.analyse(START, SCREEN));
    await vi.advanceTimersByTimeAsync(0);
    expect(ok.value).toEqual([]);
    fail = true;
    await timedOut();
    await timedOut();
    const ctrl = new AbortController();
    const cancelled = track(engine.analyse(START, { ...SCREEN, signal: ctrl.signal }));
    await vi.advanceTimersByTimeAsync(0);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelled.value).toBeNull();
    // Воркер не ответил на stop и заменён; счёт неудач при этом не растёт.
    await vi.advanceTimersByTimeAsync(1000);
    fail = false;
    const after = track(engine.analyse(START, SCREEN));
    await vi.advanceTimersByTimeAsync(0);
    expect(after.value).toEqual([]);
    expect(factory).toHaveBeenCalledTimes(6);
  });

  it('postMessage бросает: null без исключения', async () => {
    const engine = createAnalysisEngine(
      () => ({ postMessage() { throw new Error('dead'); }, terminate() {} }) as unknown as Worker,
    );
    await expect(engine.analyse(START, SCREEN)).resolves.toBeNull();
  });
});
