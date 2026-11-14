import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { ChoiceQuestion, ExplainStep, LessonTask } from '../domain/types';
import { CASTLING_QUESTIONS } from './basics';
import { CURRICULUM } from './curriculum';
import { getAuthoredLesson, getExplain } from './explanations';
import { THEMES } from './themes';

// Проверка шахматной правильности всего авторского содержания разом.
// Оценку ходов движком делает отдельный скрипт scripts/verify_content.mjs.

/** Все темы учебного плана: у каждой должно быть объяснение. */
const THEME_IDS = THEMES.map((t) => t.id);
/** Авторские узлы берутся из учебного плана: новый узел без содержания уронит тест. */
const AUTHORED_NODES = CURRICULUM.flatMap((s) => s.nodes).filter((n) => n.kind === 'authored');
const OPENING_LESSONS = [0, 1, 2];

const basics = () => getAuthoredLesson('basics:basics', 0);
const openings = (i: number) => getAuthoredLesson('c1:openings', i);

/** Всё содержание с подписью, где оно лежит: так сообщение об ошибке укажет место. */
function allTasks(): { where: string; task: LessonTask }[] {
  const out: { where: string; task: LessonTask }[] = [];
  for (const node of AUTHORED_NODES) {
    for (let l = 0; l < node.lessons; l++) {
      getAuthoredLesson(node.id, l).forEach((task, i) => out.push({ where: `${node.id}#${l}[${i}]`, task }));
    }
  }
  for (const id of THEME_IDS) {
    for (const mode of ['full', 'reminder'] as const) {
      getExplain(id, mode).forEach((step, i) => out.push({ where: `${id}.${mode}[${i}]`, task: { kind: 'explain', step } }));
    }
  }
  return out;
}

function fensOf(task: LessonTask): string[] {
  if (task.kind === 'explain') return [task.step.fen];
  if (task.kind === 'authored') return [task.task.fen];
  if (task.kind === 'choice') return task.q.fen ? [task.q.fen] : [];
  return [task.puzzle.fen];
}

function textsOf(task: LessonTask): string[] {
  if (task.kind === 'explain') return [task.step.text];
  if (task.kind === 'authored') return [task.task.prompt, task.task.explain];
  if (task.kind === 'choice') return [task.q.prompt, task.q.explain, ...task.q.options];
  return [];
}

/** Ходы UCI, допустимые в позиции. */
function legalMoves(fen: string): string[] {
  return new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
}

/** Сторона, которая не ходит, не должна стоять под шахом: иначе позиция невозможна. */
function opponentInCheck(fen: string): boolean {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return new Chess(parts.join(' ')).isCheck();
}

function factHolds(q: ChoiceQuestion): boolean {
  const c = new Chess(q.fen!);
  switch (q.fact) {
    case 'checkmate': return c.isCheckmate();
    case 'stalemate': return c.isStalemate();
    case 'check': return c.isCheck() && !c.isCheckmate();
    case 'none': return !c.isCheck() && !c.isStalemate();
    default: return true;
  }
}

const SQUARE = /^[a-h][1-8]$/;
const SENTENCE_END = /[.!?…](?=\s|$)/g;

describe('авторское содержание', () => {
  it('каждая позиция загружается и возможна: по королю у каждой стороны, под шахом только та, что ходит', () => {
    for (const { where, task } of allTasks()) {
      for (const fen of fensOf(task)) {
        expect(() => new Chess(fen), where).not.toThrow();
        const board = new Chess(fen).board().flat();
        expect(board.filter((p) => p?.type === 'k' && p.color === 'w'), where).toHaveLength(1);
        expect(board.filter((p) => p?.type === 'k' && p.color === 'b'), where).toHaveLength(1);
        expect(opponentInCheck(fen), `${where}: под шахом сторона, которая не ходит`).toBe(false);
      }
    }
  });

  it('каждый ход шага и каждый ход из accept допустим в своей позиции', () => {
    for (const { where, task } of allTasks()) {
      if (task.kind === 'explain' && task.step.move !== undefined) {
        expect(legalMoves(task.step.fen), where).toContain(task.step.move);
      }
      if (task.kind === 'authored') {
        expect(task.task.accept.length, where).toBeGreaterThan(0);
        for (const m of task.task.accept) expect(legalMoves(task.task.fen), `${where} ${m}`).toContain(m);
      }
    }
  });

  it('стрелки указывают на клетки доски', () => {
    for (const { where, task } of allTasks()) {
      if (task.kind !== 'explain') continue;
      for (const [from, to] of task.step.arrows ?? []) {
        expect(from, where).toMatch(SQUARE);
        expect(to, where).toMatch(SQUARE);
      }
    }
  });

  it('факт вопроса совпадает с позицией', () => {
    let withFact = 0;
    for (const { where, task } of allTasks()) {
      if (task.kind !== 'choice' || task.q.fact === undefined) continue;
      withFact++;
      expect(task.q.fen, where).toBeDefined();
      expect(factHolds(task.q), `${where}: ${task.q.fact}`).toBe(true);
    }
    expect(withFact).toBeGreaterThanOrEqual(4);
  });

  it('правильный ответ есть среди вариантов, тексты непустые', () => {
    for (const { where, task } of allTasks()) {
      if (task.kind === 'choice') {
        expect(task.q.options.length, where).toBeGreaterThanOrEqual(2);
        expect(Number.isInteger(task.q.correct), where).toBe(true);
        expect(task.q.correct, where).toBeGreaterThanOrEqual(0);
        expect(task.q.correct, where).toBeLessThan(task.q.options.length);
      }
      for (const text of textsOf(task)) expect(text.trim(), where).not.toBe('');
    }
  });

  it('шаг объяснения — не больше двух предложений', () => {
    for (const { where, task } of allTasks()) {
      if (task.kind !== 'explain') continue;
      expect(task.step.text.match(SENTENCE_END)?.length ?? 0, `${where}: ${task.step.text}`).toBeLessThanOrEqual(2);
    }
  });

  it('в текстах нет обращения к человеку в прошедшем времени с родом', () => {
    for (const { where, task } of allTasks()) {
      for (const text of textsOf(task)) {
        expect(text, where).not.toMatch(/ты\s+(ошибся|решил|сделал|нашёл)/i);
        expect(text, where).not.toMatch(/(^|[^а-яё])ошибся([^а-яё]|$)/i);
      }
    }
  });
});

describe('состав уроков', () => {
  it('у каждого авторского узла учебного плана есть содержание для каждого урока', () => {
    expect(AUTHORED_NODES.length).toBeGreaterThan(0);
    for (const node of AUTHORED_NODES) {
      for (let l = 0; l < node.lessons; l++) expect(getAuthoredLesson(node.id, l).length, `${node.id}#${l}`).toBeGreaterThan(0);
    }
  });

  it('«Проверка основ»: 4 вопроса про шах, мат и пат, рокировка, взятие на проходе, размены', () => {
    const tasks = basics();
    const choices = tasks.filter((t) => t.kind === 'choice');
    expect(choices.filter((t) => t.q.fact !== undefined)).toHaveLength(4);
    expect(new Set(choices.map((t) => t.q.fact).filter(Boolean))).toEqual(new Set(['checkmate', 'stalemate', 'check', 'none']));
    expect(choices).toHaveLength(4 + 2 + 3);
    expect(tasks.filter((t) => t.kind === 'explain')).toHaveLength(2 + 1);
    expect(tasks.filter((t) => t.kind === 'authored')).toHaveLength(1);
  });

  it('вопросы о рокировке отвечают правилам: «можно» ровно тогда, когда короткая рокировка допустима', () => {
    expect(CASTLING_QUESTIONS).toHaveLength(2);
    const answers = CASTLING_QUESTIONS.map((q) => q.correct === 0);
    expect(answers).toContain(true);
    expect(answers).toContain(false);
    for (const q of CASTLING_QUESTIONS) {
      const king = new Chess(q.fen!).turn() === 'w' ? 'e1g1' : 'e8g8';
      expect(legalMoves(q.fen!).includes(king), q.prompt).toBe(q.correct === 0);
    }
  });

  it('задание на взятие на проходе принимает только взятие на проходе', () => {
    const task = basics().find((t) => t.kind === 'authored');
    if (task?.kind !== 'authored') throw new Error('нет задания');
    const c = new Chess(task.task.fen);
    for (const uci of task.task.accept) {
      const move = c.moves({ verbose: true }).find((m) => m.from + m.to === uci);
      expect(move?.isEnPassant(), uci).toBe(true);
    }
  });

  it('«Дебютные принципы»: в каждом уроке 3 шага объяснения, затем 8 авторских заданий', () => {
    for (const l of OPENING_LESSONS) {
      const kinds = openings(l).map((t) => t.kind);
      expect(kinds, `урок ${l}`).toEqual([...Array(3).fill('explain'), ...Array(8).fill('authored')]);
    }
  });

  it('у каждой темы есть полное объяснение из 2–3 шагов и напоминание из одного шага', () => {
    for (const id of THEME_IDS) {
      const full: ExplainStep[] = getExplain(id, 'full');
      expect(full.length, id).toBeGreaterThanOrEqual(2);
      expect(full.length, id).toBeLessThanOrEqual(3);
      expect(full[full.length - 1].move, `${id}: в конце человек сам делает ход`).toBeDefined();
      expect(getExplain(id, 'reminder'), id).toHaveLength(1);
    }
  });
});
