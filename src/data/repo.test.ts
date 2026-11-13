import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  clearActiveLesson, completeLesson, declineFastTrack, getActiveDays, getDueReviews, getLessonProgress,
  getProfile, getRatingHistory, getSeenPuzzleIds, getSettings, getThemeStats, loadActiveLesson,
  markBackupDone, recordTaskResult, saveActiveLesson, saveSettings, snoozeBackup, type ActiveLesson,
} from './repo';
import type { Source, TaskResult } from '../domain/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const NOW = new Date(2026, 10, 14, 12, 0);

const task = (over: Partial<{ puzzleId: string; result: TaskResult; source: Source; rated: boolean; puzzleRating: number; now: Date }> = {}) => ({
  puzzleId: 'p1', themes: ['fork'], puzzleRating: 600, result: 'clean' as TaskResult,
  source: 'free' as Source, rated: true, now: NOW, ...over,
});

describe('профиль и настройки', () => {
  it('новый профиль: рейтинг 600, firstDay — сегодня', async () => {
    const p = await getProfile(NOW);
    expect(p).toEqual({ rating: 600, ratedCount: 0, xp: 0, firstDay: '2026-11-14',
      lastBackupAt: null, backupSnoozedAt: null, fastTrackDeclined: [] });
  });

  it('firstDay запоминается при первом запуске', async () => {
    await getProfile(NOW);
    expect((await getProfile(new Date(2026, 10, 20))).firstDay).toBe('2026-11-14');
  });

  it('настройки по умолчанию и сохранение', async () => {
    expect(await getSettings()).toEqual({ board: 'night', pieceSet: 'maestro' });
    await saveSettings({ board: 'wood', pieceSet: 'cburnett' });
    expect(await getSettings()).toEqual({ board: 'wood', pieceSet: 'cburnett' });
  });

  it('отказ от ускоренного прохождения, резервная копия и отсрочка', async () => {
    await getProfile(NOW);
    await declineFastTrack('n1');
    await declineFastTrack('n1');
    await markBackupDone(new Date(1000));
    await snoozeBackup(new Date(2000));
    const p = await getProfile();
    expect(p.fastTrackDeclined).toEqual(['n1']);
    expect(p.lastBackupAt).toBe(1000);
    expect(p.backupSnoozedAt).toBe(2000);
  });
});

describe('recordTaskResult', () => {
  it('clean, rated, задача 600: рейтинг 620, тема 620, опыт 10, очередь пуста', async () => {
    await recordTaskResult(task());
    const p = await getProfile();
    expect(p.rating).toBe(620);
    expect(p.ratedCount).toBe(1);
    expect(p.xp).toBe(10);
    expect(await getThemeStats()).toEqual([{ theme: 'fork', rating: 620, solved: 1, clean: 1 }]);
    expect(await getDueReviews('2030-01-01')).toEqual([]);
    expect(await getRatingHistory()).toEqual([{ at: NOW.getTime(), rating: 620 }]);
  });

  it('mistake: рейтинг 580, задача в очереди на завтра, опыт 5', async () => {
    await recordTaskResult(task({ result: 'mistake' }));
    const p = await getProfile();
    expect(p.rating).toBe(580);
    expect(p.xp).toBe(5);
    expect((await getThemeStats())[0]).toEqual({ theme: 'fork', rating: 580, solved: 1, clean: 0 });
    expect(await getDueReviews('2026-11-14')).toEqual([]);
    expect(await getDueReviews('2026-11-15')).toEqual([{ puzzleId: 'p1', stage: 0, dueDay: '2026-11-15' }]);
  });

  it('hint считается нерешённой', async () => {
    await recordTaskResult(task({ result: 'hint' }));
    expect((await getProfile()).rating).toBe(580);
  });

  it('rated: false рейтинг не меняет', async () => {
    await recordTaskResult(task({ rated: false }));
    const p = await getProfile();
    expect(p.rating).toBe(600);
    expect(p.ratedCount).toBe(0);
    expect(p.xp).toBe(10);
    expect(await getThemeStats()).toEqual([]);
    expect(await getRatingHistory()).toEqual([]);
  });

  it('rated без рейтинга задачи: рейтинг не меняется, опыт начисляется', async () => {
    await recordTaskResult(task({ puzzleRating: undefined, puzzleId: undefined }));
    const p = await getProfile();
    expect(p.rating).toBe(600);
    expect(p.ratedCount).toBe(0);
    expect(p.xp).toBe(10);
  });

  it('чистое повторение продвигает задачу по очереди, после последней ступени удаляет', async () => {
    await recordTaskResult(task({ result: 'mistake' }));
    await recordTaskResult(task({ rated: false, source: 'review', now: new Date(2026, 10, 15, 12) }));
    expect(await getDueReviews('2030-01-01')).toEqual([{ puzzleId: 'p1', stage: 1, dueDay: '2026-11-18' }]);
    await recordTaskResult(task({ rated: false, source: 'review', now: new Date(2026, 10, 18, 12) }));
    await recordTaskResult(task({ rated: false, source: 'review', now: new Date(2026, 10, 25, 12) }));
    expect(await getDueReviews('2030-01-01')).toEqual([{ puzzleId: 'p1', stage: 3, dueDay: '2026-12-16' }]);
    await recordTaskResult(task({ rated: false, source: 'review', now: new Date(2026, 11, 16, 12) }));
    expect(await getDueReviews('2030-01-01')).toEqual([]);
  });

  it('getSeenPuzzleIds — задачи, у которых есть попытка', async () => {
    await recordTaskResult(task({ puzzleId: 'a' }));
    await recordTaskResult(task({ puzzleId: 'b', rated: false }));
    await recordTaskResult(task({ puzzleId: 'a', rated: false }));
    await recordTaskResult(task({ puzzleId: undefined, puzzleRating: undefined }));
    expect(await getSeenPuzzleIds()).toEqual(new Set(['a', 'b']));
  });

  it('десять свободных задач засчитывают день, девять — нет', async () => {
    for (let i = 0; i < 9; i++) await recordTaskResult(task({ puzzleId: `p${i}`, rated: false }));
    expect(await getActiveDays()).toEqual(new Set());
    await recordTaskResult(task({ puzzleId: 'p9', source: 'review', rated: false }));
    expect(await getActiveDays()).toEqual(new Set(['2026-11-14']));
  });

  it('источник lesson счётчик freePuzzles не трогает', async () => {
    for (let i = 0; i < 10; i++) await recordTaskResult(task({ puzzleId: `p${i}`, source: 'lesson', rated: false }));
    expect(await getActiveDays()).toEqual(new Set());
    expect(await db.days.get('2026-11-14')).toBeUndefined();
  });
});

describe('completeLesson', () => {
  it('Review Focus 5: урок после полуночи пишется в новый день', async () => {
    await completeLesson({ nodeId: 'n1', lessonIndex: 2, clean: 4, total: 5, now: new Date(2026, 10, 14, 0, 5) });
    expect(await getActiveDays()).toEqual(new Set(['2026-11-14']));
    expect(await db.days.get('2026-11-14')).toEqual({ day: '2026-11-14', lessons: 1, freePuzzles: 0 });
    expect(await getLessonProgress()).toEqual([{ nodeId: 'n1', lessonIndex: 2, clean: 4, total: 5 }]);
    expect((await getProfile()).xp).toBe(20);
  });

  it('уроки weak нумеруются отдельно и копятся', async () => {
    await completeLesson({ nodeId: 'weak', lessonIndex: 0, clean: 5, total: 5, now: NOW });
    await completeLesson({ nodeId: 'weak', lessonIndex: 1, clean: 3, total: 5, now: NOW });
    expect((await getLessonProgress()).filter(l => l.nodeId === 'weak')).toHaveLength(2);
    expect((await db.days.get('2026-11-14'))!.lessons).toBe(2);
  });
});

describe('активный урок', () => {
  it('сохраняется, читается и очищается', async () => {
    const a: ActiveLesson = {
      nodeId: 'n1', lessonIndex: 0, cursor: 1, results: ['clean', null], retry: [0],
      tasks: [
        { kind: 'explain', step: { fen: '8/8/8/8/8/8/8/K6k w - - 0 1', text: 'Привет' } },
        { kind: 'puzzle', puzzle: { id: 'p', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', moves: ['a1a2', 'h1h2'], rating: 600, themes: ['fork'] } },
      ],
    };
    expect(await loadActiveLesson()).toBeNull();
    await saveActiveLesson(a);
    expect(await loadActiveLesson()).toEqual(a);
    await clearActiveLesson();
    expect(await loadActiveLesson()).toBeNull();
  });
});
