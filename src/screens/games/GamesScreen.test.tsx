import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CONFIG } from '../../analysis/config';
import { db } from '../../data/db';
import { getChessUser, putGames, saveAnalysis, setChessUser } from '../../data/gamesRepo';
import { ChessComError } from '../../chesscom/api';
import type { GameAnalysis, GameRecord, Grade, SideSummary } from '../../domain/gameTypes';
import type { GamesState } from '../../games/gamesStore';
import { GamesScreen } from './GamesScreen';

// Состояние загрузки подменяется; остальное в хранилище настоящее.
const store = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('../../games/gamesStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../games/gamesStore')>()),
  useGamesState: () => store.state as GamesState,
}));

const IDLE: GamesState = {
  sync: 'idle', syncError: null, syncProgress: null, revision: 0,
  queue: { total: 0, analysed: 0, running: null, lastError: null },
};

function game(id: string, over: Partial<GameRecord> = {}): GameRecord {
  return {
    id, url: `https://www.chess.com/game/live/${id}`, endTime: Date.UTC(2026, 10, 10, 12), timeClass: 'rapid',
    timeControl: '600', userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 820,
    result: 'win', endReason: 'resigned', moves: [], ...over,
  };
}

const side = (mistake: number, blunder: number): SideSummary => ({
  grades: { best: 0, good: 0, inaccuracy: 1, mistake, blunder } as Record<Grade, number>,
  brilliant: 0, great: 0, accuracy: 70, kinds: {},
});

const analysis = (gameId: string, white: SideSummary, black: SideSummary, rulesVersion = CONFIG.RULES_VERSION): GameAnalysis =>
  ({ gameId, rulesVersion, analysedAt: 1, tookMs: 1, scores: [{ cp: 0 }], moves: [], white, black });

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const sync = vi.fn(async () => {});
const fetchPlayer = vi.fn(async (_nick: string) => {});

function renderGames() {
  return render(
    <MemoryRouter initialEntries={['/games']}>
      <Routes>
        <Route path="/games" element={<GamesScreen fetchPlayer={fetchPlayer} sync={sync} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  store.state = IDLE;
  sync.mockClear();
  fetchPlayer.mockReset();
  fetchPlayer.mockResolvedValue(undefined);
});

describe('GamesScreen: ник', () => {
  it('без ника видна форма; ник нормализуется, сохраняется и запускает загрузку', async () => {
    renderGames();
    fireEvent.change(await screen.findByLabelText('Ник на Chess.com'), { target: { value: ' Nirzarti ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти партии' }));
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    expect(fetchPlayer).toHaveBeenCalledWith('nirzarti');
    expect(await getChessUser()).toEqual({ nick: 'nirzarti', loadedThrough: null });
    expect(await screen.findByRole('button', { name: 'Обновить' })).toBeTruthy();
  });

  it('«Игрок не найден»: ник не сохраняется', async () => {
    fetchPlayer.mockRejectedValue(new ChessComError('notFound', 'нет'));
    renderGames();
    fireEvent.change(await screen.findByLabelText('Ник на Chess.com'), { target: { value: 'nobody' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти партии' }));
    expect(await screen.findByText('Игрок не найден')).toBeTruthy();
    expect(await getChessUser()).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('без сети: подсказка проверить интернет', async () => {
    fetchPlayer.mockRejectedValue(new ChessComError('offline', 'нет сети'));
    renderGames();
    fireEvent.change(await screen.findByLabelText('Ник на Chess.com'), { target: { value: 'someone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти партии' }));
    expect(await screen.findByText('Нет сети. Проверь интернет и попробуй ещё раз')).toBeTruthy();
    expect(await getChessUser()).toBeNull();
  });
});

describe('GamesScreen: список', () => {
  beforeEach(async () => {
    await setChessUser({ nick: 'owner_test', loadedThrough: null });
    await putGames([
      game('old', { endTime: Date.UTC(2026, 9, 1, 12), opponent: 'rival_two', result: 'loss', timeClass: 'blitz' }),
      game('new', { endTime: Date.UTC(2026, 10, 12, 12), result: 'draw', timeClass: 'daily', userColor: 'black' }),
      game('mid', { endTime: Date.UTC(2026, 10, 5, 12) }),
    ]);
    await saveAnalysis(analysis('mid', side(9, 9), side(3, 1)), { put: [], removeIds: [] });
    await saveAnalysis(analysis('new', side(0, 0), side(2, 2)), { put: [], removeIds: [] });
    await saveAnalysis(analysis('old', side(7, 7), side(7, 7), 2 as never), { put: [], removeIds: [] });
  });

  it('три партии от новой к старой; число ошибок стороны владельца, старая версия разбора не считается', async () => {
    renderGames();
    const list = await screen.findByRole('list', { name: 'Партии' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Ничья');
    expect(rows[0].textContent).toContain('По переписке');
    expect(rows[0].textContent).toContain('Ошибок: 4');
    expect(rows[0].querySelector('[aria-label="Чёрные"]')).toBeTruthy();
    expect(rows[1].textContent).toContain('Победа');
    expect(rows[1].textContent).toContain('Ошибок: 18');
    expect(rows[1].textContent).toContain('05.11.2026');
    expect(rows[2].textContent).toContain('rival_two 820');
    expect(rows[2].textContent).toContain('Поражение');
    expect(rows[2].textContent).toContain('Блиц');
    expect(rows[2].textContent).not.toContain('Ошибок');
  });

  it('нажатие на строку открывает партию', async () => {
    renderGames();
    const rows = within(await screen.findByRole('list', { name: 'Партии' })).getAllByRole('listitem');
    fireEvent.click(within(rows[0]).getByRole('button'));
    expect((await screen.findByTestId('where')).textContent).toBe('/games/new');
  });

  it('состояние offline: строка о сети и список на месте', async () => {
    store.state = { ...IDLE, sync: 'offline', syncError: 'Нет сети, список не обновлён' };
    renderGames();
    expect(await screen.findByText('Нет сети, список не обновлён')).toBeTruthy();
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
  });

  it('строка состояния: число разобранных и разбор; «Обновить» вызывает sync', async () => {
    store.state = { ...IDLE, queue: { total: 94, analysed: 15, running: null, lastError: null } };
    const { unmount } = renderGames();
    expect(await screen.findByText('Разобрано 15 из 94')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(sync).toHaveBeenCalledTimes(1);
    unmount();

    store.state = { ...IDLE, queue: { total: 94, analysed: 15, running: { gameId: 'x', done: 1, total: 2 }, lastError: null } };
    renderGames();
    expect(await screen.findByText('Идёт разбор…')).toBeTruthy();
  });

  it('загрузка показывает ход; ошибка — текст и «Повторить»', async () => {
    store.state = { ...IDLE, sync: 'loading', syncProgress: { done: 3, total: 21 } };
    const { unmount } = renderGames();
    expect(await screen.findByText('Загружаю партии: 3 из 21')).toBeTruthy();
    unmount();

    store.state = { ...IDLE, sync: 'error', syncError: 'Chess.com ответил ошибкой: 500' };
    renderGames();
    expect(await screen.findByText('Chess.com ответил ошибкой: 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('ссылка «Частые ошибки» ведёт на /games/patterns', async () => {
    renderGames();
    fireEvent.click(await screen.findByRole('link', { name: /Частые ошибки/ }));
    expect((await screen.findByTestId('where')).textContent).toBe('/games/patterns');
  });
});

it('пустой список: «Партий пока нет»', async () => {
  await setChessUser({ nick: 'owner_test', loadedThrough: null });
  renderGames();
  expect(await screen.findByText('Партий пока нет')).toBeTruthy();
});
