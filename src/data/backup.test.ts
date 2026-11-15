import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
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
    expect(parsed.version).toBe(1);
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
    ['{"app":"chess-trainer","version":1,"tables":{}}', 'Файл повреждён'],
    ['{"app":"chess-trainer","version":1}', 'Файл повреждён'],
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
    good.tables.themeStats = [{ rating: 1 }]; // нет ключа theme
    await expect(importBackup(JSON.stringify(good))).rejects.toThrow(new BackupError('Файл повреждён'));
    expect(await snapshot()).toEqual(before);
  });
});
