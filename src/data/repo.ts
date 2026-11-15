import { db } from './db';
import { localDay } from '../domain/dates';
import { START_RATING, updateRating } from '../domain/rating';
import { schedule } from '../domain/srs';
import { dayCounts } from '../domain/streak';
import { applyAttempt } from '../domain/themeStats';
import { XP } from '../domain/xp';
import type {
  DayLog, LessonProgress, LessonTask, Profile, ReviewItem, Settings, Source, TaskResult, ThemeId, ThemeStat,
} from '../domain/types';

export interface ActiveLesson {
  nodeId: string; lessonIndex: number; tasks: LessonTask[]; cursor: number;
  results: (TaskResult | null)[]; retry: number[];
}

const PROFILE = 'profile';
const SETTINGS = 'settings';
const ACTIVE_LESSON = 'activeLesson';

const DEFAULT_SETTINGS: Settings = { board: 'night', pieceSet: 'maestro' };

async function readKv<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

async function writeKv(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

const defaultProfile = (now: Date): Profile => ({
  rating: START_RATING, ratedCount: 0, xp: 0, firstDay: localDay(now),
  lastBackupAt: null, backupSnoozedAt: null, fastTrackDeclined: [],
});

/** Профиль создаётся при первом обращении; firstDay — день этого обращения.
 *  Поля, которых нет в сохранённом профиле (добавленные в новых версиях), берутся по умолчанию. */
export async function getProfile(now: Date = new Date()): Promise<Profile> {
  return db.transaction('rw', db.kv, async () => {
    const existing = await readKv<Partial<Profile>>(PROFILE);
    if (existing) return { ...defaultProfile(now), ...existing };
    const profile = defaultProfile(now);
    await writeKv(PROFILE, profile);
    return profile;
  });
}

async function updateProfile(change: (p: Profile) => Profile, now?: Date): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    await writeKv(PROFILE, change(await getProfile(now)));
  });
}

/** Счётчики дня; день без записи — нули. */
export async function getDay(day: string): Promise<DayLog> {
  return (await db.days.get(day)) ?? { day, lessons: 0, freePuzzles: 0 };
}

async function updateDay(day: string, change: (log: DayLog) => DayLog): Promise<void> {
  await db.days.put(change(await getDay(day)));
}

export async function recordTaskResult(r: {
  puzzleId?: string; themes: ThemeId[]; puzzleRating?: number;
  result: TaskResult; source: Source; rated: boolean; now: Date;
}): Promise<void> {
  const { puzzleId, themes, puzzleRating, result, source, rated, now } = r;
  const today = localDay(now);
  await db.transaction('rw', [db.kv, db.attempts, db.themeStats, db.reviews, db.days, db.ratingHistory], async () => {
    await db.attempts.add({ puzzleId, themes, puzzleRating, result, source, rated, at: now.getTime() });

    let profile = await getProfile(now);
    if (rated && puzzleRating !== undefined) {
      const rating = updateRating(profile.rating, puzzleRating, result === 'clean', profile.ratedCount);
      profile = { ...profile, rating, ratedCount: profile.ratedCount + 1 };
      for (const theme of new Set(themes)) {
        await db.themeStats.put(applyAttempt(await db.themeStats.get(theme), theme, puzzleRating, result));
      }
      await db.ratingHistory.add({ at: now.getTime(), rating });
    }
    profile = { ...profile, xp: profile.xp + (result === 'clean' ? XP.clean : XP.other) };
    await writeKv(PROFILE, profile);

    if (puzzleId !== undefined) {
      const next = schedule(await db.reviews.get(puzzleId), puzzleId, result, today);
      if (next) await db.reviews.put(next);
      else await db.reviews.delete(puzzleId);
    }

    if (source === 'free' || source === 'review') {
      await updateDay(today, log => ({ ...log, freePuzzles: log.freePuzzles + 1 }));
    }
  });
}

export async function completeLesson(r: {
  nodeId: string; lessonIndex: number; clean: number; total: number; now: Date;
}): Promise<void> {
  const { nodeId, lessonIndex, clean, total, now } = r;
  await db.transaction('rw', [db.kv, db.lessons, db.days], async () => {
    // Путь судит тему по первому прохождению: результат повтора не перезаписывает сохранённый.
    if (!(await db.lessons.get([nodeId, lessonIndex]))) {
      await db.lessons.put({ nodeId, lessonIndex, clean, total });
    }
    await updateProfile(p => ({ ...p, xp: p.xp + XP.lesson }), now);
    await updateDay(localDay(now), log => ({ ...log, lessons: log.lessons + 1 }));
  });
}

export async function getSettings(): Promise<Settings> {
  return (await readKv<Settings>(SETTINGS)) ?? { ...DEFAULT_SETTINGS };
}

export async function saveSettings(s: Settings): Promise<void> {
  await writeKv(SETTINGS, s);
}

export async function getThemeStats(): Promise<ThemeStat[]> {
  return db.themeStats.toArray();
}

export async function getLessonProgress(): Promise<LessonProgress[]> {
  return db.lessons.toArray();
}

/** Дни, засчитанные для серии. */
export async function getActiveDays(): Promise<Set<string>> {
  const logs = await db.days.toArray();
  return new Set(logs.filter(dayCounts).map(l => l.day));
}

export async function getDueReviews(today: string): Promise<ReviewItem[]> {
  return db.reviews.where('dueDay').belowOrEqual(today).toArray();
}

/** Убирает записи повторения (например, тех задач, которых больше нет в базе). */
export async function deleteReviews(puzzleIds: string[]): Promise<void> {
  if (puzzleIds.length > 0) await db.reviews.bulkDelete(puzzleIds);
}

/** Сколько разных задач решено хотя бы раз без ошибки и подсказки. */
export async function getSolvedPuzzleCount(): Promise<number> {
  const ids = new Set<string>();
  for (const a of await db.attempts.toArray()) {
    if (a.result === 'clean' && a.puzzleId !== undefined) ids.add(a.puzzleId);
  }
  return ids.size;
}

/** Задачи, у которых есть хотя бы одна записанная попытка.
 *  Читаем таблицу целиком (getAll), без курсоров: на курсор по уникальным ключам индекса Safari на iPhone
 *  отвечает «UnknownError: Unable to open cursor», и урок темы не открывался. */
export async function getSeenPuzzleIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const a of await db.attempts.toArray()) {
    if (a.puzzleId !== undefined) ids.add(a.puzzleId);
  }
  return ids;
}

export async function getRatingHistory(): Promise<{ at: number; rating: number }[]> {
  const points = await db.ratingHistory.orderBy('id').toArray();
  return points.map(({ at, rating }) => ({ at, rating }));
}

export async function saveActiveLesson(a: ActiveLesson): Promise<void> {
  await writeKv(ACTIVE_LESSON, a);
}

export async function loadActiveLesson(): Promise<ActiveLesson | null> {
  return (await readKv<ActiveLesson>(ACTIVE_LESSON)) ?? null;
}

export async function clearActiveLesson(): Promise<void> {
  await db.kv.delete(ACTIVE_LESSON);
}

export async function declineFastTrack(nodeId: string): Promise<void> {
  await updateProfile(p => p.fastTrackDeclined.includes(nodeId)
    ? p
    : { ...p, fastTrackDeclined: [...p.fastTrackDeclined, nodeId] });
}

export async function markBackupDone(now: Date): Promise<void> {
  await updateProfile(p => ({ ...p, lastBackupAt: now.getTime() }), now);
}

export async function snoozeBackup(now: Date): Promise<void> {
  await updateProfile(p => ({ ...p, backupSnoozedAt: now.getTime() }), now);
}
