import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CONFIG } from '../../analysis/config';
import { db } from '../../data/db';
import { putGames, saveAnalysis } from '../../data/gamesRepo';
import type { GameAnalysis, GamePuzzle, GameRecord, Grade, MistakeKind, MoveReview, SideSummary } from '../../domain/gameTypes';
import type { GamesState } from '../../games/gamesStore';
import { GameSummaryScreen } from './GameSummaryScreen';

// Состояние и очередь подменяются; база настоящая. status() очереди отдаёт то же состояние, что и экран.
const store = vi.hoisted(() => ({ state: null as unknown, open: vi.fn() }));
vi.mock('../../games/gamesStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../games/gamesStore')>()),
  useGamesState: () => store.state as GamesState,
  gamesQueue: { open: store.open, status: () => (store.state as GamesState).queue },
}));

const IDLE: GamesState = {
  sync: 'idle', syncError: null, syncProgress: null, revision: 0,
  queue: { total: 1, analysed: 0, running: null, lastError: null },
};

function game(id: string, over: Partial<GameRecord> = {}): GameRecord {
  return {
    id, url: `https://www.chess.com/game/live/${id}`, endTime: Date.UTC(2026, 10, 10, 12), timeClass: 'rapid',
    timeControl: '600', userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 820,
    result: 'win', endReason: 'resigned', moves: [], ...over,
  };
}

const grades = (g: Partial<Record<Grade, number>>) =>
  ({ best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, ...g }) as Record<Grade, number>;

const side = (over: Partial<SideSummary> = {}): SideSummary => ({
  grades: grades({}), brilliant: 0, great: 0, accuracy: 70, kinds: {}, ...over,
});

function review(ply: number, kind?: MistakeKind): MoveReview {
  return { ply, move: 'e2e4', loss: 0.2, grade: kind ? 'mistake' : 'best', kind, best: [], deep: false };
}

const analysis = (gameId: string, white: SideSummary, black: SideSummary, moves: MoveReview[] = [], tookMs = 1000): GameAnalysis =>
  ({ gameId, rulesVersion: CONFIG.RULES_VERSION, analysedAt: 1, tookMs, scores: [{ cp: 0 }], moves, white, black });

const puzzle = (gameId: string, ply: number): GamePuzzle => ({
  id: `g:${gameId}:${ply}`, gameId, ply, endTime: 1, fen: 'x', moves: ['e2e4', 'e7e5'], kind: 'other', phrase: 'p', loss: 0.3,
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const summaryTree = (id = 'g1') => (
  <MemoryRouter initialEntries={['/games/' + id]}>
    <Routes>
      <Route path="/games/:gameId" element={<GameSummaryScreen />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>
);

function renderSummary(id = 'g1') {
  return render(summaryTree(id));
}

const running = (gameId: string, done: number, total: number): GamesState =>
  ({ ...IDLE, queue: { ...IDLE.queue, running: { gameId, done, total } } });

const cells = (label: string) =>
  within(screen.getByText(label).closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);

beforeEach(async () => {
  await db.delete();
  await db.open();
  store.state = IDLE;
  store.open.mockReset();
  store.open.mockReturnValue(new Promise(() => {}));
});

describe('GameSummaryScreen', () => {
  it('таблица берёт числа по цвету владельца (чёрными — из black), точность целым процентом', async () => {
    await putGames([game('g1', { userColor: 'black' })]);
    await saveAnalysis(analysis('g1',
      side({ grades: grades({ mistake: 1 }), accuracy: 50 }),
      side({ grades: grades({ mistake: 4 }), accuracy: 87.4 })), { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText('Ты — rival_one')).toBeTruthy();
    expect(cells('Ошибки')).toEqual(['4', '1']);
    expect(cells('Точность')).toEqual(['87%', '50%']);
  });

  it('«Блестящие» и «Сильные» скрыты, если у обеих сторон ноль', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side({ great: 2 })), { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText('Точность');
    expect(screen.queryByText('Блестящие')).toBeNull();
    expect(cells('Сильные')).toEqual(['0', '2']);
  });

  it('совет называет самый частый вид владельца; «other» и ходы соперника не считаются', async () => {
    await putGames([game('g1')]);
    // ply чётный — ход белых (владелец), нечётный — чёрных.
    const moves = [review(0, 'badTrade'), review(2, 'missedFork'), review(4, 'missedFork'), review(1, 'other'),
      review(3, 'missedMate'), review(5, 'missedMate'), review(6, 'other')];
    await saveAnalysis(analysis('g1', side(), side(), moves), { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText(/2 раза: Пропущена вилка\./)).toBeTruthy();
    expect(screen.getByText(/1 раз: Невыгодный размен\./)).toBeTruthy();
    expect(screen.queryByText(/Пропущен мат/)).toBeNull();
  });

  it('при равенстве счёта порядок — как виды впервые встретились; больше двух не показывается', async () => {
    await putGames([game('g1')]);
    const moves = [review(0, 'missedCapture'), review(2, 'badTrade'), review(4, 'missedFork')];
    await saveAnalysis(analysis('g1', side(), side(), moves), { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText(/1 раз: Пропущен захват\./);
    expect(screen.getByText(/1 раз: Невыгодный размен\./)).toBeTruthy();
    expect(screen.queryByText(/Пропущена вилка/)).toBeNull();
  });

  it('без подходящих ходов блока совета нет; время разбора — целые секунды', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side(), [review(0, 'other'), review(2)], 4600), { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText('Разбор занял 5 с')).toBeTruthy();
    expect(screen.queryByText('Совет')).toBeNull();
  });

  it('«Исправить ошибки» есть только при непустом списке задач', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    const first = renderSummary();
    await screen.findByRole('button', { name: 'Смотреть разбор' });
    expect(screen.queryByRole('button', { name: 'Исправить ошибки' })).toBeNull();
    first.unmount();
    await saveAnalysis(analysis('g1', side(), side()), { put: [puzzle('g1', 3)], removeIds: [] });
    renderSummary();
    fireEvent.click(await screen.findByRole('button', { name: 'Исправить ошибки' }));
    expect(screen.getByTestId('where').textContent).toBe('/games/g1/fix');
  });

  it('«Смотреть разбор» ведёт на разбор', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    renderSummary();
    fireEvent.click(await screen.findByRole('button', { name: 'Смотреть разбор' }));
    expect(screen.getByTestId('where').textContent).toBe('/games/g1/review');
  });

  it('без разбора вызван open и видна полоса', async () => {
    await putGames([game('g1')]);
    store.state = { ...IDLE, queue: { ...IDLE.queue, running: { gameId: 'g1', done: 1, total: 4 } } };
    renderSummary();
    expect(await screen.findByText('Разбираю партию…')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    await waitFor(() => expect(store.open).toHaveBeenCalledWith('g1'));
  });

  it('полоса берёт прогресс только своей партии: идёт другая — на нуле, идёт эта — её прогресс', async () => {
    await putGames([game('g1')]);
    store.state = running('other', 1, 2);
    const view = renderSummary();
    await screen.findByText('Разбираю партию…');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    store.state = running('g1', 1, 2);
    view.rerender(summaryTree());
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('«Разбираю партию…» звучит один раз: у полосы своё название', async () => {
    await putGames([game('g1')]);
    renderSummary();
    expect(await screen.findAllByText('Разбираю партию…')).toHaveLength(1);
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).not.toBe('Разбираю партию…');
  });

  it('open вернул null, текста сбоя в очереди нет: запасная фраза; чужой сбой позже её не меняет', async () => {
    await putGames([game('g1')]);
    store.open.mockResolvedValueOnce(null);
    const view = renderSummary();
    expect(await screen.findByText('Не удалось разобрать партию')).toBeTruthy();
    expect(screen.getByText('Попробуй ещё раз чуть позже')).toBeTruthy();
    // Очередь споткнулась на другой партии: общий lastError сменился.
    store.state = { ...IDLE, queue: { ...IDLE.queue, lastError: 'Движок не ответил' } };
    view.rerender(summaryTree());
    expect(screen.getByText('Попробуй ещё раз чуть позже')).toBeTruthy();
    expect(screen.queryByText('Движок не ответил')).toBeNull();
  });

  it('open вернул null: текст сбоя и «Повторить», повтор вызывает open снова', async () => {
    await putGames([game('g1')]);
    store.state = { ...IDLE, queue: { ...IDLE.queue, lastError: 'Движок не ответил' } };
    store.open.mockResolvedValueOnce(null);
    renderSummary();
    expect(await screen.findByText('Не удалось разобрать партию')).toBeTruthy();
    expect(screen.getByText('Движок не ответил')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(store.open).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Разбираю партию…')).toBeTruthy();
  });

  it('open вернул разбор: показывается сводка', async () => {
    await putGames([game('g1')]);
    store.open.mockResolvedValueOnce(analysis('g1', side({ accuracy: 90 }), side()));
    renderSummary();
    expect(await screen.findByText('90%')).toBeTruthy();
  });

  it('неизвестная партия: «Партия не найдена» и «К партиям»', async () => {
    renderSummary('nope');
    expect(await screen.findByText('Партия не найдена')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'К партиям' }));
    expect(screen.getByTestId('where').textContent).toBe('/games');
    expect(store.open).not.toHaveBeenCalled();
  });

  it('сбой чтения базы показывает свой текст и «К партиям»', async () => {
    await putGames([game('g1')]);
    vi.spyOn(db.games, 'get').mockRejectedValueOnce(new Error('база закрыта'));
    renderSummary();
    expect(await screen.findByText(/Не удалось открыть партию/)).toBeTruthy();
    expect(screen.getByText(/база закрыта/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'К партиям' }));
    expect(screen.getByTestId('where').textContent).toBe('/games');
  });
});
