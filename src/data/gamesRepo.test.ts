import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  changeNick, getAnalyses, getAnalysis, getChessUser, getCleanPuzzleIds, getGame, getGamePuzzle, getGamePuzzles,
  getGames, getPatternRange, putGames, saveAnalysis, setChessUser, setPatternRange,
} from './gamesRepo';
import type { GameAnalysis, GamePuzzle, GameRecord, SideSummary } from '../domain/gameTypes';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const game = (id: string, endTime: number): GameRecord => ({
  id, url: `https://www.chess.com/game/live/${id}`, endTime, timeClass: 'rapid', timeControl: '600',
  userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 790,
  result: 'win', endReason: 'resigned', moves: ['e2e4', 'e7e5'],
});

const summary = (): SideSummary => ({
  grades: { best: 1, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 100, kinds: {},
});

const analysis = (gameId: string): GameAnalysis => ({
  gameId, rulesVersion: 1, analysedAt: 1000, tookMs: 50,
  scores: [{ cp: 0 }, { cp: 20 }, { cp: 10 }], moves: [], white: summary(), black: summary(),
});

const puzzle = (gameId: string, ply: number): GamePuzzle => ({
  id: `g:${gameId}:${ply}`, gameId, ply, endTime: 100,
  fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: ['a1a2', 'h1h2'],
  kind: 'other', phrase: 'Фраза', loss: 0.3,
});

describe('партии', () => {
  it('putGames добавляет только отсутствующие и возвращает число новых', async () => {
    expect(await putGames([game('a', 100)])).toBe(1);
    expect(await putGames([game('a', 100)])).toBe(0);
    expect(await getGames()).toHaveLength(1);
  });

  it('putGames не перезаписывает уже сохранённую партию', async () => {
    await putGames([game('a', 100)]);
    await putGames([{ ...game('a', 100), opponent: 'rival_two' }, game('b', 200)]);
    expect((await getGame('a'))!.opponent).toBe('rival_one');
    expect(await getGame('zzz')).toBeUndefined();
  });

  it('getGames — от новых к старым', async () => {
    await putGames([game('a', 100), game('b', 300), game('c', 200)]);
    expect((await getGames()).map(g => g.endTime)).toEqual([300, 200, 100]);
  });
});

describe('разборы и задачи из партий', () => {
  it('saveAnalysis: кладёт разбор и задачи, удаляет removeIds из задач и повторения', async () => {
    const [p1, p2] = [puzzle('x', 5), puzzle('x', 9)];
    await saveAnalysis(analysis('x'), { put: [p1, p2], removeIds: [] });
    expect(await getAnalysis('x')).toEqual(analysis('x'));
    expect(await getAnalyses()).toEqual([analysis('x')]);
    await db.reviews.put({ puzzleId: p1.id, stage: 0, dueDay: '2026-11-15' });
    await saveAnalysis(analysis('x'), { put: [], removeIds: [p1.id] });
    expect(await getGamePuzzles('x')).toEqual([p2]);
    expect(await db.reviews.get(p1.id)).toBeUndefined();
    expect(await getGamePuzzle(p2.id)).toEqual(p2);
    expect(await getGamePuzzle(p1.id)).toBeUndefined();
  });

  it('getGamePuzzles без аргумента — задачи всех партий, с аргументом — одной', async () => {
    await saveAnalysis(analysis('x'), { put: [puzzle('x', 5)], removeIds: [] });
    await saveAnalysis(analysis('y'), { put: [puzzle('y', 7)], removeIds: [] });
    expect(await getGamePuzzles()).toHaveLength(2);
    expect((await getGamePuzzles('y')).map(p => p.id)).toEqual(['g:y:7']);
  });

  it('getCleanPuzzleIds — задачи, у которых есть чистая попытка', async () => {
    const add = (puzzleId: string | undefined, result: 'clean' | 'mistake' | 'hint') =>
      db.attempts.add({ puzzleId, themes: [], result, source: 'game', rated: false, at: 1 });
    await add('a', 'mistake');
    await add('a', 'clean');
    await add('b', 'hint');
    await add(undefined, 'clean');
    await add('g:x:5', 'clean');
    expect(await getCleanPuzzleIds()).toEqual(new Set(['a', 'g:x:5']));
  });
});

describe('ник и настройки', () => {
  it('ник сохраняется и читается; без него — null', async () => {
    expect(await getChessUser()).toBeNull();
    await setChessUser({ nick: 'Owner_Test', loadedThrough: '2026/10' });
    expect(await getChessUser()).toEqual({ nick: 'Owner_Test', loadedThrough: '2026/10' });
  });

  it('changeNick стирает всё про партии и задачи g:, прочее повторение оставляет', async () => {
    await setChessUser({ nick: 'Owner_Test', loadedThrough: '2026/10' });
    await putGames([game('x', 100)]);
    await saveAnalysis(analysis('x'), { put: [puzzle('x', 5)], removeIds: [] });
    await db.reviews.put({ puzzleId: 'g:x:5', stage: 0, dueDay: '2026-11-15' });
    await db.reviews.put({ puzzleId: '00abc', stage: 1, dueDay: '2026-11-18' });
    await changeNick('other');
    expect(await db.games.toArray()).toEqual([]);
    expect(await db.analyses.toArray()).toEqual([]);
    expect(await db.gamePuzzles.toArray()).toEqual([]);
    expect(await db.reviews.get('g:x:5')).toBeUndefined();
    expect(await db.reviews.get('00abc')).toBeDefined();
    expect(await getChessUser()).toEqual({ nick: 'other', loadedThrough: null });
  });

  it('getPatternRange: по умолчанию 20 последних партий; сохранённое читается', async () => {
    expect(await getPatternRange()).toEqual({ by: 'count', n: 20 });
    await setPatternRange({ by: 'time', span: 'month' });
    expect(await getPatternRange()).toEqual({ by: 'time', span: 'month' });
  });
});

describe('без курсоров', () => {
  it('ни одна функция модуля не открывает курсор: Safari на iPhone отвечает на них «Unable to open cursor»', async () => {
    const spies = [
      vi.spyOn(IDBIndex.prototype, 'openCursor'), vi.spyOn(IDBIndex.prototype, 'openKeyCursor'),
      vi.spyOn(IDBObjectStore.prototype, 'openCursor'), vi.spyOn(IDBObjectStore.prototype, 'openKeyCursor'),
    ];
    try {
      await setChessUser({ nick: 'Owner_Test', loadedThrough: null });
      await getChessUser();
      await putGames([game('x', 100), game('y', 200)]);
      await getGames();
      await getGame('x');
      await saveAnalysis(analysis('x'), { put: [puzzle('x', 5)], removeIds: ['g:x:9'] });
      await getAnalysis('x');
      await getAnalyses();
      await getGamePuzzles();
      await getGamePuzzles('x');
      await getGamePuzzle('g:x:5');
      await db.attempts.add({ puzzleId: 'g:x:5', themes: [], result: 'clean', source: 'game', rated: false, at: 1 });
      await getCleanPuzzleIds();
      await setPatternRange({ by: 'count', n: 10 });
      await getPatternRange();
      await changeNick('other');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('обновление базы с версии 1', () => {
  it('профиль сохраняется, новые таблицы пусты', async () => {
    await db.delete();
    const old = new Dexie('chess-trainer');
    old.version(1).stores({
      kv: 'key', attempts: '++id, puzzleId', themeStats: 'theme', reviews: 'puzzleId, dueDay',
      lessons: '[nodeId+lessonIndex], nodeId', days: 'day', ratingHistory: '++id',
    });
    await old.open();
    await old.table('kv').put({ key: 'profile', value: { rating: 750 } });
    old.close();

    await db.open();
    expect((await db.kv.get('profile'))!.value).toEqual({ rating: 750 });
    expect(await db.games.toArray()).toEqual([]);
    expect(await db.analyses.toArray()).toEqual([]);
    expect(await db.gamePuzzles.toArray()).toEqual([]);
  });
});
