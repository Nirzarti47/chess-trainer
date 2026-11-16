// Очередь разбора партий: по одной партии, пока приложение видно.
import { getAnalyses, getAnalysis, getGamePuzzles, getGames, saveAnalysis } from '../data/gamesRepo';
import type { GameAnalysis, GameRecord } from '../domain/gameTypes';
import type { AnalysisEngine, AnalysisPriority } from '../engine/analysisEngine';
import { analyseGame } from './analyseGame';
import { CONFIG } from './config';
import { reconcile, selectPuzzles } from './gamePuzzles';

export interface QueueStatus { total: number; analysed: number;
  running: { gameId: string; done: number; total: number } | null; lastError: string | null }
export interface AnalysisQueue {
  start(): void; stop(): void;
  /** Ставит партию первой и считает с приоритетом screen. Готовый разбор текущей версии отдаёт сразу. */
  open(gameId: string): Promise<GameAnalysis | null>;
  setRange(gameIds: string[]): void;      // партии выбранного промежутка «Частых ошибок»
  refresh(): Promise<void>;               // перечитать партии из базы (после загрузки или смены ника)
  status(): QueueStatus; subscribe(fn: () => void): () => void;
}

export const ENGINE_FAILED = 'Не удалось разобрать партию: движок не ответил';

/** Сами в фоне разбираются только партии с временем подумать. */
const isSlow = (g: GameRecord) => g.timeClass === 'rapid' || g.timeClass === 'daily';

interface Job { gameId: string; priority: AnalysisPriority; controller: AbortController }
interface Opening { promise: Promise<GameAnalysis | null>; resolve(a: GameAnalysis | null): void }

export function createAnalysisQueue(deps: { engine: Pick<AnalysisEngine, 'analyse'>;
  isVisible(): boolean; onVisibilityChange(fn: () => void): () => void }): AnalysisQueue {
  /** От новых к старым. */
  let games: GameRecord[] = [];
  const byId = new Map<string, GameRecord>();
  /** gameId → версия правил сохранённого разбора. */
  const versions = new Map<string, number>();
  let loading: Promise<void> | null = null;
  let started = false;
  let range: string[] = [];
  /** Открытые партии; последняя открытая — первая. */
  const openings = new Map<string, Opening>();
  /** Неудачи за сеанс: одна — партия в конец, две — исключена. */
  const failures = new Map<string, number>();
  let job: Job | null = null;
  let looping = false;
  let unlisten: (() => void) | null = null;
  const listeners = new Set<() => void>();
  let snapshot: QueueStatus = { total: 0, analysed: 0, running: null, lastError: null };

  function update(patch: Partial<QueueStatus>) {
    snapshot = { ...snapshot, ...patch };
    for (const fn of [...listeners]) fn();
  }

  function counts(): Pick<QueueStatus, 'total' | 'analysed'> {
    let analysed = 0;
    for (const g of games) if (versions.get(g.id) === CONFIG.RULES_VERSION) analysed++;
    return { total: games.length, analysed };
  }

  async function load() {
    const [list, analyses] = await Promise.all([getGames(), getAnalyses()]);
    games = list;
    byId.clear();
    for (const g of list) byId.set(g.id, g);
    versions.clear();
    for (const a of analyses) versions.set(a.gameId, a.rulesVersion);
    // Партии больше нет (смена ника) — её разбор бросаем.
    if (job && !byId.has(job.gameId)) job.controller.abort();
    update(counts());
  }

  function ensureLoaded(): Promise<void> {
    if (!loading) loading = load();
    return loading;
  }

  function listen() {
    if (!unlisten) unlisten = deps.onVisibilityChange(onVisibility);
  }

  function onVisibility() {
    if (deps.isVisible()) kick();
    else job?.controller.abort();
  }

  /** Партии фона по порядку: промежуток → последние AUTO_GAMES → старая версия; одна неудача — в конец. */
  function backgroundOrder(): string[] {
    const fresh = (id: string) => !versions.has(id);
    const inRange = new Set(range);
    const slow = games.filter(isSlow);
    const ids = [
      ...slow.filter(g => inRange.has(g.id) && fresh(g.id)).map(g => g.id),
      ...slow.slice(0, CONFIG.AUTO_GAMES).filter(g => fresh(g.id)).map(g => g.id),
      ...games.filter(g => (versions.get(g.id) ?? CONFIG.RULES_VERSION) < CONFIG.RULES_VERSION).map(g => g.id),
    ];
    const order = [...new Set(ids)].filter(id => (failures.get(id) ?? 0) < 2);
    return [...order.filter(id => !failures.has(id)), ...order.filter(id => failures.has(id))];
  }

  function next(): Job | null {
    const opened = [...openings.keys()].pop();
    if (opened !== undefined) return { gameId: opened, priority: 'screen', controller: new AbortController() };
    if (!started) return null;
    const id = backgroundOrder()[0];
    return id === undefined ? null : { gameId: id, priority: 'background', controller: new AbortController() };
  }

  function settleOpening(gameId: string, a: GameAnalysis | null) {
    const o = openings.get(gameId);
    if (!o) return;
    openings.delete(gameId);
    o.resolve(a);
  }

  /** Считает одну партию. Отмена (видимость, open, смена ника) неудачей не считается. */
  async function run(j: Job) {
    const game = byId.get(j.gameId);
    if (!game) {
      settleOpening(j.gameId, null);
      return;
    }
    job = j;
    update({ running: { gameId: game.id, done: 0, total: 0 } });
    // Приоритет читается при каждом запросе: open идущей партии поднимает его до screen.
    const engine: Pick<AnalysisEngine, 'analyse'> = {
      analyse: (fen, opts) => deps.engine.analyse(fen, { ...opts, priority: j.priority }),
    };
    let saved: GameAnalysis | null = null;
    try {
      const a = await analyseGame(game, {
        engine, priority: j.priority, signal: j.controller.signal,
        onProgress: (done, total) => {
          if (job === j) update({ running: { gameId: game.id, done, total } });
        },
      });
      if (a && !j.controller.signal.aborted) {
        const old = await getGamePuzzles(game.id);
        await saveAnalysis(a, reconcile(old, selectPuzzles(game, a), a));
        saved = a;
      }
    } catch {
      // Сбой базы считается неудачей партии, как и молчание движка.
    } finally {
      job = null;
    }
    if (saved) {
      versions.set(game.id, saved.rulesVersion);
      failures.delete(game.id);
      settleOpening(game.id, saved);
      update({ ...counts(), running: null });
      return;
    }
    if (j.controller.signal.aborted) {
      update({ running: null });
      return;
    }
    const n = (failures.get(game.id) ?? 0) + 1;
    failures.set(game.id, n);
    settleOpening(game.id, null);
    update({ running: null, ...(n >= 2 ? { lastError: ENGINE_FAILED } : {}) });
  }

  async function loop() {
    if (looping) return;
    looping = true;
    try {
      try {
        await ensureLoaded();
      } catch {
        loading = null; // прочитать базу не вышло — попробуем при следующем запуске
        return;
      }
      while (deps.isVisible()) {
        const j = next();
        if (!j) break;
        await run(j);
      }
    } finally {
      looping = false;
    }
  }

  function kick() {
    void loop();
  }

  return {
    start() {
      started = true;
      listen();
      kick();
    },
    stop() {
      started = false;
      if (job && job.priority === 'background') job.controller.abort();
    },
    async open(gameId) {
      const pending = openings.get(gameId);
      if (pending) return pending.promise;
      await ensureLoaded();
      if (!byId.has(gameId)) return null;
      if (versions.get(gameId) === CONFIG.RULES_VERSION) {
        const ready = await getAnalysis(gameId);
        if (ready && ready.rulesVersion === CONFIG.RULES_VERSION) return ready;
      }
      const again = openings.get(gameId);
      if (again) return again.promise;
      let resolve!: (a: GameAnalysis | null) => void;
      const promise = new Promise<GameAnalysis | null>(r => { resolve = r; });
      openings.set(gameId, { promise, resolve });
      listen();
      if (job) {
        // Идущая партия: та же — считается дальше уже с приоритетом screen, другая — прерывается.
        if (job.gameId === gameId) job.priority = 'screen';
        else job.controller.abort();
      }
      kick();
      return promise;
    },
    setRange(gameIds) {
      range = [...gameIds];
      kick();
    },
    async refresh() {
      loading = load();
      await loading;
      kick();
    },
    status: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
