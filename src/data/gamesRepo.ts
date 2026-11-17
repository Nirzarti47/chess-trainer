import { CONFIG } from '../analysis/config';
import { db } from './db';
import type { ChessUser, GameAnalysis, GamePuzzle, GameRecord, RangeChoice } from '../domain/gameTypes';

const CHESS_USER = 'chessUser';
const PATTERN_RANGE = 'patternRange';
const DEFAULT_RANGE: RangeChoice = { by: 'count', n: 20 };
const GAME_PUZZLE_PREFIX = 'g:';

async function readKv<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

async function writeKv(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

export async function getChessUser(): Promise<ChessUser | null> {
  return (await readKv<ChessUser>(CHESS_USER)) ?? null;
}

export async function setChessUser(u: ChessUser): Promise<void> {
  await writeKv(CHESS_USER, u);
}

/** Удаляет партии, разборы, задачи из партий и записи повторения с id на 'g:'; ставит новый ник, loadedThrough = null. */
export async function changeNick(nick: string): Promise<void> {
  await db.transaction('rw', [db.kv, db.games, db.analyses, db.gamePuzzles, db.reviews], async () => {
    await db.games.clear();
    await db.analyses.clear();
    await db.gamePuzzles.clear();
    const reviewIds = (await db.reviews.toArray())
      .map(r => r.puzzleId).filter(id => id.startsWith(GAME_PUZZLE_PREFIX));
    await db.reviews.bulkDelete(reviewIds);
    await setChessUser({ nick, loadedThrough: null });
  });
}

/** Добавляет только отсутствующие (по id); возвращает число новых. */
export async function putGames(games: GameRecord[]): Promise<number> {
  return db.transaction('rw', db.games, async () => {
    const existing = new Set((await db.games.toArray()).map(g => g.id));
    const fresh: GameRecord[] = [];
    for (const g of games) {
      if (existing.has(g.id)) continue;
      existing.add(g.id);
      fresh.push(g);
    }
    await db.games.bulkPut(fresh);
    return fresh.length;
  });
}

/** Месяц загрузки одной транзакцией: партии и loadedThrough = month. Пишет, только если ник и loadedThrough
 *  в базе те же, что в from (иначе ник сменили посреди загрузки): тогда ничего не пишет и отвечает null.
 *  Возвращает число новых партий. */
export async function putMonth(from: ChessUser, games: GameRecord[], month: string): Promise<number | null> {
  return db.transaction('rw', [db.kv, db.games], async () => {
    const now = await getChessUser();
    if (!now || now.nick !== from.nick || now.loadedThrough !== from.loadedThrough) return null;
    const added = await putGames(games);
    await setChessUser({ nick: from.nick, loadedThrough: month });
    return added;
  });
}

/** От новых к старым. */
export async function getGames(): Promise<GameRecord[]> {
  return (await db.games.toArray()).sort((a, b) => b.endTime - a.endTime);
}

export async function getGame(id: string): Promise<GameRecord | undefined> {
  return db.games.get(id);
}

export async function getAnalysis(gameId: string): Promise<GameAnalysis | undefined> {
  return db.analyses.get(gameId);
}

/** Разбор по нынешним правилам; устаревший (другая rulesVersion) считается отсутствующим. */
export async function getCurrentAnalysis(gameId: string): Promise<GameAnalysis | undefined> {
  const a = await getAnalysis(gameId);
  return a?.rulesVersion === CONFIG.RULES_VERSION ? a : undefined;
}

export async function getAnalyses(): Promise<GameAnalysis[]> {
  return db.analyses.toArray();
}

/** Одна транзакция: кладёт разбор, вносит put, удаляет removeIds из gamePuzzles и из reviews. */
export async function saveAnalysis(a: GameAnalysis, puzzles: { put: GamePuzzle[]; removeIds: string[] }): Promise<void> {
  await db.transaction('rw', [db.analyses, db.gamePuzzles, db.reviews], async () => {
    await db.analyses.put(a);
    await db.gamePuzzles.bulkDelete(puzzles.removeIds);
    await db.reviews.bulkDelete(puzzles.removeIds);
    await db.gamePuzzles.bulkPut(puzzles.put);
  });
}

export async function getGamePuzzles(gameId?: string): Promise<GamePuzzle[]> {
  const all = await db.gamePuzzles.toArray();
  return gameId === undefined ? all : all.filter(p => p.gameId === gameId);
}

export async function getGamePuzzle(id: string): Promise<GamePuzzle | undefined> {
  return db.gamePuzzles.get(id);
}

/** id задач (любых), у которых есть попытка с результатом 'clean'. */
export async function getCleanPuzzleIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const a of await db.attempts.toArray()) {
    if (a.result === 'clean' && a.puzzleId !== undefined) ids.add(a.puzzleId);
  }
  return ids;
}

export async function getPatternRange(): Promise<RangeChoice> {
  return (await readKv<RangeChoice>(PATTERN_RANGE)) ?? { ...DEFAULT_RANGE };
}

export async function setPatternRange(r: RangeChoice): Promise<void> {
  await writeKv(PATTERN_RANGE, r);
}
