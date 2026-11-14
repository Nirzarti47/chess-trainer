// Обёртка над Stockfish (однопоточная lite-сборка в Web Worker).
// Единственная задача этапа 1: подсказать лучший ответ соперника на ошибочный ход.
// Движок не должен уметь подвесить урок: bestReply никогда не бросает и не отклоняется,
// а при любом сбое или задержке отвечает null.

/** Скрипт движка; рядом с ним лежит stockfish-19-lite-single.wasm (см. scripts/copy-engine.mjs). */
export const ENGINE_URL = 'engine/stockfish-19-lite-single.js';

export type BestReplyOptions = { movetimeMs?: number; timeoutMs?: number };

export type Engine = {
  bestReply(fen: string, opts?: BestReplyOptions): Promise<string | null>;
  warmUp(timeoutMs?: number): Promise<boolean>;
};

const DEFAULT_MOVETIME_MS = 300;
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_WARMUP_TIMEOUT_MS = 5000;
/** Сколько ждать запуска (uciok + readyok), прежде чем признать воркер негодным. */
const START_TIMEOUT_MS = 15000;
/** Сколько ждать bestmove после stop, прежде чем заменить воркер. */
const STOP_GRACE_MS = 1000;

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Тот, кто сейчас слушает строки движка: запуск или текущий поиск. */
type Listener = { onLine(line: string): void; onFail(): void };

type Job = {
  settled: boolean;
  finish(move: string | null): void;
  /** Задаётся, пока идёт поиск: вызывается, если запрос не дождался ответа. */
  abandon?: () => void;
};

export function createEngine(workerFactory: () => Worker): Engine {
  let worker: Worker | null = null;
  let ready: Promise<boolean> | null = null;
  let listener: Listener | null = null;
  let started = false;
  // После сбоя или зависания можно поднять новый воркер один раз; удачный ответ движка
  // возвращает эту возможность.
  let restartsLeft = 1;
  let queue: Promise<void> = Promise.resolve();

  function discard(w: Worker) {
    if (worker !== w) return;
    worker = null;
    ready = null;
    try {
      w.terminate();
    } catch {
      // Воркер уже мёртв.
    }
    const l = listener;
    listener = null;
    l?.onFail();
  }

  function post(w: Worker, cmd: string) {
    if (worker !== w) return;
    try {
      w.postMessage(cmd);
    } catch {
      discard(w);
    }
  }

  function receive(w: Worker, data: unknown) {
    if (worker !== w || typeof data !== 'string') return;
    for (const raw of data.split('\n')) {
      const line = raw.trim();
      if (line) listener?.onLine(line);
    }
  }

  function start(): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let w: Worker;
      try {
        w = workerFactory();
      } catch {
        resolve(false);
        return;
      }
      worker = w;
      const timer = setTimeout(() => discard(w), START_TIMEOUT_MS);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      listener = {
        onLine(line) {
          if (line === 'uciok') post(w, 'isready');
          else if (line === 'readyok') {
            listener = null;
            done(true);
          }
        },
        onFail: () => done(false),
      };
      w.onmessage = e => receive(w, e.data);
      w.onerror = () => discard(w);
      post(w, 'uci');
    });
  }

  function ensureReady(): Promise<boolean> {
    if (!ready) {
      if (started && restartsLeft === 0) return Promise.resolve(false);
      if (started) restartsLeft--;
      started = true;
      const attempt = start();
      ready = attempt;
      void attempt.then(ok => {
        if (!ok && ready === attempt) ready = null;
      });
    }
    return ready;
  }

  /** Один поиск. Обещание выполняется, когда воркер свободен для следующего. */
  async function search(job: Job, fen: string, movetimeMs: number): Promise<void> {
    if (job.settled) return;
    if (!(await ensureReady()) || !worker) {
      job.finish(null);
      return;
    }
    if (job.settled) return;
    const w = worker;
    await new Promise<void>(release => {
      let grace: ReturnType<typeof setTimeout> | undefined;
      const end = (move: string | null) => {
        clearTimeout(grace);
        job.abandon = undefined;
        job.finish(move);
        release();
      };
      listener = {
        onLine(line) {
          if (!/^bestmove(\s|$)/.test(line)) return;
          listener = null;
          restartsLeft = 1;
          end(parseBestmove(line));
        },
        onFail: () => end(null),
      };
      // Ответ брошенного поиска придёт сюда же и будет выброшен: следующий запрос
      // не начнётся, пока этот поиск не закончится или воркер не заменят.
      job.abandon = () => {
        post(w, 'stop');
        if (worker === w) grace = setTimeout(() => discard(w), STOP_GRACE_MS);
      };
      post(w, `position fen ${fen}`);
      post(w, `go movetime ${movetimeMs}`);
    });
  }

  function bestReply(fen: string, opts: BestReplyOptions = {}): Promise<string | null> {
    const movetimeMs = opts.movetimeMs ?? DEFAULT_MOVETIME_MS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<string | null>(resolve => {
      if (/[\r\n]/.test(fen)) {
        resolve(null);
        return;
      }
      const job: Job = {
        settled: false,
        finish(move) {
          if (job.settled) return;
          job.settled = true;
          clearTimeout(timer);
          resolve(move);
        },
      };
      const timer = setTimeout(() => {
        if (job.settled) return;
        job.finish(null);
        job.abandon?.();
      }, timeoutMs);
      queue = queue.then(() => search(job, fen, movetimeMs)).catch(() => job.finish(null));
    });
  }

  function warmUp(timeoutMs = DEFAULT_WARMUP_TIMEOUT_MS): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      ensureReady().then(
        ok => {
          clearTimeout(timer);
          resolve(ok);
        },
        () => resolve(false),
      );
    });
  }

  return { bestReply, warmUp };
}

function parseBestmove(line: string): string | null {
  const move = line.split(/\s+/)[1];
  return move && UCI_MOVE.test(move) ? move : null;
}

// Экземпляр приложения: воркер создаётся при первом вызове и дальше переиспользуется.
const appEngine = createEngine(() => new Worker(ENGINE_URL));

export function bestReply(fen: string, opts?: BestReplyOptions): Promise<string | null> {
  return appEngine.bestReply(fen, opts);
}

export function warmUp(timeoutMs?: number): Promise<boolean> {
  return appEngine.warmUp(timeoutMs);
}
