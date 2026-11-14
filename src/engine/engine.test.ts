import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngine, ENGINE_URL } from './engine';

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
function uci(onGo: (n: number) => string[] = () => ['bestmove e2e4 ponder e7e5']): () => Respond {
  let goes = 0;
  return () => {
    return cmd => {
      if (cmd === 'uci') return ['id name Fake', 'uciok'];
      if (cmd === 'isready') return ['readyok'];
      if (cmd.startsWith('go ')) return onGo(goes++);
      return [];
    };
  };
}

function setup(makeRespond: () => Respond) {
  const workers: FakeWorker[] = [];
  const factory = vi.fn(() => {
    const w = new FakeWorker(makeRespond());
    workers.push(w);
    return w as unknown as Worker;
  });
  return { engine: createEngine(factory), workers, factory };
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

afterEach(() => {
  vi.useRealTimers();
});

describe('bestReply', () => {
  it('возвращает первый ход после bestmove', async () => {
    const { engine, workers } = setup(uci());
    expect(await engine.bestReply(START)).toBe('e2e4');
    expect(workers[0].sent).toEqual(['uci', 'isready', `position fen ${START}`, 'go movetime 300']);
  });

  it('учитывает movetimeMs', async () => {
    const { engine, workers } = setup(uci());
    await engine.bestReply(START, { movetimeMs: 500 });
    expect(workers[0].sent).toContain('go movetime 500');
  });

  it('создаёт воркер один раз и переиспользует его', async () => {
    const { engine, factory } = setup(uci(n => [n === 0 ? 'bestmove e2e4' : 'bestmove e7e5']));
    expect(await engine.bestReply(START)).toBe('e2e4');
    expect(await engine.bestReply(AFTER_E4)).toBe('e7e5');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('ничего не создаёт до первого вызова', () => {
    const { factory } = setup(uci());
    expect(factory).not.toHaveBeenCalled();
  });

  it('bestmove (none) и 0000 дают null', async () => {
    const { engine } = setup(uci(n => [n === 0 ? 'bestmove (none)' : 'bestmove 0000']));
    expect(await engine.bestReply(START)).toBeNull();
    expect(await engine.bestReply(START)).toBeNull();
  });

  it('испорченная строка bestmove даёт null', async () => {
    const { engine } = setup(uci(n => [n === 0 ? 'bestmove' : 'bestmove xyz']));
    expect(await engine.bestReply(START)).toBeNull();
    expect(await engine.bestReply(START)).toBeNull();
  });

  it('пропускает info-строки и строки не-текст', async () => {
    const { engine, workers } = setup(uci(() => ['info depth 1 score cp 20 pv d2d4', 'bestmove d2d4']));
    const p = engine.bestReply(START);
    await vi.waitFor(() => expect(workers[0]?.sent).toContain('isready'));
    workers[0].emit({ not: 'a string' });
    expect(await p).toBe('d2d4');
  });

  it('FEN с переводом строки не уходит в движок', async () => {
    const { engine, workers } = setup(uci());
    expect(await engine.bestReply(`${START}\ngo infinite`)).toBeNull();
    expect(workers.flatMap(w => w.sent).some(c => c.includes('infinite'))).toBe(false);
  });

  it('второй запрос ждёт окончания первого, команды не перемешиваются', async () => {
    const { engine, workers } = setup(uci(n => [n === 0 ? 'bestmove e2e4' : 'bestmove e7e5']));
    const [a, b] = await Promise.all([engine.bestReply(START), engine.bestReply(AFTER_E4)]);
    expect([a, b]).toEqual(['e2e4', 'e7e5']);
    expect(workers[0].sent).toEqual([
      'uci',
      'isready',
      `position fen ${START}`,
      'go movetime 300',
      `position fen ${AFTER_E4}`,
      'go movetime 300',
    ]);
  });
});

describe('bestReply: движок молчит', () => {
  it('через timeoutMs возвращает null и шлёт stop, следующий вызов работает', async () => {
    vi.useFakeTimers();
    const { engine } = setup(uci(n => (n === 0 ? [] : ['bestmove d2d4'])));
    const first = track(engine.bestReply(START));
    await vi.advanceTimersByTimeAsync(1999);
    expect(first.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first).toEqual({ done: true, value: null });

    const second = track(engine.bestReply(START));
    await vi.advanceTimersByTimeAsync(2000);
    expect(second).toEqual({ done: true, value: 'd2d4' });
  });

  it('учитывает timeoutMs', async () => {
    vi.useFakeTimers();
    const { engine } = setup(uci(() => []));
    const r = track(engine.bestReply(START, { timeoutMs: 500 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(r).toEqual({ done: true, value: null });
  });

  it('поздний bestmove брошенного поиска не считается ответом на следующий запрос', async () => {
    vi.useFakeTimers();
    const { engine, workers } = setup(uci(n => (n === 0 ? [] : ['bestmove d2d4'])));
    const first = track(engine.bestReply(START));
    await vi.advanceTimersByTimeAsync(2000);
    expect(first.value).toBeNull();
    expect(workers[0].sent).toContain('stop');

    const second = track(engine.bestReply(AFTER_E4));
    await vi.advanceTimersByTimeAsync(10);
    // Пока старый поиск не ответил, новый не начинается.
    expect(workers[0].sent.filter(c => c.startsWith('go '))).toHaveLength(1);
    workers[0].emit('bestmove a2a3');
    await vi.advanceTimersByTimeAsync(10);
    expect(second).toEqual({ done: true, value: 'd2d4' });
    expect(workers).toHaveLength(1);
  });

  it('воркер, не ответивший на stop, заменяется новым', async () => {
    vi.useFakeTimers();
    const { engine, workers } = setup(uci(() => []));
    const first = track(engine.bestReply(START));
    await vi.advanceTimersByTimeAsync(2000);
    expect(first.value).toBeNull();
    const second = track(engine.bestReply(START));
    await vi.advanceTimersByTimeAsync(1000);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].sent).toContain('go movetime 300');
    workers[1].emit('bestmove e2e4');
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toEqual({ done: true, value: 'e2e4' });
  });

  it('медленный запуск: запрос получает null, следующий использует тот же воркер', async () => {
    vi.useFakeTimers();
    let readyLater: (() => void) | null = null;
    const workers: FakeWorker[] = [];
    const engine = createEngine(() => {
      const w = new FakeWorker(cmd => {
        if (cmd === 'uci') return ['uciok'];
        if (cmd === 'isready') {
          readyLater = () => w.emit('readyok');
          return [];
        }
        if (cmd.startsWith('go ')) return ['bestmove g1f3'];
        return [];
      });
      workers.push(w);
      return w as unknown as Worker;
    });
    const first = track(engine.bestReply(START));
    await vi.advanceTimersByTimeAsync(2000);
    expect(first.value).toBeNull();
    readyLater!();
    // Брошенный до старта поиск не запускается.
    await vi.advanceTimersByTimeAsync(0);
    expect(workers[0].sent.some(c => c.startsWith('go '))).toBe(false);
    expect(await engine.bestReply(START)).toBe('g1f3');
    expect(workers).toHaveLength(1);
  });
});

describe('сбои воркера', () => {
  it('воркер падает при создании: warmUp даёт false, bestReply даёт null и не бросает', async () => {
    const factory = vi.fn((): Worker => {
      throw new Error('no wasm');
    });
    const engine = createEngine(factory);
    expect(await engine.warmUp()).toBe(false);
    await expect(engine.bestReply(START)).resolves.toBeNull();
  });

  it('после сбоя пробует создать воркер заново только один раз', async () => {
    const factory = vi.fn((): Worker => {
      throw new Error('no wasm');
    });
    const engine = createEngine(factory);
    await engine.bestReply(START);
    await engine.bestReply(START);
    await engine.bestReply(START);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('onerror во время поиска: null, следующий вызов поднимает новый воркер', async () => {
    const { engine, workers } = setup(uci(() => []));
    const p = engine.bestReply(START);
    await vi.waitFor(() => expect(workers[0]?.sent.some(c => c.startsWith('go '))).toBe(true));
    workers[0].crash();
    expect(await p).toBeNull();
    expect(workers[0].terminated).toBe(true);

    const p2 = engine.bestReply(START);
    await vi.waitFor(() => expect(workers[1]?.sent.some(c => c.startsWith('go '))).toBe(true));
    workers[1].emit('bestmove e2e4');
    expect(await p2).toBe('e2e4');
  });

  it('успешный ответ снова разрешает одну замену воркера', async () => {
    const { engine, workers, factory } = setup(uci(() => []));
    for (let i = 0; i < 3; i++) {
      const p = engine.bestReply(START);
      await vi.waitFor(() => expect(workers[i]?.sent.some(c => c.startsWith('go '))).toBe(true));
      workers[i].emit('bestmove e2e4');
      expect(await p).toBe('e2e4');
      workers[i].crash();
    }
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('postMessage бросает: null без исключения', async () => {
    const engine = createEngine(() => ({ postMessage() { throw new Error('dead'); }, terminate() {} }) as unknown as Worker);
    expect(await engine.warmUp()).toBe(false);
    await expect(engine.bestReply(START)).resolves.toBeNull();
  });
});

describe('warmUp', () => {
  it('true после readyok', async () => {
    const { engine, workers } = setup(uci());
    expect(await engine.warmUp()).toBe(true);
    expect(workers[0].sent).toEqual(['uci', 'isready']);
  });

  it('false, если движок не ответил за timeoutMs', async () => {
    vi.useFakeTimers();
    const { engine } = setup(() => () => []);
    const r = track(engine.warmUp(1000));
    await vi.advanceTimersByTimeAsync(1000);
    expect(r).toEqual({ done: true, value: false });
  });

  it('повторный warmUp не создаёт второй воркер', async () => {
    const { engine, factory } = setup(uci());
    await engine.warmUp();
    await engine.warmUp();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

it('путь к движку относительный и указывает на lite-single сборку', () => {
  expect(ENGINE_URL).toBe('engine/stockfish-19-lite-single.js');
});
