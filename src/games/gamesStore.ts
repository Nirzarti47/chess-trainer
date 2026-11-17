// Состояние загрузки партий и очереди разбора; на него подписываются экраны.
import { useEffect, useSyncExternalStore } from 'react';
import { createAnalysisQueue, type AnalysisQueue, type QueueStatus } from '../analysis/queue';
import { ChessComError, NO_ANSWER } from '../chesscom/api';
import { syncGames } from '../chesscom/sync';
import { getChessUser } from '../data/gamesRepo';
import { analysisEngine } from '../engine/analysisEngine';
import { describeError } from '../screens/lessonErrors';

export interface GamesState { sync: 'idle' | 'loading' | 'error' | 'offline'; syncError: string | null;
  syncProgress: { done: number; total: number } | null; queue: QueueStatus; revision: number /* растёт при изменении данных */ }

/** Автоматическая загрузка при возвращении в приложение — не чаще. */
const AUTO_SYNC_GAP_MS = 10 * 60 * 1000;

// Экземпляр приложения. Воркер и база не трогаются до start/open/refresh.
export const gamesQueue: AnalysisQueue = createAnalysisQueue({
  engine: analysisEngine,
  isVisible: () => document.visibilityState === 'visible',
  onVisibilityChange(fn) {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
});

let state: GamesState = { sync: 'idle', syncError: null, syncProgress: null, queue: gamesQueue.status(), revision: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<GamesState>) {
  state = { ...state, ...patch };
  for (const fn of [...listeners]) fn();
}

gamesQueue.subscribe(() => {
  const q = gamesQueue.status();
  const changed = q.analysed !== state.queue.analysed || q.total !== state.queue.total;
  set({ queue: q, ...(changed ? { revision: state.revision + 1 } : {}) });
});

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useGamesState(): GamesState {
  return useSyncExternalStore(subscribe, () => state);
}

function failure(e: unknown): Partial<GamesState> {
  if (e instanceof ChessComError) {
    if (e.kind === 'offline') return { sync: 'offline', syncError: 'Нет сети, список не обновлён' };
    if (e.kind === 'notFound') return { sync: 'error', syncError: 'Игрок не найден' };
    if (e.kind === 'noAnswer') return { sync: 'error', syncError: NO_ANSWER };
    // Причина уже может начинаться с «Chess.com ответил» — приставку не повторяем.
    const reason = e.message.replace(/^Chess\.com ответил кодом /, 'код ');
    return { sync: 'error', syncError: `Chess.com ответил ошибкой: ${reason}` };
  }
  return { sync: 'error', syncError: `Не удалось загрузить партии: ${describeError(e)}` };
}

let syncing: Promise<void> | null = null;

/** Загружает новые партии, затем перечитывает очередь и запускает её. Не бросает: ошибка уходит в состояние. */
export function syncNow(): Promise<void> {
  if (!syncing) {
    syncing = (async () => {
      set({ sync: 'loading', syncError: null, syncProgress: null });
      try {
        await syncGames({ onProgress: (done, total) => set({ syncProgress: { done, total } }) });
        set({ sync: 'idle', syncProgress: null, revision: state.revision + 1 });
      } catch (e) {
        set({ ...failure(e), syncProgress: null });
      }
      // Даже без сети разбираем то, что уже загружено.
      try {
        await gamesQueue.refresh();
        gamesQueue.start();
      } catch {
        // Очередь прочитает базу при следующем запуске.
      }
    })().finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

let lastAutoSync = -Infinity;

async function autoSync() {
  if (!(await getChessUser())) return;
  lastAutoSync = Date.now();
  await syncNow();
}

/** В App: при монтировании и при возвращении в приложение (не чаще раза в 10 минут) — syncNow, затем gamesQueue.refresh() и start(). Без ника ничего не делает. */
export function GamesBackground(): null {
  useEffect(() => {
    void autoSync().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAutoSync >= AUTO_SYNC_GAP_MS) {
        void autoSync().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return null;
}
