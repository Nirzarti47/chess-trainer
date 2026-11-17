// Второй, отдельный экземпляр Stockfish — для разбора партий. С движком урока (engine.ts)
// у него общий только скрипт. Умеет несколько линий (MultiPV), очередь с приоритетами и отмену.
// analyse никогда не бросает и не отклоняется: при сбое, таймауте или отмене отвечает null.

import { ENGINE_URL } from './engine';

/** Оценка с точки зрения стороны, чей ход (как отдаёт UCI). */
export type UciScore = { cp: number } | { mate: number };
export interface EngineLine { move: string; score: UciScore; pv: string[] }
export type AnalysisPriority = 'screen' | 'background';
export interface AnalyseOptions { nodes: number; multipv: 1 | 2 | 3; priority: AnalysisPriority;
  timeoutMs?: number /* по умолчанию 20000, считается от отправки go */; signal?: AbortSignal }
export interface AnalysisEngine {
  /** Линии последней завершённой глубины, сильнейшая первой. null — сбой, таймаут, отмена. Никогда не отклоняется.
   *  Для позиции без ходов (мат, пат) — пустой список; такие позиции движку не отдаются. */
  analyse(fen: string, opts: AnalyseOptions): Promise<EngineLine[] | null>;
}

const DEFAULT_TIMEOUT_MS = 20000;
/** Сколько ждать готовности нового воркера (загрузка и подготовка движка): на телефоне это секунды. */
const STARTUP_TIMEOUT_MS = 15000;
/** Сколько ждать bestmove после stop, прежде чем заменить воркер. */
const STOP_GRACE_MS = 1000;
/** После стольких неудач подряд движок берёт паузу. */
const MAX_FAILURES = 3;
/** Пауза, в которую движок сразу отвечает null. */
const COOLDOWN_MS = 60000;

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

type Request = {
  fen: string;
  nodes: number;
  multipv: number;
  priority: AnalysisPriority;
  timeoutMs: number;
  settled: boolean;
  finish(lines: EngineLine[] | null): void;
};

/** Один запуск запроса: от подъёма воркера до bestmove. */
type Run = {
  /** null — запрос отпущен (отмена, прерывание), ждём только конца поиска. */
  req: Request | null;
  phase: 'starting' | 'searching' | 'stopping';
  worker?: Worker;
  timer?: ReturnType<typeof setTimeout>;
  grace?: ReturnType<typeof setTimeout>;
  /** глубина → номер линии → линия */
  depths: Map<number, Map<number, EngineLine>>;
};

export function createAnalysisEngine(workerFactory: () => Worker): AnalysisEngine {
  let worker: Worker | null = null;
  let ready: Promise<boolean> | null = null;
  /** Пока идёт запуск: слушатель строк и способ признать запуск несостоявшимся. */
  let startLine: ((line: string) => void) | null = null;
  let startFailed: (() => void) | null = null;
  let current: Run | null = null;
  const queues: Record<AnalysisPriority, Request[]> = { screen: [], background: [] };
  let failures = 0;
  let coolingDown = false;

  function discard(w: Worker) {
    if (worker !== w) return;
    worker = null;
    ready = null;
    try {
      w.terminate();
    } catch {
      // Воркер уже мёртв.
    }
    const failStart = startFailed;
    failStart?.();
    const run = current;
    if (run && run.worker === w) {
      if (run.req) failRun(run);
      else endRun(run);
    }
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
      if (!line) continue;
      if (startLine) startLine(line);
      else if (current && current.worker === w) onSearchLine(current, line);
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
      // Запуск, не уложившийся в предел, — сбой: воркер заменяется, запрос получает null, как при опоздании.
      const limit = setTimeout(() => discard(w), STARTUP_TIMEOUT_MS);
      const done = (ok: boolean) => {
        clearTimeout(limit);
        startLine = null;
        startFailed = null;
        resolve(ok);
      };
      startFailed = () => done(false);
      startLine = line => {
        if (line === 'uciok') post(w, 'isready');
        else if (line === 'readyok') done(true);
      };
      w.onmessage = e => receive(w, e.data);
      w.onerror = () => discard(w);
      post(w, 'uci');
    });
  }

  function ensureReady(): Promise<boolean> {
    if (!ready) {
      const attempt = start();
      ready = attempt;
      void attempt.then(ok => {
        if (!ok && ready === attempt) ready = null;
      });
    }
    return ready;
  }

  /** Запуск закончен: освобождаем место и берём следующий запрос. */
  function endRun(run: Run) {
    clearTimeout(run.timer);
    clearTimeout(run.grace);
    if (current === run) current = null;
    pump();
  }

  function failRun(run: Run) {
    const req = run.req;
    run.req = null;
    req?.finish(null);
    failures++;
    if (failures >= MAX_FAILURES) coolDown();
    endRun(run);
  }

  function coolDown() {
    coolingDown = true;
    failures = 0;
    for (const req of queues.screen.splice(0)) req.finish(null);
    for (const req of queues.background.splice(0)) req.finish(null);
    setTimeout(() => {
      coolingDown = false;
    }, COOLDOWN_MS);
  }

  /** Отпускает запрос, а идущий поиск останавливает; ответ поиска будет выброшен. */
  function release(run: Run) {
    run.req = null;
    clearTimeout(run.timer);
    if (run.phase === 'starting' || !run.worker) {
      endRun(run);
      return;
    }
    if (run.phase === 'stopping') return;
    run.phase = 'stopping';
    const w = run.worker;
    post(w, 'stop');
    if (current === run && worker === w) run.grace = setTimeout(() => discard(w), STOP_GRACE_MS);
  }

  function pump() {
    if (current || coolingDown) return;
    const req = queues.screen.shift() ?? queues.background.shift();
    if (!req) return;
    const run: Run = { req, phase: 'starting', depths: new Map() };
    current = run;
    void ensureReady().then(ok => {
      if (current !== run || !run.req) return;
      if (!ok || !worker) {
        failRun(run);
        return;
      }
      const w = worker;
      run.worker = w;
      run.phase = 'searching';
      // Время на ответ — с отправки go: запуск движка ограничен своим пределом (STARTUP_TIMEOUT_MS).
      run.timer = setTimeout(() => {
        if (current !== run || !run.req) return;
        if (worker) discard(worker);
        if (current === run && run.req) failRun(run);
      }, req.timeoutMs);
      post(w, `setoption name MultiPV value ${req.multipv}`);
      post(w, `position fen ${req.fen}`);
      post(w, `go nodes ${req.nodes}`);
    });
  }

  function onSearchLine(run: Run, line: string) {
    if (line.startsWith('info ')) {
      if (run.phase !== 'searching') return;
      const info = parseInfo(line);
      if (!info) return;
      let lines = run.depths.get(info.depth);
      if (!lines) run.depths.set(info.depth, (lines = new Map()));
      lines.set(info.multipv, info.line);
      return;
    }
    if (!/^bestmove(\s|$)/.test(line)) return;
    const req = run.req;
    run.req = null;
    if (req && run.phase === 'searching') {
      failures = 0;
      req.finish(pickLines(run.depths));
    }
    endRun(run);
  }

  function analyse(fen: string, opts: AnalyseOptions): Promise<EngineLine[] | null> {
    return new Promise<EngineLine[] | null>(resolve => {
      const { signal } = opts;
      if (/[\r\n]/.test(fen) || coolingDown || signal?.aborted) {
        resolve(null);
        return;
      }
      const queue = queues[opts.priority];
      const onAbort = () => {
        if (req.settled) return;
        const i = queue.indexOf(req);
        if (i >= 0) {
          queue.splice(i, 1);
          req.finish(null);
          return;
        }
        const run = current;
        if (run && run.req === req) {
          req.finish(null);
          release(run);
        }
      };
      const req: Request = {
        fen,
        nodes: opts.nodes,
        multipv: opts.multipv,
        priority: opts.priority,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        settled: false,
        finish(lines) {
          if (req.settled) return;
          req.settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(lines);
        },
      };
      signal?.addEventListener('abort', onAbort);
      queue.push(req);
      const run = current;
      if (req.priority === 'screen' && run?.req?.priority === 'background') {
        // Прерванный запрос встаёт в начало своей очереди и позже выполнится заново.
        queues.background.unshift(run.req);
        release(run);
      } else {
        pump();
      }
    });
  }

  return { analyse };
}

function parseInfo(line: string): { depth: number; multipv: number; line: EngineLine } | null {
  const t = line.split(/\s+/);
  if (t[1] === 'string' || t.includes('upperbound') || t.includes('lowerbound')) return null;
  let depth = 0;
  let multipv = 1;
  let score: UciScore | null = null;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    if (t[i] === 'depth') depth = Number(t[++i]);
    else if (t[i] === 'multipv') multipv = Number(t[++i]);
    else if (t[i] === 'score') {
      const kind = t[++i];
      const value = Number(t[++i]);
      if (kind === 'cp') score = { cp: value };
      else if (kind === 'mate') score = { mate: value };
    } else if (t[i] === 'pv') {
      pv = t.slice(i + 1);
      break;
    }
  }
  if (!score || !Number.isInteger(depth) || !Number.isInteger(multipv)) return null;
  if (!Number.isInteger('cp' in score ? score.cp : score.mate)) return null;
  if (pv.length === 0 || !pv.every(m => UCI_MOVE.test(m))) return null;
  return { depth, multipv, line: { move: pv[0], score, pv } };
}

/** Линии самой глубокой полной глубины (с наибольшим числом линий), сильнейшая первой. */
function pickLines(depths: Map<number, Map<number, EngineLine>>): EngineLine[] {
  let most = 0;
  for (const lines of depths.values()) most = Math.max(most, lines.size);
  let best = -Infinity;
  for (const [depth, lines] of depths) if (lines.size === most && depth > best) best = depth;
  const lines = depths.get(best);
  if (!lines) return [];
  return [...lines].sort(([a], [b]) => a - b).map(([, l]) => l);
}

// Экземпляр приложения: воркер создаётся при первом запросе и дальше переиспользуется.
export const analysisEngine: AnalysisEngine = createAnalysisEngine(() => new Worker(ENGINE_URL));
