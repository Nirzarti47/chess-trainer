import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Chess } from 'chess.js';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CONFIG } from '../../analysis/config';
import { formatScore } from '../../analysis/score';
import { tableEngine } from '../../analysis/testEngine';
import { db } from '../../data/db';
import { putGames, saveAnalysis } from '../../data/gamesRepo';
import type { AltMove, GameAnalysis, GameRecord, MoveReview, Score, SideSummary } from '../../domain/gameTypes';
import type { AnalysisEngine } from '../../engine/analysisEngine';
import type { BoardProps } from '../../ui/Board';
import { ReviewScreen } from './ReviewScreen';

// Настоящая доска проверена в Board.test.tsx; здесь поддельная: запоминает свойства.
const board = vi.hoisted(() => ({ props: null as BoardProps | null }));
vi.mock('../../ui/Board', async () => {
  const { createElement } = await import('react');
  return {
    Board: (p: BoardProps) => {
      board.props = p;
      return createElement('div', { 'data-testid': 'board' });
    },
  };
});

// Детский мат: 1. e4 e5 2. Фh5 Кc6 3. Сc4 Кf6 4. Ф:f7#. Владелец играет белыми.
const MOVES = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];

const game = (over: Partial<GameRecord> = {}): GameRecord => ({
  id: 'g1', url: 'https://www.chess.com/game/live/g1', endTime: Date.UTC(2026, 10, 10, 12), timeClass: 'rapid',
  timeControl: '600', userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 820,
  result: 'win', endReason: 'checkmated', moves: MOVES, ...over,
});

const side: SideSummary = {
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 70, kinds: {},
};

const alt = (move: string, cp: number): AltMove => ({ move, score: { cp }, pv: [move] });
const rv = (ply: number, over: Partial<MoveReview> = {}): MoveReview =>
  ({ ply, move: MOVES[ply], loss: 0, grade: 'best', best: [alt(MOVES[ply], 0)], deep: false, ...over });

const SCORES: Score[] = [{ cp: 0 }, { cp: 30 }, { cp: 25 }, { cp: -10 }, { cp: 0 }, { cp: 20 }, { mate: 1 }, { over: 'white' }];

const analysis = (over: Partial<GameAnalysis> = {}): GameAnalysis => ({
  gameId: 'g1', rulesVersion: CONFIG.RULES_VERSION, analysedAt: 1, tookMs: 1000, scores: SCORES,
  moves: [
    rv(0),
    rv(1, { grade: 'good' }),
    rv(2, {
      grade: 'mistake', loss: 0.15, kind: 'other', phrase: 'Ферзь вышел слишком рано',
      best: [alt('g1f3', 40), alt('b1c3', 30), alt('d2d4', -80)],
    }),
    rv(3, { grade: 'good' }),
    rv(4),
    rv(5, { grade: 'blunder', loss: 0.5, kind: 'allowedMate', phrase: 'Теперь белые ставят мат', best: [alt('g7g6', 0)] }),
    rv(6),
  ],
  white: side, black: side, ...over,
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderReview(path = '/games/g1/review', engine: Pick<AnalysisEngine, 'analyse'> = tableEngine({})) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/games/:gameId/review" element={<ReviewScreen engine={engine} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const card = () => screen.getByTestId('move-card');
const evalText = () => screen.getByLabelText('Перевес').textContent;

beforeEach(async () => {
  board.props = null;
  await db.delete();
  await db.open();
});

describe('ReviewScreen', () => {
  beforeEach(async () => {
    await putGames([game()]);
    await saveAnalysis(analysis(), { put: [], removeIds: [] });
  });

  it('открывается на начальной позиции', async () => {
    renderReview();
    expect(await screen.findByText('Начало партии')).toBeTruthy();
    expect(screen.getByText(/Ты — rival_one/)).toBeTruthy();
    expect(board.props!.lastMove).toBeNull();
    expect(board.props!.orientation).toBe('white');
    // Пробовать свои ходы можно с любой позиции, где есть ходы, включая начальную.
    expect(board.props!.interactive).toBe(true);
    expect(board.props!.dests.get('e2')).toEqual(['e3', 'e4']);
    expect(screen.getByRole('button', { name: 'Предыдущий ход' })).toHaveProperty('disabled', true);
  });

  it('▶ показывает следующий ход', async () => {
    renderReview();
    await screen.findByText('Начало партии');
    fireEvent.click(screen.getByRole('button', { name: 'Следующий ход' }));
    expect(within(card()).getByText('1. e4')).toBeTruthy();
    expect(within(card()).getByText('Лучший ход')).toBeTruthy();
    expect(board.props!.lastMove).toEqual(['e2', 'e4']);
    expect(board.props!.lastMoveTone).toBe('normal');
  });

  it('«Следующая ошибка» ведёт к ошибке владельца: фраза, «Лучше было», стрелка, значок', async () => {
    renderReview();
    await screen.findByText('Начало партии');
    fireEvent.click(screen.getByRole('button', { name: 'Следующая ошибка' }));
    const c = card();
    expect(within(c).getByText('2. Фh5')).toBeTruthy();
    expect(within(c).getByText('Ошибка')).toBeTruthy();
    expect(within(c).getByText('Ферзь вышел слишком рано')).toBeTruthy();
    expect(within(c).getByText('Лучше было')).toBeTruthy();
    // Варианты: Кf3 и Кc3; d4 уступает лучшему слишком много.
    expect(within(c).getByRole('button', { name: /Кf3/ }).textContent).toContain(formatScore({ cp: 40 }));
    expect(within(c).getByRole('button', { name: /Кc3/ })).toBeTruthy();
    expect(within(c).queryByRole('button', { name: /d4/ })).toBeNull();
    expect(board.props!.lastMoveTone).toBe('bad');
    expect(board.props!.badge).toEqual({ square: 'h5', text: '?', tone: 'mistake' });
    expect(board.props!.arrows).toEqual([{ from: 'g1', to: 'f3', tone: 'best' }]);
    // Других ошибок владельца нет.
    expect(screen.getByRole('button', { name: 'Следующая ошибка' })).toHaveProperty('disabled', true);
  });

  it('нажатие на вариант добавляет его стрелку', async () => {
    renderReview('/games/g1/review?ply=2');
    fireEvent.click(await screen.findByRole('button', { name: /Кc3/ }));
    expect(board.props!.arrows).toContainEqual({ from: 'b1', to: 'c3', tone: 'alt' });
    expect(board.props!.arrows).toContainEqual({ from: 'g1', to: 'f3', tone: 'best' });
  });

  it('?ply=N открывает позицию после хода N', async () => {
    renderReview('/games/g1/review?ply=3');
    expect(await screen.findByText('2… Кc6')).toBeTruthy();
    expect(board.props!.lastMove).toEqual(['b8', 'c6']);
  });

  it('на последней позиции ▶ выключена; ?ply вне диапазона — ближайшая позиция', async () => {
    renderReview('/games/g1/review?ply=99');
    expect(await screen.findByText('4. Ф:f7#')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Следующий ход' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Предыдущий ход' })).toHaveProperty('disabled', false);
  });

  it('шкала показывает оценку текущей позиции', async () => {
    renderReview();
    await screen.findByText('Начало партии');
    expect(evalText()).toBe(formatScore(SCORES[0]));
    fireEvent.click(screen.getByRole('button', { name: 'Следующая ошибка' }));
    expect(evalText()).toBe(formatScore(SCORES[3]));
  });

  it('ход соперника с грубой ошибкой получает такую же карточку', async () => {
    renderReview('/games/g1/review?ply=5');
    const c = await screen.findByTestId('move-card');
    expect(within(c).getByText('3… Кf6')).toBeTruthy();
    expect(within(c).getByText('Грубая ошибка')).toBeTruthy();
    expect(within(c).getByText('Теперь белые ставят мат')).toBeTruthy();
    expect(board.props!.badge).toEqual({ square: 'f6', text: '??', tone: 'blunder' });
  });

  it('сыгран лучший ход и вариант один — блока «Лучше было» нет', async () => {
    renderReview('/games/g1/review?ply=0');
    await screen.findByText('1. e4');
    expect(screen.queryByText('Лучше было')).toBeNull();
    expect(board.props!.arrows).toEqual([]);
  });

  it('«‹ Партии» ведёт на сводку', async () => {
    renderReview();
    fireEvent.click(await screen.findByRole('link', { name: /Партии/ }));
    expect(screen.getByTestId('where').textContent).toBe('/games/g1');
  });
});

// Позиция после хода N партии (как на экране).
const fenAfter = (n: number, ...extra: string[]) => {
  const chess = new Chess();
  for (const m of [...MOVES.slice(0, n), ...extra]) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return chess.fen();
};
const playOnBoard = (uci: string) => act(() => board.props!.onMove(uci));

describe('ReviewScreen: свой вариант', () => {
  beforeEach(async () => {
    await putGames([game()]);
    await saveAnalysis(analysis(), { put: [], removeIds: [] });
  });

  it('ход на доске включает «Свой вариант»: плашка, «Считаю…», потом оценка, лучший ход и стрелка', async () => {
    const engine = tableEngine({ [fenAfter(0, 'd2d4')]: [{ move: 'g8f6', score: { cp: 50 }, pv: ['g8f6'] }] });
    renderReview('/games/g1/review', engine);
    await screen.findByText('Начало партии');
    playOnBoard('d2d4');
    expect(screen.getByText('Свой вариант')).toBeTruthy();
    expect(screen.getByText('Считаю…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Шаг назад' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Вернуться к партии' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Следующая ошибка' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Следующий ход' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Предыдущий ход' })).toBeNull();
    // Пока идёт счёт — шкала держит оценку позиции, с которой ушли.
    expect(evalText()).toBe(formatScore(SCORES[0]));
    expect(board.props!.fen).toBe(fenAfter(0, 'd2d4'));
    expect(board.props!.lastMove).toEqual(['d2', 'd4']);
    expect(board.props!.lastMoveTone).toBe('normal');
    expect(board.props!.badge).toBeUndefined();
    expect(board.props!.arrows).toEqual([]);
    expect(board.props!.interactive).toBe(true);
    expect(board.props!.dests.get('g8')).toEqual(['h6', 'f6']);

    expect(await screen.findByText('Лучший ход: Кf6')).toBeTruthy();
    expect(screen.queryByText('Считаю…')).toBeNull();
    // Движок дал +0,5 глазами чёрных — для белых это −0,5.
    expect(screen.getByTestId('explore-card').textContent).toContain(formatScore({ cp: -50 }));
    expect(evalText()).toBe(formatScore({ cp: -50 }));
    expect(board.props!.arrows).toEqual([{ from: 'g8', to: 'f6', tone: 'best' }]);
    expect(engine.calls).toEqual([{ fen: fenAfter(0, 'd2d4'), nodes: CONFIG.EXPLORE_NODES, multipv: 1 }]);
  });

  it('«Вернуться к партии» возвращает карточку исходного хода и выбранный вариант', async () => {
    renderReview('/games/g1/review?ply=2');
    fireEvent.click(await screen.findByRole('button', { name: /Кc3/ }));
    playOnBoard('g7g6');
    expect(screen.queryByTestId('move-card')).toBeNull();
    await screen.findByText(/Лучший ход:/);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к партии' }));
    expect(screen.queryByText('Свой вариант')).toBeNull();
    expect(within(card()).getByText('2. Фh5')).toBeTruthy();
    expect(within(card()).getByRole('button', { name: /Кc3/ }).getAttribute('aria-pressed')).toBe('true');
    expect(board.props!.fen).toBe(fenAfter(3));
    expect(board.props!.lastMove).toEqual(['d1', 'h5']);
    expect(board.props!.badge).toEqual({ square: 'h5', text: '?', tone: 'mistake' });
    expect(board.props!.arrows).toContainEqual({ from: 'b1', to: 'c3', tone: 'alt' });
    expect(evalText()).toBe(formatScore(SCORES[3]));
    expect(screen.getByRole('button', { name: 'Следующий ход' })).toBeTruthy();
  });

  it('«Шаг назад» ведёт по варианту назад, с первого хода — к партии', async () => {
    renderReview();
    await screen.findByText('Начало партии');
    playOnBoard('d2d4');
    await screen.findByText(/Лучший ход:/);
    playOnBoard('d7d5');
    await screen.findByText(/Лучший ход:/);
    expect(board.props!.fen).toBe(fenAfter(0, 'd2d4', 'd7d5'));
    fireEvent.click(screen.getByRole('button', { name: 'Шаг назад' }));
    expect(board.props!.fen).toBe(fenAfter(0, 'd2d4'));
    expect(screen.getByText('Свой вариант')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Шаг назад' }));
    expect(screen.queryByText('Свой вариант')).toBeNull();
    expect(screen.getByText('Начало партии')).toBeTruthy();
    expect(board.props!.fen).toBe(fenAfter(0));
  });

  it('движок не ответил — свой текст, доска остаётся рабочей', async () => {
    renderReview('/games/g1/review', { analyse: async () => null });
    await screen.findByText('Начало партии');
    playOnBoard('e2e4');
    expect(await screen.findByText('Движок не ответил')).toBeTruthy();
    expect(board.props!.interactive).toBe(true);
    playOnBoard('e7e5');
    expect(board.props!.fen).toBe(fenAfter(0, 'e2e4', 'e7e5'));
    await screen.findByText('Движок не ответил');
  });

  it('график в режиме не перематывает партию', async () => {
    renderReview();
    await screen.findByText('Начало партии');
    playOnBoard('e2e4');
    await screen.findByText(/Лучший ход:/);
    fireEvent.pointerDown(screen.getByRole('slider', { name: 'График партии' }), { clientX: 399, pointerId: 1 });
    expect(screen.getByText('Свой вариант')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к партии' }));
    expect(screen.getByText('Начало партии')).toBeTruthy();
  });

  it('мат в своём варианте — «Мат», движок не спрашивается', async () => {
    const engine = tableEngine({});
    // После 3… Кf6 у белых есть мат Ф:f7.
    renderReview('/games/g1/review?ply=5', engine);
    await screen.findByText('3… Кf6');
    playOnBoard('h5f7');
    expect(await screen.findByText('Мат')).toBeTruthy();
    expect(board.props!.interactive).toBe(false);
    expect(engine.calls).toEqual([]);
  });

  it('превращение в своём варианте — всегда в ферзя', async () => {
    renderReview();
    await screen.findByText('Начало партии');
    expect(board.props!.autoQueen).toBe(true);
  });

  it('на последней позиции партии (мат) доска не интерактивна', async () => {
    renderReview('/games/g1/review?ply=6');
    await screen.findByText('4. Ф:f7#');
    expect(board.props!.interactive).toBe(false);
  });
});

describe('ReviewScreen: партия чёрными', () => {
  it('доска и шкала повёрнуты цветом владельца вниз', async () => {
    await putGames([game({ userColor: 'black' })]);
    await saveAnalysis(analysis(), { put: [], removeIds: [] });
    renderReview();
    await screen.findByText('Начало партии');
    expect(board.props!.orientation).toBe('black');
    expect(screen.getByLabelText('Перевес').className).toContain('eval-bar--black');
  });
});

describe('ReviewScreen: нет данных', () => {
  it('неизвестная партия — «Партия не найдена»', async () => {
    renderReview('/games/nope/review');
    expect(await screen.findByText('Партия не найдена')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'К партиям' }));
    expect(screen.getByTestId('where').textContent).toBe('/games');
  });

  it('разбора нет — переход на сводку', async () => {
    await putGames([game()]);
    renderReview();
    expect((await screen.findByTestId('where')).textContent).toBe('/games/g1');
  });

  it('разбор устарел — переход на сводку', async () => {
    await putGames([game()]);
    await saveAnalysis(analysis({ rulesVersion: CONFIG.RULES_VERSION - 1 }), { put: [], removeIds: [] });
    renderReview();
    expect((await screen.findByTestId('where')).textContent).toBe('/games/g1');
  });

  it('сбой чтения базы — свой текст', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.games, 'get').mockRejectedValueOnce(new Error('Unable to open'));
    renderReview();
    expect(await screen.findByText('Не удалось открыть разбор')).toBeTruthy();
    expect(screen.getByText(/Unable to open/)).toBeTruthy();
    vi.restoreAllMocks();
  });
});
