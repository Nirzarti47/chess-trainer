import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getChessUser, setChessUser } from './gamesRepo';
import type { GameAnalysis, GamePuzzle, GameRecord } from '../domain/gameTypes';
import { BackupError, exportBackup, importBackup } from './backup';
import {
  completeLesson, getActiveDays, getDueReviews, getLessonProgress, getProfile, getRatingHistory,
  getSeenPuzzleIds, getSettings, getThemeStats, loadActiveLesson, recordTaskResult, saveActiveLesson, saveSettings,
} from './repo';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const NOW = new Date(2026, 10, 14, 12, 0);

type Tables = Record<string, Record<string, unknown>[]>;

async function fillState() {
  await getProfile(NOW);
  await saveSettings({ board: 'wood', pieceSet: 'cburnett' });
  for (let i = 0; i < 10; i++) {
    await recordTaskResult({ puzzleId: `p${i}`, themes: ['fork'], puzzleRating: 600,
      result: i === 0 ? 'mistake' : 'clean', source: 'free', rated: true, now: NOW });
  }
  await completeLesson({ nodeId: 'n1', lessonIndex: 0, clean: 3, total: 4, now: new Date(2026, 10, 13, 12) });
  await saveActiveLesson({ nodeId: 'n1', lessonIndex: 1, tasks: [], cursor: 0, results: [], retry: [] });
}

async function snapshot() {
  return {
    profile: await getProfile(),
    settings: await getSettings(),
    themes: await getThemeStats(),
    reviews: await getDueReviews('2030-01-01'),
    lessons: await getLessonProgress(),
    days: await getActiveDays(),
    seen: await getSeenPuzzleIds(),
    history: await getRatingHistory(),
    active: await loadActiveLesson(),
  };
}

describe('резервная копия', () => {
  it('экспорт → очистка → импорт возвращает всё состояние', async () => {
    await fillState();
    const before = await snapshot();
    expect(before.reviews).toHaveLength(1);
    expect(before.days).toEqual(new Set(['2026-11-13', '2026-11-14']));

    const blob = await exportBackup();
    const text = await blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.app).toBe('chess-trainer');
    expect(parsed.version).toBe(2);
    expect(typeof parsed.exportedAt).toBe('string');

    await db.delete();
    await db.open();
    expect((await getThemeStats())).toEqual([]);

    await importBackup(text);
    expect(await snapshot()).toEqual(before);
  });

  it('импорт заменяет текущие данные, а не дополняет', async () => {
    const text = await (await exportBackup()).text();
    await fillState();
    await importBackup(text);
    expect(await getThemeStats()).toEqual([]);
    expect(await getSeenPuzzleIds()).toEqual(new Set());
  });

  it.each([
    ['не json', 'Файл повреждён'],
    ['{"app":"other"}', 'Это не файл резервной копии'],
    ['{"app":"chess-trainer","version":99,"tables":{}}', 'Файл от другой версии приложения'],
    ['{"app":"chess-trainer","version":2,"tables":{}}', 'Файл повреждён'],
    ['{"app":"chess-trainer","version":2}', 'Файл повреждён'],
    ['null', 'Это не файл резервной копии'],
  ])('Review Focus 3: %s → BackupError, профиль не тронут', async (text, message) => {
    await fillState();
    const before = await getProfile();
    await expect(importBackup(text)).rejects.toThrow(new BackupError(message));
    await expect(importBackup(text)).rejects.toBeInstanceOf(BackupError);
    expect(await getProfile()).toEqual(before);
  });

  it.each([
    ['запись попытки без числового id', (t: Tables) => { t.attempts = [{ ...t.attempts[0], id: 'x' }]; }],
    ['повторение без puzzleId', (t: Tables) => { t.reviews = [{ stage: 0, dueDay: '2026-11-15' }]; }],
    ['урок с номером строкой', (t: Tables) => { t.lessons = [{ nodeId: 'n1', lessonIndex: '0', clean: 1, total: 1 }]; }],
    ['день без ключа', (t: Tables) => { t.days = [{ lessons: 1, freePuzzles: 0 }]; }],
    ['строка kv без ключа', (t: Tables) => { t.kv = [...t.kv, { value: 1 }]; }],
    ['рейтинг профиля не число', (t: Tables) => {
      t.kv = t.kv.map((r) => (r.key === 'profile' ? { ...r, value: { ...(r.value as object), rating: 'много' } } : r));
    }],
    ['опыт профиля null', (t: Tables) => {
      t.kv = t.kv.map((r) => (r.key === 'profile' ? { ...r, value: { ...(r.value as object), xp: null } } : r));
    }],
  ])('испорченная форма строк (%s) — файл отвергается целиком', async (_name, spoil) => {
    await fillState();
    const before = await snapshot();
    const good = JSON.parse(await (await exportBackup()).text());
    spoil(good.tables);
    await expect(importBackup(JSON.stringify(good))).rejects.toThrow(new BackupError('Файл повреждён'));
    expect(await snapshot()).toEqual(before);
  });

  it('сбой записи (не разбора) — «Не удалось записать данные»', async () => {
    await fillState();
    const text = await (await exportBackup()).text();
    db.close();
    try {
      await expect(importBackup(text)).rejects.toThrow(new BackupError('Не удалось записать данные'));
    } finally {
      await db.open();
    }
  });

  it('ошибка при записи откатывает импорт целиком', async () => {
    await fillState();
    const before = await snapshot();
    const good = JSON.parse(await (await exportBackup()).text());
    // Каждая строка проходит разбор, но две попытки с одним id падают уже при записи (BulkError).
    good.tables.attempts = [{ id: 1, puzzleId: 'a' }, { id: 1, puzzleId: 'b' }];
    await expect(importBackup(JSON.stringify(good))).rejects.toThrow(new BackupError('Файл повреждён'));
    expect(await snapshot()).toEqual(before);
  });
});

const game = (id: string): GameRecord => ({
  id, url: `https://example.test/${id}`, endTime: 1_700_000_000_000, timeClass: 'rapid', timeControl: '600',
  userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 790, result: 'win',
  endReason: 'checkmated', moves: ['e2e4', 'e7e5'],
});
const analysis = (gameId: string) =>
  ({ gameId, rulesVersion: 1, scores: [{ cp: 0 }, { cp: 10 }, { cp: 5 }], moves: [] }) as unknown as GameAnalysis;
const puzzle = (gameId: string): GamePuzzle => ({
  id: `g:${gameId}:2`, gameId, ply: 2, endTime: 1_700_000_000_000, fen: 'x', moves: ['e7e5', 'g1f3'],
  kind: 'other', phrase: 'фраза', loss: 0.3,
});

async function fillGames() {
  await setChessUser({ nick: 'Owner_Test', loadedThrough: '2026/11' });
  await db.kv.put({ key: 'patternRange', value: { by: 'count', n: 20 } });
  await db.games.bulkPut([game('a1'), game('a2')]);
  await db.analyses.put(analysis('a1'));
  await db.gamePuzzles.put(puzzle('a1'));
}

const gamesState = async () => ({
  games: await db.games.toArray(), analyses: await db.analyses.toArray(), puzzles: await db.gamePuzzles.toArray(),
  user: await getChessUser(), range: (await db.kv.get('patternRange'))?.value,
});

const V1_TABLES = ['kv', 'attempts', 'themeStats', 'reviews', 'lessons', 'days', 'ratingHistory'];

/** Файл версии 1: шесть таблиц этапа 1 (плюс kv) из текущей выгрузки, без таблиц партий. */
async function v1File(editKv?: (kv: Record<string, unknown>[]) => Record<string, unknown>[]) {
  const v2 = JSON.parse(await (await exportBackup()).text());
  const tables: Tables = {};
  for (const n of V1_TABLES) tables[n] = v2.tables[n];
  if (editKv) tables.kv = editKv(tables.kv);
  return { app: 'chess-trainer', version: 1, exportedAt: 'x', tables };
}

describe('резервная копия версии 2: партии', () => {
  it('выгрузка и восстановление возвращают партии, разборы, задачи и ник', async () => {
    await fillState();
    await fillGames();
    const before = await gamesState();
    const text = await (await exportBackup()).text();
    expect(Object.keys(JSON.parse(text).tables)).toEqual(expect.arrayContaining(['games', 'analyses', 'gamePuzzles']));
    await db.delete();
    await db.open();
    await importBackup(text);
    expect(await gamesState()).toEqual(before);
    expect(before.games).toHaveLength(2);
    expect(before.user?.nick).toBe('Owner_Test');
  });

  it('версия 2 заменяет партии и ник целиком: в файле их нет — на устройстве тоже', async () => {
    const text = await (await exportBackup()).text();
    await fillGames();
    await importBackup(text);
    expect(await gamesState()).toEqual({ games: [], analyses: [], puzzles: [], user: null, range: undefined });
  });

  it('файл версии 1: прогресс из файла, партии и ник на устройстве остались', async () => {
    await fillState();
    const file = await v1File((kv) => kv.filter((r) => r.key !== 'chessUser' && r.key !== 'patternRange'));
    const reviewsInFile = await getDueReviews('2030-01-01');
    await db.reviews.clear();
    await db.reviews.put({ puzzleId: 'g:a1:2', stage: 0, dueDay: '2026-11-15' } as never);
    await fillGames();
    const games = await gamesState();

    await importBackup(JSON.stringify(file));
    expect(await gamesState()).toEqual(games);
    expect(await getDueReviews('2030-01-01')).toEqual(reviewsInFile);
  });

  it('файл версии 1: ника и диапазона на устройстве не было — они не появляются', async () => {
    await fillState();
    const file = await v1File();
    await db.kv.clear();
    await importBackup(JSON.stringify(file));
    expect(await getChessUser()).toBeNull();
    expect(await db.kv.get('patternRange')).toBeUndefined();
  });

  it('файл версии 1: ник из самого файла не подменяет ник устройства', async () => {
    await fillState();
    const file = await v1File((kv) => [...kv, { key: 'chessUser', value: { nick: 'rival_two', loadedThrough: null } }]);
    await setChessUser({ nick: 'Owner_Test', loadedThrough: null });
    await importBackup(JSON.stringify(file));
    expect((await getChessUser())?.nick).toBe('Owner_Test');
  });

  it('файл версии 1 с испорченной таблицей этапа 1 отвергается, база не изменилась', async () => {
    await fillState();
    await fillGames();
    const before = await snapshot();
    const gBefore = await gamesState();
    const file = await v1File();
    file.tables.days = [{ lessons: 1 }];
    await expect(importBackup(JSON.stringify(file))).rejects.toThrow(new BackupError('Файл повреждён'));
    expect(await snapshot()).toEqual(before);
    expect(await gamesState()).toEqual(gBefore);
  });

  it.each([
    ['партия без id', (t: Tables) => { t.games = [{ ...t.games[0], id: undefined }]; }],
    ['партия без массива ходов', (t: Tables) => { t.games = [{ ...t.games[0], moves: 'e2e4' }]; }],
    ['разбор без gameId', (t: Tables) => { t.analyses = [{ ...t.analyses[0], gameId: '' }]; }],
    ['разбор без scores', (t: Tables) => { t.analyses = [{ ...t.analyses[0], scores: null }]; }],
    ['разбор без moves', (t: Tables) => { t.analyses = [{ ...t.analyses[0], moves: {} }]; }],
    ['задача с числом вместо id', (t: Tables) => { t.gamePuzzles = [{ ...t.gamePuzzles[0], id: 5 }]; }],
    ['задача с тремя ходами', (t: Tables) => { t.gamePuzzles = [{ ...t.gamePuzzles[0], moves: ['a', 'b', 'c'] }]; }],
    ['нет таблицы games', (t: Tables) => { delete t.games; }],
  ])('версия 2: %s → «Файл повреждён», база не изменилась', async (_name, spoil) => {
    await fillState();
    await fillGames();
    const before = await snapshot();
    const gBefore = await gamesState();
    const good = JSON.parse(await (await exportBackup()).text());
    spoil(good.tables);
    await expect(importBackup(JSON.stringify(good))).rejects.toThrow(new BackupError('Файл повреждён'));
    expect(await snapshot()).toEqual(before);
    expect(await gamesState()).toEqual(gBefore);
  });

  it('версия 3 → «Файл от другой версии приложения»', async () => {
    await expect(importBackup('{"app":"chess-trainer","version":3,"tables":{}}'))
      .rejects.toThrow(new BackupError('Файл от другой версии приложения'));
  });
});
