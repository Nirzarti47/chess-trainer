export type ThemeId = string;
export type TaskResult = 'clean' | 'mistake' | 'hint';
export type Source = 'lesson' | 'free' | 'review' | 'weak' | 'exam';
export type Circle = 0 | 1 | 2 | 3;

/** Формат Lichess: fen — позиция ДО хода соперника; moves[0] — ход соперника,
 *  moves[1] — первый ход решающего, дальше по очереди. Ходы в UCI. */
export interface Puzzle { id: string; fen: string; moves: string[]; rating: number; themes: ThemeId[] }

export interface ThemeStat { theme: ThemeId; rating: number; solved: number; clean: number }
export interface ReviewItem { puzzleId: string; stage: 0 | 1 | 2 | 3; dueDay: string }   // день: 'YYYY-MM-DD'
export interface DayLog { day: string; lessons: number; freePuzzles: number }
export interface LessonProgress { nodeId: string; lessonIndex: number; clean: number; total: number }
export interface Profile { rating: number; ratedCount: number; xp: number; firstDay: string;
  lastBackupAt: number | null; backupSnoozedAt: number | null; fastTrackDeclined: string[] }
export interface Settings { board: string; pieceSet: string }

export interface ExplainStep { fen: string; text: string; move?: string; arrows?: [string, string][] }
export interface AuthoredTask { fen: string; prompt: string; accept: string[]; explain: string }
export interface ChoiceQuestion { fen?: string; prompt: string; options: string[]; correct: number;
  explain: string; fact?: 'checkmate' | 'stalemate' | 'check' | 'none' }
export type LessonTask =
  | { kind: 'explain'; step: ExplainStep }
  | { kind: 'puzzle'; puzzle: Puzzle }
  | { kind: 'authored'; task: AuthoredTask }
  | { kind: 'choice'; q: ChoiceQuestion };
