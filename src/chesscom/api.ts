import { Chess } from 'chess.js';
import type { GameRecord, Side, TimeClass } from '../domain/gameTypes';

const BASE = 'https://api.chess.com/pub/player';
const TIME_CLASSES: readonly string[] = ['rapid', 'blitz', 'bullet', 'daily'];
const DRAW_RESULTS: readonly string[] = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

// Партия с заданной позицией; chess.js может сбросить заголовок, поэтому ищем в тексте
const SETUP_RE = /\[SetUp\s+"1"\]/;

export class ChessComError extends Error {
  kind: 'notFound' | 'offline' | 'bad';
  constructor(kind: 'notFound' | 'offline' | 'bad', message: string) {
    super(message);
    this.name = 'ChessComError';
    this.kind = kind;
  }
}

export const normalizeNick = (raw: string): string => raw.trim().toLowerCase();

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

async function get(url: string, fetchFn: typeof fetch): Promise<Response> {
  if (offline()) throw new ChessComError('offline', 'Нет сети');
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (e) {
    // TypeError — обрыв сети; любой другой сбой запроса тоже становится ChessComError.
    if (e instanceof TypeError || offline()) throw new ChessComError('offline', 'Нет сети');
    throw new ChessComError('bad', `сбой запроса (${e instanceof Error ? `${e.name}: ${e.message}` : String(e)})`);
  }
  if (res.status === 404) throw new ChessComError('notFound', 'Игрок не найден');
  if (res.status !== 200) throw new ChessComError('bad', `Chess.com ответил кодом ${res.status}`);
  return res;
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const res = await get(url, fetchFn);
  try {
    return await res.json();
  } catch {
    throw new ChessComError('bad', 'Ответ Chess.com не читается');
  }
}

export async function fetchPlayer(nick: string, fetchFn: typeof fetch = fetch): Promise<void> {
  await get(`${BASE}/${encodeURIComponent(nick)}`, fetchFn);
}

/** Хвост адреса месяца: `/games/ГГГГ/ММ`. */
const MONTH_TAIL = /\/games\/(\d{4}\/\d{2})$/;

/** Месяцы вида '2023/01' по возрастанию. Адреса с другим хвостом отбрасываются: месяц идёт в следующий запрос. */
export async function fetchArchives(nick: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const data = await getJson(`${BASE}/${encodeURIComponent(nick)}/games/archives`, fetchFn);
  const list = (data as { archives?: unknown } | null)?.archives;
  if (!Array.isArray(list) || !list.every(u => typeof u === 'string')) {
    throw new ChessComError('bad', 'Неверный список месяцев');
  }
  return (list as string[]).flatMap(u => MONTH_TAIL.exec(u)?.[1] ?? []).sort();
}

export async function fetchMonth(nick: string, month: string, fetchFn: typeof fetch = fetch): Promise<unknown[]> {
  const data = await getJson(`${BASE}/${encodeURIComponent(nick)}/games/${month}`, fetchFn);
  const games = (data as { games?: unknown } | null)?.games;
  if (!Array.isArray(games)) throw new ChessComError('bad', 'Неверный список партий');
  return games;
}

interface RawSide { rating: number; result: string; username: string }
const isSide = (s: unknown): s is RawSide => {
  const o = s as Partial<RawSide> | null;
  return typeof o === 'object' && o !== null && typeof o.rating === 'number'
    && typeof o.result === 'string' && typeof o.username === 'string';
};

/** Превращает партию из ответа Chess.com в запись; null, если партия не подходит для разбора. */
export function toGameRecord(raw: unknown, nick: string): GameRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  if (g.rules !== 'chess' || typeof g.uuid !== 'string' || g.uuid === '') return null;
  if (typeof g.time_class !== 'string' || !TIME_CLASSES.includes(g.time_class)) return null;
  if (typeof g.pgn !== 'string' || typeof g.url !== 'string' || typeof g.end_time !== 'number') return null;
  if (!isSide(g.white) || !isSide(g.black)) return null;

  const me = normalizeNick(nick);
  let userColor: Side;
  if (g.white.username.toLowerCase() === me) userColor = 'white';
  else if (g.black.username.toLowerCase() === me) userColor = 'black';
  else return null;
  const mine = userColor === 'white' ? g.white : g.black;
  const theirs = userColor === 'white' ? g.black : g.white;

  if (SETUP_RE.test(g.pgn)) return null;
  const chess = new Chess();
  try {
    chess.loadPgn(g.pgn);
  } catch {
    return null;
  }
  const history = chess.history({ verbose: true });
  if (history.length < 2) return null;

  const result = mine.result === 'win' ? 'win' : DRAW_RESULTS.includes(mine.result) ? 'draw' : 'loss';
  return {
    id: g.uuid, url: g.url, endTime: g.end_time * 1000, timeClass: g.time_class as TimeClass,
    timeControl: typeof g.time_control === 'string' ? g.time_control : '',
    userColor, userRating: mine.rating, opponent: theirs.username, opponentRating: theirs.rating,
    result, endReason: mine.result === 'win' ? theirs.result : mine.result,
    moves: history.map(m => m.from + m.to + (m.promotion ?? '')),
  };
}
