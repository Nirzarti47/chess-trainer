import 'fake-indexeddb/auto';
import openingsRaw from '../../../public/openings.json?raw';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CONFIG } from '../../analysis/config';
import { resetOpeningBookCache } from '../../analysis/openings';
import { CATEGORY_TITLE } from '../../analysis/phrases';
import { CATEGORY_ORDER, reportOf } from '../../analysis/report';
import { db } from '../../data/db';
import { putGames, saveAnalysis } from '../../data/gamesRepo';
import type { GameAnalysis, GamePuzzle, GameRecord, Grade, MistakeKind, MoveReview, SideSummary } from '../../domain/gameTypes';
import type { GamesState } from '../../games/gamesStore';
import { GameSummaryScreen } from './GameSummaryScreen';

// Состояние и очередь подменяются; база настоящая. status() очереди отдаёт то же состояние, что и экран.
// Подмена reportOf нужна одному тесту: показать точность, которую настоящий разбор не даёт.
const reportSpy = vi.hoisted(() => ({ override: null as unknown }));
vi.mock('../../analysis/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analysis/report')>();
  return { ...actual, reportOf: (...a: Parameters<typeof actual.reportOf>) => reportSpy.override ?? actual.reportOf(...a) };
});

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
  const { pathname, search } = useLocation();
  return <><p data-testid="where">{pathname}</p><p data-testid="search">{search}</p></>;
}

const summaryTree = (id = 'g1', search = '') => (
  <MemoryRouter initialEntries={['/games/' + id + search]}>
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

/** Строка сводки по названию: [название, число левого столбца, число правого]; значок посередине не в счёт. */
const rowOf = (label: string) =>
  [...(screen.getByText(label).closest('.summary-row') as HTMLElement).children]
    .filter((c) => c.tagName.toLowerCase() !== 'svg').map((c) => c.textContent);

const titles = () => [...document.querySelectorAll('.summary-row .summary-row-title')].map((c) => c.textContent);

/** Ход с заданной потерей: 0 — «Лучший», 0.03 — «Хорошо», 0.3 — «Зевок» (не «Упущенная»: соперник до этого не ошибался). */
const mv = (ply: number, loss: number, grade: Grade): MoveReview =>
  ({ ply, move: 'e2e4', loss, grade, best: [], deep: false });
/** n ходов-заглушек: сводка их не играет, нужно только число (оценок на одну больше). */
const movesN = (n: number): string[] => Array.from({ length: n }, () => 'e2e4');
const flat = (n: number) => Array.from({ length: n + 1 }, () => ({ cp: 0 }));
const withScores = (a: GameAnalysis): GameAnalysis => ({ ...a, scores: flat(a.moves.length) });

beforeEach(async () => {
  await db.delete();
  await db.open();
  store.state = IDLE;
  store.open.mockReset();
  store.open.mockReturnValue(new Promise(() => {}));
  reportSpy.override = null;
  resetOpeningBookCache();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('нет сети')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetOpeningBookCache();
});

describe('GameSummaryScreen', () => {
  it('десять строк в порядке CATEGORY_ORDER, в том числе с нулями; числа по столбцам — из reportOf', async () => {
    await putGames([game('g1', { moves: movesN(5) })]);
    const a = withScores(analysis('g1', side(), side(), [
      mv(0, 0, 'best'), mv(1, 0, 'best'), mv(2, 0.03, 'good'), mv(3, 0.3, 'blunder'), mv(4, 0, 'best'),
    ]));
    await saveAnalysis(a, { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText('Точность');
    expect(titles()).toEqual(CATEGORY_ORDER.map((c) => CATEGORY_TITLE[c]));
    const report = reportOf(a, 0);
    for (const c of CATEGORY_ORDER) {
      expect(rowOf(CATEGORY_TITLE[c])).toEqual([CATEGORY_TITLE[c], String(report.white.counts[c]), String(report.black.counts[c])]);
    }
    expect(rowOf('Лучший')).toEqual(['Лучший', '2', '1']);
    expect(rowOf('Хорошо')).toEqual(['Хорошо', '1', '0']);
    expect(rowOf('Зевок')).toEqual(['Зевок', '0', '1']);
    expect(rowOf('Блестящий ход')).toEqual(['Блестящий ход', '0', '0']);
    // Значки в строках — украшение: название слева уже есть.
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(document.querySelectorAll('.summary-row svg[aria-hidden="true"]')).toHaveLength(10);
  });

  it('владелец чёрными: «Ты» над правым столбцом, его числа справа', async () => {
    await putGames([game('g1', { userColor: 'black', moves: movesN(2) })]);
    await saveAnalysis(withScores(analysis('g1', side(), side(), [mv(0, 0, 'best'), mv(1, 0.3, 'blunder')])),
      { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText('Ты — rival_one')).toBeTruthy();
    const names = [...document.querySelectorAll('.summary-name')].map((n) => n.textContent);
    expect(names).toEqual(['rival_one', 'Ты']);
    expect(rowOf('Зевок')).toEqual(['Зевок', '0', '1']);
    expect(rowOf('Лучший')).toEqual(['Лучший', '1', '0']);
    // Плашка белых — слева, чёрных — справа, независимо от того, кто владелец.
    const [left, right] = [...document.querySelectorAll('.summary-accuracy')];
    expect(left.classList.contains('summary-accuracy--white')).toBe(true);
    expect(right.classList.contains('summary-accuracy--black')).toBe(true);
  });

  it('владелец белыми: «Ты» над левым столбцом', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText('Точность');
    expect([...document.querySelectorAll('.summary-name')].map((n) => n.textContent)).toEqual(['Ты', 'rival_one']);
  });

  it('точность: 64.83 показана как 64.8; сторона без ходов — «—»', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    const zero = () => Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));
    reportSpy.override = {
      categories: [],
      white: { counts: zero(), accuracy: 64.83 },
      black: { counts: zero(), accuracy: null },
    };
    renderSummary();
    await screen.findByText('Точность');
    expect([...document.querySelectorAll('.summary-accuracy')].map((n) => n.textContent)).toEqual(['64.8', '—']);
  });

  it('партия без ходов: у обеих сторон «—»', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText('Точность');
    expect([...document.querySelectorAll('.summary-accuracy')].map((n) => n.textContent)).toEqual(['—', '—']);
  });

  it('книга не загрузилась: сводка показана, «Теоретический ход» 0', async () => {
    await putGames([game('g1', { moves: ['e2e4', 'e7e5'] })]);
    await saveAnalysis(withScores(analysis('g1', side(), side(), [mv(0, 0, 'best'), mv(1, 0, 'best')])),
      { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText('Точность');
    expect(rowOf('Теоретический ход')).toEqual(['Теоретический ход', '0', '0']);
    expect(rowOf('Лучший')).toEqual(['Лучший', '1', '1']);
  });

  it('книга загрузилась: начальные ходы партии — «Теоретический ход»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => JSON.parse(openingsRaw) }));
    await putGames([game('g1', { moves: ['e2e4', 'e7e5'] })]);
    await saveAnalysis(withScores(analysis('g1', side(), side(), [mv(0, 0, 'best'), mv(1, 0, 'best')])),
      { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText('Точность');
    expect(rowOf('Теоретический ход')).toEqual(['Теоретический ход', '1', '1']);
    expect(rowOf('Лучший')).toEqual(['Лучший', '0', '0']);
  });

  it('старых строк («Лучшие», «Грубые ошибки») нет', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText('Точность');
    expect(screen.queryByText('Грубые ошибки')).toBeNull();
    expect(screen.queryByText('Лучшие')).toBeNull();
  });

  it('совет называет самый частый вид владельца; «other» и ходы соперника не считаются', async () => {
    await putGames([game('g1', { moves: movesN(7) })]);
    // ply чётный — ход белых (владелец), нечётный — чёрных.
    const moves = [review(0, 'badTrade'), review(2, 'missedFork'), review(4, 'missedFork'), review(1, 'other'),
      review(3, 'missedMate'), review(5, 'missedMate'), review(6, 'other')];
    await saveAnalysis(withScores(analysis('g1', side(), side(), moves)), { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText(/2 раза: Пропущена вилка\./)).toBeTruthy();
    expect(screen.getByText(/1 раз: Невыгодный размен\./)).toBeTruthy();
    expect(screen.queryByText(/Пропущен мат/)).toBeNull();
  });

  it('при равенстве счёта порядок — как виды впервые встретились; больше двух не показывается', async () => {
    await putGames([game('g1', { moves: movesN(3) })]);
    const moves = [review(0, 'missedCapture'), review(2, 'badTrade'), review(4, 'missedFork')];
    await saveAnalysis(withScores(analysis('g1', side(), side(), moves)), { put: [], removeIds: [] });
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
    expect(screen.queryByRole('button', { name: /Исправить ошибки/ })).toBeNull();
    first.unmount();
    await saveAnalysis(analysis('g1', side(), side()), { put: [puzzle('g1', 3)], removeIds: [] });
    renderSummary();
    fireEvent.click(await screen.findByRole('button', { name: 'Исправить ошибки (1)' }));
    expect(screen.getByTestId('where').textContent).toBe('/games/g1/fix');
  });

  it('Л6: на кнопке число задач', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()),
      { put: [puzzle('g1', 3), puzzle('g1', 7)], removeIds: [] });
    renderSummary();
    expect(await screen.findByRole('button', { name: 'Исправить ошибки (2)' })).toBeTruthy();
    expect(screen.queryByText(/Задач из этой партии нет/)).toBeNull();
  });

  it('Л6: ошибки есть, а задач нет — вместо кнопки пояснение; без ошибок пояснения нет', async () => {
    await putGames([game('g1', { moves: movesN(1) })]);
    await saveAnalysis(withScores(analysis('g1', side(), side(), [mv(0, 0.3, 'blunder')])), { put: [], removeIds: [] });
    const first = renderSummary();
    expect(await screen.findByText(
      'Задач из этой партии нет: ни в одной ошибке не нашлось одного ясно лучшего хода')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Исправить ошибки/ })).toBeNull();
    first.unmount();
    await db.games.put(game('g1', { moves: movesN(2) }));
    await saveAnalysis(withScores(analysis('g1', side(), side(), [mv(0, 0, 'best'), mv(1, 0.3, 'blunder')])),
      { put: [], removeIds: [] });
    renderSummary();
    await screen.findByRole('button', { name: 'Смотреть разбор' });
    expect(screen.queryByText(/Задач из этой партии нет/)).toBeNull();
  });

  it('Л7: пока партия разбирается — только шапка, полоса и подпись, без строк сводки и пустого блока', async () => {
    await putGames([game('g1')]);
    const { container } = renderSummary();
    await screen.findByText('Разбираю партию…');
    expect(container.querySelector('.summary-rows')).toBeNull();
    const section = container.querySelector('section.summary') as HTMLElement;
    expect([...section.children].map((c) => c.tagName + (c.className ? '.' + c.className : ''))).toEqual(
      ['HEADER.summary-head', 'DIV.progress-bar', 'P.summary-note']);
  });

  it('«Смотреть разбор» ведёт на разбор', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    renderSummary();
    fireEvent.click(await screen.findByRole('button', { name: 'Смотреть разбор' }));
    expect(screen.getByTestId('where').textContent).toBe('/games/g1/review');
  });

  it('М6: сводка, открытая с ?ply=, ведёт в разбор с тем же ходом', async () => {
    await putGames([game('g1')]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    render(summaryTree('g1', '?ply=5'));
    fireEvent.click(await screen.findByRole('button', { name: 'Смотреть разбор' }));
    expect(screen.getByTestId('where').textContent).toBe('/games/g1/review');
    expect(screen.getByTestId('search').textContent).toBe('?ply=5');
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

  it('open вернул разбор: показывается сводка с точностью из оценок', async () => {
    await putGames([game('g1', { moves: movesN(2) })]);
    // Плоская партия из двух ходов без потерь: точность обеих сторон 100.
    store.open.mockResolvedValueOnce(withScores(analysis('g1', side({ accuracy: 90 }), side(),
      [mv(0, 0, 'best'), mv(1, 0, 'best')])));
    renderSummary();
    expect(await screen.findByText('Точность')).toBeTruthy();
    expect(titles()).toHaveLength(10);
    expect([...document.querySelectorAll('.summary-accuracy')].map((n) => n.textContent)).toEqual(['100.0', '100.0']);
  });

  it('оценок меньше, чем ходов в партии: свой текст про разбор и «К партиям»', async () => {
    await putGames([game('g1', { moves: ['e2e4', 'e7e5'] })]);
    await saveAnalysis(analysis('g1', side(), side()), { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText('Не удалось показать разбор этой партии')).toBeTruthy();
    expect(screen.queryByText('Не удалось открыть партию')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'К партиям' }));
    expect(screen.getByTestId('where').textContent).toBe('/games');
  });

  it('подсчёт отчёта бросает (битая оценка): тот же текст, без текста исключения', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await putGames([game('g1', { moves: ['e2e4'] })]);
    const a = analysis('g1', side(), side(), [mv(0, 0, 'best')]);
    await saveAnalysis({ ...a, scores: [{ cp: 0 }, null as never] }, { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText('Не удалось показать разбор этой партии')).toBeTruthy();
    expect(screen.queryByText(/Cannot read/)).toBeNull();
    expect(screen.getByRole('button', { name: 'К партиям' })).toBeTruthy();
  });

  it('лишние оценки: тот же текст про разбор, отчёта нет', async () => {
    await putGames([game('g1', { moves: ['e2e4'] })]);
    const a = analysis('g1', side(), side(), [mv(0, 0, 'best')]);
    await saveAnalysis({ ...a, scores: flat(3) }, { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText('Не удалось показать разбор этой партии')).toBeTruthy();
    expect(screen.queryByText('Точность')).toBeNull();
  });

  it('у разбора нет оценок: тот же текст, а не «TypeError»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await putGames([game('g1', { moves: ['e2e4'] })]);
    const a = analysis('g1', side(), side(), [mv(0, 0, 'best')]);
    await saveAnalysis({ ...a, scores: undefined as never }, { put: [], removeIds: [] });
    renderSummary();
    expect(await screen.findByText('Не удалось показать разбор этой партии')).toBeTruthy();
    expect(screen.queryByText(/TypeError/)).toBeNull();
    expect(screen.queryByText('Не удалось открыть партию')).toBeNull();
  });

  it('числа строки сводки читаются с именем столбца', async () => {
    await putGames([game('g1', { moves: movesN(3) })]);
    const a = withScores(analysis('g1', side(), side(), [mv(0, 0, 'best'), mv(1, 0, 'best'), mv(2, 0, 'best')]));
    await saveAnalysis(a, { put: [], removeIds: [] });
    renderSummary();
    await screen.findByText('Точность');
    const row = screen.getByText('Лучший').closest('.summary-row') as HTMLElement;
    expect(within(row).getByLabelText('Ты: 2').textContent).toBe('2');
    expect(within(row).getByLabelText('rival_one: 1').textContent).toBe('1');
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
