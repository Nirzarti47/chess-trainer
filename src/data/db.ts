import Dexie, { type EntityTable } from 'dexie';
import type { GameAnalysis, GamePuzzle, GameRecord } from '../domain/gameTypes';
import type { DayLog, LessonProgress, ReviewItem, Source, TaskResult, ThemeId, ThemeStat } from '../domain/types';

/** Одиночные значения: профиль, настройки, активный урок. */
export interface KvRow { key: string; value: unknown }
export interface AttemptRow {
  id?: number; puzzleId?: string; themes: ThemeId[]; puzzleRating?: number;
  result: TaskResult; source: Source; rated: boolean; at: number;
}
export interface RatingPoint { id?: number; at: number; rating: number }

export const TABLES = ['kv', 'attempts', 'themeStats', 'reviews', 'lessons', 'days', 'ratingHistory'] as const;
export type TableName = typeof TABLES[number];

export class TrainerDb extends Dexie {
  kv!: EntityTable<KvRow, 'key'>;
  attempts!: EntityTable<AttemptRow, 'id'>;
  themeStats!: EntityTable<ThemeStat, 'theme'>;
  reviews!: EntityTable<ReviewItem, 'puzzleId'>;
  lessons!: Dexie.Table<LessonProgress, [string, number]>;
  days!: EntityTable<DayLog, 'day'>;
  ratingHistory!: EntityTable<RatingPoint, 'id'>;
  games!: EntityTable<GameRecord, 'id'>;
  analyses!: EntityTable<GameAnalysis, 'gameId'>;
  gamePuzzles!: EntityTable<GamePuzzle, 'id'>;

  constructor() {
    super('chess-trainer');
    this.version(1).stores({
      kv: 'key',
      attempts: '++id, puzzleId',
      themeStats: 'theme',
      reviews: 'puzzleId, dueDay',
      lessons: '[nodeId+lessonIndex], nodeId',
      days: 'day',
      ratingHistory: '++id',
    });
    // Этап 2: партии с Chess.com. В TABLES (резервная копия этапа 1) новые таблицы не входят.
    this.version(2).stores({
      kv: 'key',
      attempts: '++id, puzzleId',
      themeStats: 'theme',
      reviews: 'puzzleId, dueDay',
      lessons: '[nodeId+lessonIndex], nodeId',
      days: 'day',
      ratingHistory: '++id',
      games: 'id',
      analyses: 'gameId',
      gamePuzzles: 'id',
    });
  }
}

export const db = new TrainerDb();
