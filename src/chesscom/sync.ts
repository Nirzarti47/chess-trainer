import { getChessUser, putGames, setChessUser } from '../data/gamesRepo';
import type { GameRecord } from '../domain/gameTypes';
import { fetchArchives, fetchMonth, toGameRecord } from './api';

/** Грузит месяцы по одному. После каждого месяца сохраняет партии и loadedThrough. При сбое бросает ChessComError. */
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
  for (let i = 0; i < months.length; i++) {
    const raw = await fetchMonth(user.nick, months[i], fetchFn);
    const games = raw.map(r => toGameRecord(r, user.nick)).filter((g): g is GameRecord => g !== null);
    added += await putGames(games);
    await setChessUser({ nick: user.nick, loadedThrough: months[i] });
    deps.onProgress?.(i + 1, months.length);
  }
  return { added };
}
