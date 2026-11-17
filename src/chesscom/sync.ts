import { getChessUser, putMonth } from '../data/gamesRepo';
import type { ChessUser, GameRecord } from '../domain/gameTypes';
import { fetchArchives, fetchMonth, toGameRecord } from './api';

/** Грузит месяцы по одному. Каждый месяц — партии и loadedThrough одной транзакцией.
 *  Ник сменили посреди загрузки — останавливается без записи. При сбое бросает ChessComError. */
export async function syncGames(
  deps: { fetchFn?: typeof fetch; onProgress?(done: number, total: number): void } = {},
): Promise<{ added: number }> {
  const user = await getChessUser();
  if (!user) return { added: 0 };
  const fetchFn = deps.fetchFn ?? fetch;
  const all = await fetchArchives(user.nick, fetchFn);
  const from = user.loadedThrough;
  const months = from === null ? all : all.filter(m => m >= from);
  let added = 0;
  /** Что должно лежать в базе перед записью очередного месяца. */
  let at: ChessUser = user;
  for (let i = 0; i < months.length; i++) {
    const raw = await fetchMonth(user.nick, months[i], fetchFn);
    const games = raw.map(r => toGameRecord(r, user.nick)).filter((g): g is GameRecord => g !== null);
    const n = await putMonth(at, games, months[i]);
    if (n === null) break;
    added += n;
    at = { nick: user.nick, loadedThrough: months[i] };
    deps.onProgress?.(i + 1, months.length);
  }
  return { added };
}
