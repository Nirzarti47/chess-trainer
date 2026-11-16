import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { db } from '../data/db';
import { getProfile, loadActiveLesson } from '../data/repo';
import { localDay } from '../domain/dates';
import type { LessonTask, Puzzle, Source } from '../domain/types';
import type { BoardProps } from '../ui/Board';
import { LessonNotFoundError } from './lessonErrors';
import { LessonScreen, RepeatLessonScreen } from './LessonScreen';
import { TaskRunner } from './TaskRunner';

// Настоящая доска проверена в Board.test.tsx; здесь поддельная: запоминает свойства и даёт сделать ход.
const board = vi.hoisted(() => ({ props: null as BoardProps | null }));
vi.mock('../ui/Board', async () => {
  const { createElement } = await import('react');
  return {
    Board: (p: BoardProps) => {
      board.props = p;
      return createElement('div', { 'data-testid': 'board' });
    },
  };
});

// Экраны без свойства bestReply (RepeatLessonScreen) берут движок по умолчанию: в тестах он не нужен.
vi.mock('../engine/engine', () => ({ bestReply: vi.fn(async () => null), warmUp: vi.fn(async () => true) }));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function fenAfter(fen: string, ...moves: string[]): string {
  const chess = new Chess(fen);
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4) });
  return chess.fen();
}

/** Задача в один ход за чёрных: соперник играет первый ход, решение — второй. */
const pz = (id: string, moves = ['e2e4', 'e7e5']): LessonTask => ({
  kind: 'puzzle',
  puzzle: { id, fen: START, moves, rating: 600, themes: ['fork'] } satisfies Puzzle,
});

const choice = (): LessonTask => ({
  kind: 'choice',
  q: { prompt: 'Что на доске?', options: ['Мат', 'Пат'], correct: 0, explain: 'Королю некуда уйти от шаха' },
});

function lesson(tasks: LessonTask[], source: Source = 'lesson') {
  return vi.fn(async (_nodeId: string, _lessonIndex: number) => ({ title: 'Вилка', source, tasks }));
}

/** Переход на другой адрес без выхода из экрана урока. */
function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>Перейти</button>;
}

function renderLesson(opts: {
  factory: ReturnType<typeof lesson>;
  engine?: (fen: string) => Promise<string | null>;
  warmUp?: () => Promise<boolean>;
  path?: string;
  goTo?: string;
}) {
  const engine = opts.engine ?? vi.fn(async () => null);
  const warmUp = opts.warmUp ?? vi.fn(async () => true);
  return render(
    <MemoryRouter initialEntries={[opts.path ?? '/lesson/c1:fork/0']}>
      {opts.goTo && <GoTo to={opts.goTo} />}
      <Routes>
        <Route
          path="/lesson/:nodeId/:lessonIndex"
          element={<LessonScreen factory={opts.factory} bestReply={engine} warmUp={warmUp} />}
        />
        <Route path="/learn" element={<h1>Учёба</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitInteractive(fen?: string) {
  await waitFor(() => {
    expect(board.props?.interactive).toBe(true);
    if (fen) expect(board.props?.fen).toBe(fen);
  });
}

function move(uci: string) {
  const p = board.props!;
  expect(p.interactive).toBe(true);
  act(() => {
    p.onMove(uci);
  });
}

const click = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }));

/** Решает текущую задачу верным ходом и переходит к следующей. */
async function solve(uci: string, fen?: string) {
  await waitInteractive(fen);
  move(uci);
  await screen.findByText('Верно');
  await click('Дальше');
}

const attempts = async () =>
  (await db.attempts.toArray()).map(({ puzzleId, result, rated, source }) => ({ puzzleId, result, rated, source }));

const P1 = fenAfter(START, 'e2e4');
const P2_MOVES = ['d2d4', 'd7d5'];
const P2 = fenAfter(START, 'd2d4');

beforeEach(async () => {
  await db.delete();
  await db.open();
  board.props = null;
});

describe('LessonScreen', () => {
  it('прогревает движок при открытии', async () => {
    const warmUp = vi.fn(async () => true);
    renderLesson({ factory: lesson([pz('p1')]), warmUp });
    await waitInteractive(P1);
    expect(warmUp).toHaveBeenCalledTimes(1);
  });

  it('три задачи решены верно: урок записан как 3 из 3, показан итог', async () => {
    renderLesson({ factory: lesson([pz('p1'), pz('p2', P2_MOVES), pz('p3')]) });
    expect(await screen.findByText('Ход чёрных')).toBeTruthy();
    expect(board.props?.orientation).toBe('black');
    await solve('e7e5', P1);
    await solve('d7d5', P2);
    await solve('e7e5', P1);

    expect(await screen.findByText('Решено с первого раза: 3 из 3')).toBeTruthy();
    expect(screen.getByText('Опыт: +50')).toBeTruthy();
    await waitFor(async () =>
      expect(await db.lessons.toArray()).toEqual([{ nodeId: 'c1:fork', lessonIndex: 0, clean: 3, total: 3 }]));
    await waitFor(async () => expect(await loadActiveLesson()).toBeNull());
    expect(await attempts()).toEqual([
      { puzzleId: 'p1', result: 'clean', rated: true, source: 'lesson' },
      { puzzleId: 'p2', result: 'clean', rated: true, source: 'lesson' },
      { puzzleId: 'p3', result: 'clean', rated: true, source: 'lesson' },
    ]);

    await click('Готово');
    expect(await screen.findByRole('heading', { name: 'Учёба' })).toBeTruthy();
  });

  it('ошибка во второй задаче: она возвращается после третьей, возврат не записывается', async () => {
    renderLesson({ factory: lesson([pz('p1'), pz('p2', P2_MOVES), pz('p3')]) });
    await solve('e7e5', P1);

    await waitInteractive(P2);
    move('a7a6');
    expect(await screen.findByText('Не тот ход')).toBeTruthy();
    await solve('d7d5', P2);
    await solve('e7e5', P1);

    expect(await screen.findByText('4 из 4')).toBeTruthy();
    await solve('d7d5', P2);

    expect(await screen.findByText('Решено с первого раза: 2 из 3')).toBeTruthy();
    expect(screen.getByText('Опыт: +45')).toBeTruthy();
    await waitFor(async () => expect(await db.lessons.count()).toBe(1));
    expect(await attempts()).toEqual([
      { puzzleId: 'p1', result: 'clean', rated: true, source: 'lesson' },
      { puzzleId: 'p2', result: 'mistake', rated: true, source: 'lesson' },
      { puzzleId: 'p3', result: 'clean', rated: true, source: 'lesson' },
    ]);
  });

  it('ошибка и чистый повтор в конце урока: повторение завтра на ступени 0, опыт за задачу 5', async () => {
    renderLesson({ factory: lesson([pz('p1')]) });
    await waitInteractive(P1);
    move('a7a6');
    await solve('e7e5', P1);
    await solve('e7e5', P1);

    expect(await screen.findByText('Решено с первого раза: 0 из 1')).toBeTruthy();
    expect(screen.getByText('Опыт: +25')).toBeTruthy();
    await waitFor(async () => expect(await loadActiveLesson()).toBeNull());
    const [review] = await db.reviews.toArray();
    expect(review.stage).toBe(0);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(review.dueDay).toBe(localDay(tomorrow));
    expect((await getProfile()).xp).toBe(25);
    expect((await attempts()).map((a) => a.result)).toEqual(['mistake']);
  });

  it('задача, которая уже встречалась, и задачи закрепления не идут в рейтинг', async () => {
    await db.attempts.add({ puzzleId: 'p1', themes: ['fork'], result: 'clean', source: 'free', rated: true, at: 1 });
    renderLesson({ factory: lesson([pz('p1'), pz('p2')], 'review') });
    await solve('e7e5', P1);
    await solve('e7e5', P1);
    await screen.findByText('Решено с первого раза: 2 из 2');
    await waitFor(async () => expect(await db.lessons.count()).toBe(1));
    expect((await attempts()).slice(1).map((a) => a.rated)).toEqual([false, false]);
  });

  it('первая ошибка: неверный ход и ответ соперника стрелкой, потом позиция возвращается', async () => {
    const engine = vi.fn(async (_fen: string) => 'g1f3');
    renderLesson({ factory: lesson([pz('p1')]), engine });
    await waitInteractive(P1);
    move('a7a6');

    expect(await screen.findByText('Не тот ход. Соперник ответит так')).toBeTruthy();
    expect(engine).toHaveBeenCalledWith(fenAfter(P1, 'a7a6'));
    expect(board.props?.fen).toBe(fenAfter(P1, 'a7a6'));
    expect(board.props?.arrows).toEqual([['g1', 'f3']]);
    expect(board.props?.interactive).toBe(false);

    await waitFor(() => expect(board.props?.fen).toBe(P1), { timeout: 2500 });
    expect(board.props?.arrows).toEqual([]);
    expect(board.props?.interactive).toBe(true);
    expect(screen.getByText('Не тот ход')).toBeTruthy();
  });

  it('две ошибки подряд показывают «Показать решение», решение проигрывается', async () => {
    renderLesson({ factory: lesson([pz('p1')]) });
    await waitInteractive(P1);
    move('a7a6');
    await waitInteractive(P1);
    move('a7a6');

    await click('Показать решение');
    expect(screen.queryByRole('button', { name: 'Подсказка' })).toBeNull();
    await screen.findByRole('button', { name: 'Дальше' });
    expect(board.props?.fen).toBe(fenAfter(P1, 'e7e5'));
    expect(board.props?.interactive).toBe(false);
    await click('Дальше');

    // Задача с ошибкой возвращается в конце урока.
    await solve('e7e5', P1);
    expect(await screen.findByText('Решено с первого раза: 0 из 1')).toBeTruthy();
    await waitFor(async () => expect(await db.lessons.count()).toBe(1));
    expect((await attempts()).map((a) => a.result)).toEqual(['mistake']);
  });

  it('подсказка: сначала клетка фигуры, потом ход стрелкой; результат — hint', async () => {
    renderLesson({ factory: lesson([pz('p1')]) });
    await waitInteractive(P1);
    await click('Подсказка');
    expect(board.props?.highlight).toEqual(['e7']);
    await click('Подсказка');
    expect(board.props?.arrows).toEqual([['e7', 'e5']]);
    await solve('e7e5');
    await solve('e7e5', P1);
    await screen.findByText('Решено с первого раза: 0 из 1');
    await waitFor(async () => expect(await db.lessons.count()).toBe(1));
    expect((await attempts()).map((a) => a.result)).toEqual(['hint']);
  });

  it('закрытие и повторное открытие продолжает урок с того же задания', async () => {
    const first = lesson([pz('p1'), pz('p2', P2_MOVES), pz('p3')]);
    const view = renderLesson({ factory: first });
    await solve('e7e5', P1);
    await waitInteractive(P2);
    await waitFor(async () => expect((await loadActiveLesson())?.cursor).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Выйти из урока' }));
    expect(screen.getByText('Выйти? Урок продолжится с этого места')).toBeTruthy();
    await click('Остаться');
    expect(screen.queryByText('Выйти? Урок продолжится с этого места')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из урока' }));
    await click('Выйти');
    expect(await screen.findByRole('heading', { name: 'Учёба' })).toBeTruthy();
    view.unmount();
    board.props = null;

    const second = lesson([pz('x1'), pz('x2')]);
    renderLesson({ factory: second });
    await waitInteractive(P2);
    expect(screen.getByText('2 из 3')).toBeTruthy();
    expect(screen.getByText('Вилка')).toBeTruthy();
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith('c1:fork', 0);

    await solve('d7d5', P2);
    await solve('e7e5', P1);
    expect(await screen.findByText('Решено с первого раза: 3 из 3')).toBeTruthy();
    await waitFor(async () => expect(await loadActiveLesson()).toBeNull());
    expect((await attempts()).map((a) => a.puzzleId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('сохранённый урок другого узла не продолжается: начинается новый', async () => {
    await db.kv.put({ key: 'activeLesson', value: {
      nodeId: 'c1:pin', lessonIndex: 0, tasks: [pz('old', P2_MOVES)], cursor: 0, results: [], retry: [],
      title: 'Связка', source: 'lesson' } });
    const factory = lesson([pz('p1')]);
    renderLesson({ factory });
    await waitInteractive(P1);
    expect(factory).toHaveBeenCalledTimes(1);
    await waitFor(async () => expect((await loadActiveLesson())?.nodeId).toBe('c1:fork'));
  });

  it('choice: верный ответ даёт clean, объяснение видно', async () => {
    renderLesson({ factory: lesson([choice()]) });
    await click('Мат');
    expect(screen.getByText('Верно')).toBeTruthy();
    expect(screen.getByText('Королю некуда уйти от шаха')).toBeTruthy();
    await click('Дальше');
    expect(await screen.findByText('Решено с первого раза: 1 из 1')).toBeTruthy();
    await waitFor(async () => expect(await db.lessons.count()).toBe(1));
    expect(await attempts()).toEqual([{ puzzleId: undefined, result: 'clean', rated: false, source: 'lesson' }]);
  });

  it('choice: неверный ответ даёт mistake, объяснение видно, вопрос возвращается', async () => {
    renderLesson({ factory: lesson([choice()]) });
    await click('Пат');
    expect(screen.getByText('Неверно')).toBeTruthy();
    expect(screen.getByText('Королю некуда уйти от шаха')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Мат' })).toHaveProperty('disabled', true);
    await click('Дальше');
    await click('Мат');
    await click('Дальше');
    expect(await screen.findByText('Решено с первого раза: 0 из 1')).toBeTruthy();
    await waitFor(async () => expect(await db.lessons.count()).toBe(1));
    expect((await attempts()).map((a) => a.result)).toEqual(['mistake']);
  });

  it('authored: неверный ход — mistake без рейтинга и объяснение', async () => {
    const task: LessonTask = { kind: 'authored',
      task: { fen: START, prompt: 'Займи центр', accept: ['e2e4', 'd2d4'], explain: 'Пешки в центре дают простор' } };
    renderLesson({ factory: lesson([task]) });
    expect(await screen.findByText('Займи центр')).toBeTruthy();
    expect(screen.getByText('Ход белых')).toBeTruthy();
    await waitInteractive(START);
    move('a2a3');
    expect(await screen.findByText('Не тот ход')).toBeTruthy();
    expect(screen.getByText('Пешки в центре дают простор')).toBeTruthy();
    expect(board.props?.interactive).toBe(false);
    await click('Дальше');
    await waitInteractive(START);
    move('d2d4');
    expect(await screen.findByText('Верно')).toBeTruthy();
    await click('Дальше');
    await screen.findByText('Решено с первого раза: 0 из 1');
    await waitFor(async () => expect(await db.lessons.count()).toBe(1));
    expect(await attempts()).toEqual([
      { puzzleId: undefined, result: 'mistake', rated: false, source: 'lesson' },
    ]);
  });

  it('explain: ждёт заданный ход, в итог и статистику не идёт', async () => {
    const step: LessonTask = { kind: 'explain', step: { fen: START, text: 'Сыграй e4', move: 'e2e4' } };
    renderLesson({ factory: lesson([step, pz('p1')]) });
    expect(await screen.findByText('Сыграй e4')).toBeTruthy();
    await waitInteractive(START);
    move('d2d4');
    expect(screen.queryByRole('button', { name: 'Дальше' })).toBeNull();
    expect(board.props?.fen).toBe(START);
    move('e2e4');
    await click('Дальше');
    await solve('e7e5', P1);
    expect(await screen.findByText('Решено с первого раза: 1 из 1')).toBeTruthy();
    await waitFor(async () => expect(await db.lessons.count()).toBe(1));
    expect(await db.attempts.count()).toBe(1);
  });

  it('explain: после неверного хода нужный ход показан стрелкой, «Показать ход» играет его', async () => {
    const step: LessonTask = { kind: 'explain', step: { fen: START, text: 'Сыграй e4', move: 'e2e4',
      arrows: [['d2', 'd4']] } };
    renderLesson({ factory: lesson([step]) });
    await waitInteractive(START);
    expect(screen.queryByRole('button', { name: 'Показать ход' })).toBeNull();
    move('d2d4');
    expect(await screen.findByRole('button', { name: 'Показать ход' })).toBeTruthy();
    expect(board.props?.arrows).toEqual([['e2', 'e4']]);
    expect(board.props?.fen).toBe(START);
    // Верный ход по-прежнему можно сделать самому.
    expect(board.props?.interactive).toBe(true);

    await click('Показать ход');
    expect(board.props?.fen).toBe(fenAfter(START, 'e2e4'));
    expect(board.props?.interactive).toBe(false);
    expect(screen.queryByRole('button', { name: 'Показать ход' })).toBeNull();
    await click('Дальше');
    expect(await screen.findByText('Урок пройден')).toBeTruthy();
  });

  it('итог урока без задач не показывает строку «Решено с первого раза»', async () => {
    renderLesson({ factory: lesson([{ kind: 'explain', step: { fen: START, text: 'Просто прочитай' } }]) });
    await click('Дальше');
    expect(await screen.findByText('Урок пройден')).toBeTruthy();
    expect(screen.queryByText(/Решено с первого раза/)).toBeNull();
    expect(screen.getByText('Опыт: +20')).toBeTruthy();
  });

  it('контрольная с долей ниже 0,60: совет заглянуть в «Слабые места»', async () => {
    renderLesson({ factory: lesson([pz('p1'), pz('p2', P2_MOVES)], 'exam'), path: '/lesson/c1:exam/0' });
    await solve('e7e5', P1);
    await waitInteractive(P2);
    move('a7a6');
    await solve('d7d5', P2);
    await solve('d7d5', P2);
    // 1 из 2 — ровно 0,5.
    expect(await screen.findByText('Решено с первого раза: 1 из 2')).toBeTruthy();
    expect(screen.getByText('Стоит заглянуть в „Слабые места“')).toBeTruthy();
  });

  it('контрольная с долей не ниже 0,60 и обычный урок с ошибками — без совета', async () => {
    const view = renderLesson({ factory: lesson([pz('p1')], 'exam'), path: '/lesson/c1:exam/0' });
    await solve('e7e5', P1);
    expect(await screen.findByText('Решено с первого раза: 1 из 1')).toBeTruthy();
    expect(screen.queryByText('Стоит заглянуть в „Слабые места“')).toBeNull();
    await waitFor(async () => expect(await loadActiveLesson()).toBeNull());
    view.unmount();

    renderLesson({ factory: lesson([pz('p1')]) });
    await waitInteractive(P1);
    move('a7a6');
    await solve('e7e5', P1);
    await solve('e7e5', P1);
    expect(await screen.findByText('Решено с первого раза: 0 из 1')).toBeTruthy();
    expect(screen.queryByText('Стоит заглянуть в „Слабые места“')).toBeNull();
  });

  it('смена адреса, а новый урок не загрузился: прежний урок не сохраняется под новым адресом', async () => {
    const factory = vi.fn(async (nodeId: string, _lessonIndex: number) => {
      if (nodeId !== 'c1:fork') throw new LessonNotFoundError();
      return { title: 'Вилка', source: 'lesson' as Source, tasks: [pz('p1'), pz('p2', P2_MOVES)] };
    });
    renderLesson({ factory, goTo: '/lesson/c1:pin/0' });
    await solve('e7e5', P1);
    await waitInteractive(P2);
    await waitFor(async () => expect((await loadActiveLesson())?.cursor).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Перейти' }));
    expect(await screen.findByText('Урок не найден')).toBeTruthy();
    await waitFor(() => expect(factory).toHaveBeenLastCalledWith('c1:pin', 0));
    const saved = await loadActiveLesson();
    expect(saved?.nodeId).not.toBe('c1:pin');
    expect(saved).toMatchObject({ nodeId: 'c1:fork', lessonIndex: 0, cursor: 1 });
  });

  it('смена адреса посреди урока: новый урок начинается с первого задания, состояние не переносится', async () => {
    const factory = vi.fn(async (nodeId: string, _lessonIndex: number) => nodeId === 'c1:fork'
      ? { title: 'Вилка', source: 'lesson' as Source, tasks: [pz('p1'), pz('p2', P2_MOVES)] }
      : { title: 'Связка', source: 'lesson' as Source, tasks: [pz('q1', P2_MOVES), pz('q2')] });
    renderLesson({ factory, goTo: '/lesson/c1:pin/0' });
    await solve('e7e5', P1);
    await waitInteractive(P2);
    expect(screen.getByText('2 из 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Перейти' }));
    await waitFor(() => expect(screen.getByText('Связка')).toBeTruthy());
    expect(factory).toHaveBeenLastCalledWith('c1:pin', 0);
    expect(screen.getByText('1 из 2')).toBeTruthy();
    await waitInteractive(P2);
    await solve('d7d5', P2);
    await solve('e7e5', P1);
    expect(await screen.findByText('Решено с первого раза: 2 из 2')).toBeTruthy();
    await waitFor(async () => expect(await db.lessons.get(['c1:pin', 0])).toEqual(
      { nodeId: 'c1:pin', lessonIndex: 0, clean: 2, total: 2 }));
  });

  it('сбой загрузки урока: текст ошибки на экране и «Повторить»', async () => {
    let calls = 0;
    const factory = vi.fn(async (_nodeId: string, _lessonIndex: number) => {
      calls += 1;
      if (calls === 1) throw new TypeError('Load failed');
      return { title: 'Вилка', source: 'lesson' as Source, tasks: [pz('p1')] };
    });
    renderLesson({ factory });
    expect(await screen.findByRole('heading', { name: 'Не удалось открыть урок' })).toBeTruthy();
    expect(screen.getByText('TypeError: Load failed')).toBeTruthy();
    expect(screen.queryByText('Урок не найден')).toBeNull();
    await click('Повторить');
    await waitInteractive(P1);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('неизвестный урок: «Урок не найден» и кнопка назад', async () => {
    const factory = vi.fn(async () => { throw new LessonNotFoundError(); });
    renderLesson({ factory: factory as unknown as ReturnType<typeof lesson> });
    expect(await screen.findByText('Урок не найден')).toBeTruthy();
    await click('К урокам');
    expect(await screen.findByRole('heading', { name: 'Учёба' })).toBeTruthy();
  });
});

const PHRASE = 'Фигура осталась без защиты';

/** Задача из партии x: ход 5, тот же образец, что pz. */
const gamePz = (ply = 5, moves = ['e2e4', 'e7e5']): LessonTask => ({
  kind: 'puzzle',
  puzzle: { id: `g:x:${ply}`, fen: START, moves, rating: 0, themes: ['hangingPiece'],
    game: { gameId: 'x', ply, phrase: PHRASE } },
});

function renderGameLesson(factory: ReturnType<typeof lesson>) {
  return render(
    <MemoryRouter initialEntries={['/games/x/fix']}>
      <Routes>
        <Route path="/games/x/fix" element={
          <LessonScreen nodeId="game:x" lessonIndex={0} exitTo="/games/x" factory={factory}
            bestReply={vi.fn(async () => null)} warmUp={vi.fn(async () => true)} />} />
        <Route path="/games/x" element={<h1>Сводка партии</h1>} />
        <Route path="/games/x/review" element={<h1>Разбор</h1>} />
        <Route path="/learn" element={<h1>Учёба</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('урок «Исправить ошибки»', () => {
  it('ошибка: запись повторения, рейтинг не меняется, опыт растёт; итог ведёт на сводку партии', async () => {
    renderGameLesson(lesson([gamePz(5), gamePz(9, P2_MOVES)], 'game'));
    await waitInteractive(P1);
    move('a7a6');
    expect(await screen.findByText('Не тот ход')).toBeTruthy();
    await solve('e7e5', P1);
    await waitInteractive(P2);
    await waitFor(async () => expect(await db.reviews.get('g:x:5')).toBeTruthy());
    const profile = await getProfile();
    expect(profile.rating).toBe(600);
    expect(profile.ratedCount).toBe(0);
    expect(profile.xp).toBe(5);
    expect(await db.ratingHistory.count()).toBe(0);
    expect(await db.themeStats.count()).toBe(0);

    await solve('d7d5', P2);
    await solve('e7e5', P1);
    expect(await screen.findByText('Решено с первого раза: 1 из 2')).toBeTruthy();
    await waitFor(async () => expect(await loadActiveLesson()).toBeNull());
    expect((await db.days.get(localDay(new Date())))?.lessons).toBe(1);
    expect(await db.lessons.toArray()).toEqual([{ nodeId: 'game:x', lessonIndex: 0, clean: 1, total: 2 }]);
    expect(await attempts()).toEqual([
      { puzzleId: 'g:x:5', result: 'mistake', rated: false, source: 'game' },
      { puzzleId: 'g:x:9', result: 'clean', rated: false, source: 'game' },
    ]);
    expect((await getProfile()).rating).toBe(600);

    await click('Готово');
    expect(await screen.findByRole('heading', { name: 'Сводка партии' })).toBeTruthy();
  });

  it('выход из урока ведёт на сводку партии', async () => {
    renderGameLesson(lesson([gamePz(5)], 'game'));
    await waitInteractive(P1);
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из урока' }));
    await click('Выйти');
    expect(await screen.findByRole('heading', { name: 'Сводка партии' })).toBeTruthy();
  });

  it('ссылка «Открыть этот ход в разборе» уводит с урока на разбор', async () => {
    renderGameLesson(lesson([gamePz(5)], 'game'));
    await waitInteractive(P1);
    move('e7e5');
    fireEvent.click(await screen.findByRole('link', { name: 'Открыть этот ход в разборе' }));
    expect(await screen.findByRole('heading', { name: 'Разбор' })).toBeTruthy();
  });
});

describe('RepeatLessonScreen', () => {
  function renderRepeat(nodeId: string) {
    return render(
      <MemoryRouter initialEntries={['/games/x/fix']}>
        <Routes>
          <Route path="/games/x/fix" element={<RepeatLessonScreen nodeId={nodeId} exitTo="/games/x" />} />
          <Route path="/games/x" element={<h1>Сводка партии</h1>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('урок партии из базы: задачи по ходу партии, номер урока — по числу пройденных', async () => {
    const gp = (ply: number, moves: [string, string]) => ({ id: `g:x:${ply}`, gameId: 'x', ply, endTime: 1,
      fen: START, moves, kind: 'pieceEnPrise' as const, phrase: PHRASE, loss: 0.3 });
    await db.gamePuzzles.bulkPut([gp(9, ['d2d4', 'd7d5']), gp(5, ['e2e4', 'e7e5'])]);
    await db.lessons.put({ nodeId: 'game:x', lessonIndex: 0, clean: 0, total: 2 });
    renderRepeat('game:x');
    expect(await screen.findByText('Исправить ошибки')).toBeTruthy();
    expect(screen.getByText('1 из 2')).toBeTruthy();
    await solve('e7e5', P1);
    await solve('d7d5', P2);
    expect(await screen.findByText('Решено с первого раза: 2 из 2')).toBeTruthy();
    await waitFor(async () => expect(await db.lessons.get(['game:x', 1])).toEqual(
      { nodeId: 'game:x', lessonIndex: 1, clean: 2, total: 2 }));
    await click('Готово');
    expect(await screen.findByRole('heading', { name: 'Сводка партии' })).toBeTruthy();
  });

  it('в партии нет задач: понятный текст и возврат на сводку', async () => {
    renderRepeat('game:x');
    expect(await screen.findByText('В этой партии нет задач на исправление')).toBeTruthy();
    expect(screen.queryByText('Урок не найден')).toBeNull();
    await click('Назад');
    expect(await screen.findByRole('heading', { name: 'Сводка партии' })).toBeTruthy();
  });
});

describe('TaskRunner: задача из партии', () => {
  function renderTask(task: LessonTask) {
    const onDone = vi.fn();
    render(
      <MemoryRouter>
        <TaskRunner task={task} title="Исправить ошибки" onDone={onDone} bestReply={vi.fn(async () => null)} />
      </MemoryRouter>,
    );
    return onDone;
  }

  it('метка «Из твоей партии»; после решения — фраза и ссылка на этот ход в разборе', async () => {
    renderTask(gamePz(5));
    expect(screen.getByText('Из твоей партии')).toBeTruthy();
    expect(screen.getByText('Ход чёрных')).toBeTruthy();
    expect(screen.queryByText(PHRASE)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    await waitInteractive(P1);
    move('e7e5');
    expect(await screen.findByText('Верно')).toBeTruthy();
    expect(screen.getByText(PHRASE)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть этот ход в разборе' }).getAttribute('href'))
      .toBe('/games/x/review?ply=5');
  });

  it('после показа решения тоже видны фраза и ссылка', async () => {
    renderTask(gamePz(5));
    await waitInteractive(P1);
    move('a7a6');
    await waitInteractive(P1);
    move('a7a6');
    await click('Показать решение');
    await screen.findByRole('button', { name: 'Дальше' });
    expect(screen.getByText(PHRASE)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть этот ход в разборе' })).toBeTruthy();
  });

  it('обычная задача: без метки, фразы и ссылки', async () => {
    renderTask(pz('p1'));
    await waitInteractive(P1);
    move('e7e5');
    expect(await screen.findByText('Верно')).toBeTruthy();
    expect(screen.queryByText('Из твоей партии')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
