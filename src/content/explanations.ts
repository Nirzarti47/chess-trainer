import type { ExplainStep, LessonTask, ThemeId } from '../domain/types';

// Заглушка: настоящее содержание добавит задача 15.

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const placeholder = (): ExplainStep => ({ fen: START_FEN, text: 'Объяснение появится позже' });

export function getAuthoredLesson(_nodeId: string, _lessonIndex: number): LessonTask[] {
  return [{ kind: 'explain', step: placeholder() }];
}

export function getExplain(_themeId: ThemeId, _mode: 'full' | 'reminder'): ExplainStep[] {
  return [placeholder()];
}
