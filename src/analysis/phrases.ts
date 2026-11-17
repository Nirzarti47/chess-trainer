import type { Grade, Mark, MistakeKind } from '../domain/gameTypes';
import type { ThemeId } from '../domain/types';

export const GRADE_TITLE: Record<Grade, string> = {
  best: 'Лучший ход', good: 'Хороший ход', inaccuracy: 'Неточность', mistake: 'Ошибка', blunder: 'Грубая ошибка',
};

export const MARK_TITLE: Record<Mark, string> = { brilliant: 'Блестящий ход', great: 'Сильный ход' };

/** Фраза к ошибке, у которой вид не определён. */
export const OTHER_PHRASE = 'Лучше было сыграть так';

/** Названия видов для экрана «Частые ошибки». */
export const KIND_TITLE: Record<MistakeKind, string> = {
  missedMate: 'Пропущен мат',
  allowedMate: 'Допущен мат',
  pieceEnPrise: 'Фигура поставлена под бой',
  pieceUndefended: 'Фигура осталась под боем',
  missedCapture: 'Пропущен захват',
  missedFork: 'Пропущена вилка',
  badTrade: 'Невыгодный размен',
  missedCheck: 'Пропущен сильный шах',
  other: 'Другое',
};

/** Совет на будущее в сводке: одно короткое предложение. */
export const KIND_ADVICE: Record<MistakeKind, string> = {
  missedMate: 'Перед ходом проверь все шахи: среди них может быть мат.',
  allowedMate: 'Перед ходом проверь, может ли соперник ответить матом.',
  pieceEnPrise: 'Перед ходом проверь, что соперник может забрать.',
  pieceUndefended: 'Перед ходом проверь, какие твои фигуры под ударом и чем они защищены.',
  missedCapture: 'Перед ходом посмотри, что можно забрать у соперника.',
  missedFork: 'Ищи ход, который нападает сразу на две фигуры.',
  badTrade: 'Перед разменом посчитай, что отдаёшь и что забираешь.',
  missedCheck: 'Перед ходом проверь все шахи — свои и соперника. '
    + 'Шах часто выигрывает фигуру, которая стоит за королём или без защиты.',
  other: 'Перед ходом сравни два-три разных хода.',
};

/** Темы общей базы задач, которые тренируют этот вид ошибки. */
export const THEMES_OF_KIND: Record<MistakeKind, ThemeId[]> = {
  missedMate: ['mateIn1', 'mateIn2'],
  allowedMate: ['mateIn1', 'mateIn2'],
  pieceEnPrise: ['hangingPiece'],
  pieceUndefended: ['hangingPiece'],
  missedCapture: ['hangingPiece'],
  missedFork: ['fork'],
  badTrade: [],
  missedCheck: ['skewer', 'doubleCheck'],
  other: [],
};
