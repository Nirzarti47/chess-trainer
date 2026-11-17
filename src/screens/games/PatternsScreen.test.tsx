import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CONFIG } from '../../analysis/config';
import { db } from '../../data/db';
import { getPatternRange, putGames, saveAnalysis, setPatternRange } from '../../data/gamesRepo';
import type { GameAnalysis, GameRecord, MistakeKind, MoveReview, SideSummary, TimeClass } from '../../domain/gameTypes';
import type { GamesState } from '../../games/gamesStore';
import { PatternsScreen } from './PatternsScreen';

// Состояние и очередь подменяются; база настоящая.
const store = vi.hoisted(() => ({ state: null as unknown, setRange: vi.fn() }));
vi.mock('../../games/gamesStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../games/gamesStore')>()),
  useGamesState: () => store.state as GamesState,
  gamesQueue: { setRange: store.setRange },
}));

const IDLE: GamesState = {
  sync: 'idle', syncError: null, syncProgress: null, revision: 0,
  queue: { total: 0, analysed: 0, running: null, lastError: null },
};

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function game(id: string, daysAgo: number, timeClass: TimeClass = 'rapid'): GameRecord {
  return {
    id, url: `https://www.chess.com/game/live/${id}`, endTime: now - daysAgo * DAY, timeClass, timeControl: '600',
    userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 820, result: 'loss',
    endReason: 'resigned', moves: [],
  };
}

const side: SideSummary = {
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 70, kinds: {},
};

/** Разбор: у владельца (белые) ошибки перечисленных видов на ходах 0, 2, 4…; у соперника — грубая на ходе 1. */
const analysis = (gameId: string, kinds: MistakeKind[]): GameAnalysis => ({
  gameId, rulesVersion: CONFIG.RULES_VERSION, analysedAt: 1, tookMs: 1, scores: [], white: side, black: side,
  moves: [
    ...kinds.map((kind, i): MoveReview => ({ ply: i * 2, move: 'e2e4', loss: 0.3, grade: 'mistake', kind, best: [], deep: false })),
    { ply: 1, move: 'e7e5', loss: 0.5, grade: 'blunder', kind: 'missedCapture', best: [], deep: false },
  ],
});

const save = (a: GameAnalysis) => saveAnalysis(a, { put: [], removeIds: [] });

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderPatterns() {
  return render(
    <MemoryRouter initialEntries={['/games/patterns']}>
      <Routes>
        <Route path="/games/patterns" element={<PatternsScreen />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const rows = () => within(screen.getByRole('list', { name: 'Виды ошибок' })).getAllByRole('listitem')
  .map((li) => li.textContent);

beforeEach(async () => {
  await db.delete();
  await db.open();
  store.state = IDLE;
  store.setRange.mockClear();
});

describe('PatternsScreen', () => {
  beforeEach(async () => {
    // Пять рапидов за месяц (разобраны g1 и g3), один рапид старше месяца, блиц не считается.
    await putGames([game('g1', 1), game('g2', 2), game('g3', 3), game('g4', 4), game('g5', 5, 'daily'),
      game('g6', 40), game('fast', 1, 'blitz')]);
    await save(analysis('g1', ['pieceEnPrise', 'pieceEnPrise', 'missedMate', 'other']));
    await save(analysis('g3', ['pieceEnPrise', 'other', 'missedFork']));
    await save({ ...analysis('g4', ['badTrade']), rulesVersion: CONFIG.RULES_VERSION + 1 });
    await save(analysis('fast', ['missedMate']));
  });

  it('по умолчанию «Последние 20»; две подписанные группы; партии промежутка и очередь', async () => {
    renderPatterns();
    expect(await screen.findByText('Партий: 6, разобрано: 2 — считаю дальше')).toBeTruthy();
    expect(pressed('Последние 20')).toBe('true');
    expect(pressed('За месяц')).toBe('false');
    expect(within(screen.getByRole('group', { name: 'По числу партий' })).getAllByRole('button')).toHaveLength(3);
    expect(within(screen.getByRole('group', { name: 'По времени' })).getAllByRole('button')).toHaveLength(4);
    // Устаревший разбор g4 считается отсутствующим.
    await waitFor(() => expect(store.setRange).toHaveBeenLastCalledWith(['g2', 'g4', 'g5', 'g6']));
  });

  it('выбор «За месяц» сохраняется и ставит в очередь неразобранные партии месяца', async () => {
    renderPatterns();
    await screen.findByText('Партий: 6, разобрано: 2 — считаю дальше');
    fireEvent.click(screen.getByRole('button', { name: 'За месяц' }));
    expect(await screen.findByText('Партий: 5, разобрано: 2 — считаю дальше')).toBeTruthy();
    expect(pressed('За месяц')).toBe('true');
    expect(pressed('Последние 20')).toBe('false');
    expect(screen.getByText('Партий: 5, разобрано: 2 — считаю дальше')).toBeTruthy();
    expect(store.setRange).toHaveBeenLastCalledWith(['g2', 'g4', 'g5']);
    await waitFor(async () => expect(await getPatternRange()).toEqual({ by: 'time', span: 'month' }));
  });

  it('две разобранные партии: «Мало партий, выводы неточные»; виды по убыванию с числами', async () => {
    renderPatterns();
    expect(await screen.findByText('Мало партий, выводы неточные')).toBeTruthy();
    expect(rows()).toEqual(['Фигура поставлена под бой3', 'Пропущен мат1', 'Пропущена вилка1', 'Другое2']);
  });

  it('Л9: «Другое» последней строкой, даже если его больше всех', async () => {
    await db.delete();
    await db.open();
    await putGames([game('o1', 1)]);
    await save(analysis('o1', ['other', 'other', 'other', 'pieceEnPrise']));
    renderPatterns();
    await screen.findByRole('list', { name: 'Виды ошибок' });
    expect(rows()).toEqual(['Фигура поставлена под бой1', 'Другое3']);
  });

  it('Л9: все разобраны — в строке состояния нет «считаю дальше»; одна строка вместо двух', async () => {
    await db.delete();
    await db.open();
    await putGames([game('o1', 1)]);
    await save(analysis('o1', ['other']));
    renderPatterns();
    expect(await screen.findByText('Партий: 1, разобрано: 1')).toBeTruthy();
    expect(screen.queryByText(/считаю дальше/)).toBeNull();
  });

  it('Л9: партии есть, разборов нет — «Тренировать» выключена', async () => {
    await db.delete();
    await db.open();
    await putGames([game('o1', 1), game('o2', 2)]);
    renderPatterns();
    expect(await screen.findByText('Партий: 2, разобрано: 0 — считаю дальше')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Тренировать' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('«Тренировать» ведёт на /games/patterns/train; ссылка назад — к партиям', async () => {
    renderPatterns();
    await screen.findByText('Партий: 6, разобрано: 2 — считаю дальше');
    fireEvent.click(screen.getByRole('button', { name: 'Тренировать' }));
    expect(screen.getByTestId('where').textContent).toBe('/games/patterns/train');
  });

  const rerenderTree = (
    <MemoryRouter initialEntries={['/games/patterns']}>
      <Routes><Route path="/games/patterns" element={<PatternsScreen />} /></Routes>
    </MemoryRouter>
  );

  it('новый разбор (рост revision) перечитывает данные; setRange получает укороченный список', async () => {
    const { rerender } = renderPatterns();
    await screen.findByText('Партий: 6, разобрано: 2 — считаю дальше');
    await waitFor(() => expect(store.setRange).toHaveBeenLastCalledWith(['g2', 'g4', 'g5', 'g6']));
    await save(analysis('g2', ['missedMate']));
    store.state = { ...IDLE, revision: 1 };
    rerender(rerenderTree);
    expect(await screen.findByText('Партий: 6, разобрано: 3 — считаю дальше')).toBeTruthy();
    expect(store.setRange).toHaveBeenLastCalledWith(['g4', 'g5', 'g6']);
  });

  it('повторный показ без смены набора неразобранных партий setRange снова не вызывает', async () => {
    const { rerender } = renderPatterns();
    await screen.findByText('Партий: 6, разобрано: 2 — считаю дальше');
    await waitFor(() => expect(store.setRange).toHaveBeenCalledTimes(1));
    // Разбор уже разобранной g1 сменился: данные перечитаны, а набор неразобранных тот же.
    await save(analysis('g1', ['missedMate', 'missedMate', 'missedMate', 'missedMate', 'missedMate']));
    store.state = { ...IDLE, revision: 1 };
    rerender(rerenderTree);
    await waitFor(() => expect(rows()).toContain('Пропущен мат5'));
    expect(store.setRange).toHaveBeenCalledTimes(1);
  });
});

describe('PatternsScreen: пустые случаи и сбой', () => {
  it('ноль партий в промежутке: строка, «За этот промежуток партий нет», «Тренировать» выключена', async () => {
    await putGames([game('old', 20)]);
    await setPatternRange({ by: 'time', span: 'week' });
    renderPatterns();
    expect(await screen.findByText('Партий: 0, разобрано: 0')).toBeTruthy();
    expect(screen.getByText('За этот промежуток партий нет')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Виды ошибок' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Тренировать' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('разобранные партии без ошибок владельца: «Ошибок не найдено»; всё разобрано — setRange([])', async () => {
    await putGames([game('g1', 1)]);
    await save(analysis('g1', []));
    renderPatterns();
    expect(await screen.findByText('Ошибок не найдено')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Тренировать' }) as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(store.setRange).toHaveBeenCalledWith([]));
    expect(store.setRange).toHaveBeenCalledTimes(1);
  });

  it('сбой чтения базы: свой текст и «Повторить»', async () => {
    db.close();
    renderPatterns();
    expect(await screen.findByText('Не удалось посчитать ошибки')).toBeTruthy();
    expect(screen.getByText(/DatabaseClosedError/)).toBeTruthy();
    await act(async () => {
      await db.open();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Партий: 0, разобрано: 0')).toBeTruthy();
  });
});
