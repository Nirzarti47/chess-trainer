import { isGamePuzzleId, toPuzzle } from '../analysis/gamePuzzles';
import type { Puzzle, ThemeId } from '../domain/types';
import { getGamePuzzle } from './gamesRepo';

export type Circle123 = 1 | 2 | 3;

export interface PuzzleQuery {
  theme: ThemeId; min: number; max: number; exclude: ReadonlySet<string>; limit: number; near?: number;
}

export interface PuzzlePool {
  query(q: PuzzleQuery): Puzzle[];
  byId(id: string): Puzzle | undefined;
  count(theme: ThemeId): number;
}

/** Строка файла: [id, fen, "ход ход …", рейтинг, "тема тема"]. */
export type PuzzleRow = [string, string, string, number, string];

export function createPool(rows: PuzzleRow[]): PuzzlePool {
  const all: Puzzle[] = rows.map(([id, fen, moves, rating, themes]) => ({
    id, fen, moves: moves.split(' '), rating, themes: themes.split(' '),
  }));
  const ids = new Map<string, Puzzle>(all.map((p) => [p.id, p]));
  const byTheme = new Map<ThemeId, Puzzle[]>();
  for (const p of all) {
    for (const t of p.themes) {
      const list = byTheme.get(t);
      if (list) list.push(p); else byTheme.set(t, [p]);
    }
  }
  return {
    query({ theme, min, max, exclude, limit, near }) {
      const found = (byTheme.get(theme) ?? []).filter(
        (p) => p.rating >= min && p.rating <= max && !exclude.has(p.id));
      if (near !== undefined) {
        // sort стабилен: при равной близости остаётся порядок файла (по рейтингу, затем по id)
        found.sort((a, b) => Math.abs(a.rating - near) - Math.abs(b.rating - near));
      }
      return found.slice(0, Math.max(limit, 0));
    },
    byId: (id) => ids.get(id),
    count: (theme) => byTheme.get(theme)?.length ?? 0,
  };
}

/** Один пул из нескольких кругов. Круги не пересекаются по рейтингу, поэтому без near порядок остаётся
 *  по возрастанию рейтинга, если пулы переданы по возрастанию кругов. */
export function mergePools(pools: PuzzlePool[]): PuzzlePool {
  if (pools.length === 1) return pools[0];
  return {
    query(q) {
      const found = pools.flatMap((p) => p.query(q));
      if (q.near !== undefined) {
        const near = q.near;
        found.sort((a, b) => Math.abs(a.rating - near) - Math.abs(b.rating - near));
      }
      return found.slice(0, Math.max(q.limit, 0));
    },
    byId(id) {
      for (const p of pools) {
        const found = p.byId(id);
        if (found) return found;
      }
      return undefined;
    },
    count: (theme) => pools.reduce((sum, p) => sum + p.count(theme), 0),
  };
}

const cache = new Map<Circle123, Promise<PuzzlePool>>();

/** Загружает круг один раз; параллельные вызовы делят один запрос. */
export function loadCircle(c: Circle123): Promise<PuzzlePool> {
  let pending = cache.get(c);
  if (!pending) {
    pending = fetch(`./puzzles/c${c}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Не удалось загрузить задачи круга ${c}`);
        return r.json() as Promise<PuzzleRow[]>;
      })
      .then(createPool);
    pending.catch(() => cache.delete(c));
    cache.set(c, pending);
  }
  return pending;
}

/** Задача по id: из партии — из базы на устройстве (файлы кругов не грузятся), иначе — по всем кругам. */
export async function findPuzzle(id: string): Promise<Puzzle | undefined> {
  if (isGamePuzzleId(id)) {
    const found = await getGamePuzzle(id);
    return found && toPuzzle(found);
  }
  for (const c of [1, 2, 3] as const) {
    const found = (await loadCircle(c)).byId(id);
    if (found) return found;
  }
  return undefined;
}
