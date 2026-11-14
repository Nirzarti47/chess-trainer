import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { BANDS, THEMES } from '../content/themes';
import { db } from '../data/db';
import { localDay } from '../domain/dates';
import { makePuzzles } from '../domain/testPool';
import type { LessonTask, Puzzle, TaskResult } from '../domain/types';
import { PuzzleRunScreen, PuzzlesScreen } from './PuzzlesScreen';

// Задачи кругов: по 30 на каждую тему в коридоре круга.
const pools = vi.hoisted(() => ({ byCircle: new Map<number, Puzzle[]>() }));
vi.mock('../data/puzzleStore', async () => {
  const { fakePool: makePool } = await import('../domain/testPool');
  return {
    loadCircle: vi.fn(async (c: number) => makePool(pools.byCircle.get(c) ?? [])),
    findPuzzle: vi.fn(async (id: string) => [...pools.byCircle.values()].flat().find((p) => p.id === id)),
  };
});
for (const c of [1, 2, 3] as const) {
  const [lo, hi] = BANDS[c];
  pools.byCircle.set(c, THEMES.flatMap((t) => makePuzzles(t.id, 30, lo, hi).map((p) => ({ ...p, id: `c${c}-${p.id}` }))));
}

// Настоящее хранилище, но с записью вызовов.
vi.mock('../data/repo', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/repo')>();
  return { ...real, recordTaskResult: vi.fn(real.recordTaskResult), getDueReviews: vi.fn(real.getDueReviews) };
});
const repo = await import('../data/repo');
const recordTaskResult = vi.mocked(repo.recordTaskResult);
const getDueReviews = vi.mocked(repo.getDueReviews);

// Настоящий TaskRunner проверен в LessonScreen.test.tsx; здесь поддельный: показывает задачу и даёт её закончить.
// Номер показа отличает новую задачу от прежней, даже если это та же задача.
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('./TaskRunner', async () => {
  const { useState } = await import('react');
  return { TaskRunner: ({ task, title, onDone }: { task: LessonTask; title?: string; onDone(r: TaskResult): void }) => {
    const [mount] = useState(() => ++mounts.count);
    const p = task.kind === 'puzzle' ? task.puzzle : null;
    return (
      <div>
        <p data-testid="task" data-themes={p?.themes.join(' ')} data-title={title} data-mount={mount}>{p?.id}</p>
        <button type="button" onClick={() => onDone('clean')}>Решить</button>
        <button type="button" onClick={() => onDone('mistake')}>Ошибиться</button>
      </div>
    );
  } };
});

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderAt(path: string) {
  const warmUp = vi.fn(async () => true);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/puzzles" element={<PuzzlesScreen />} />
        <Route path="/run/:mode" element={<PuzzleRunScreen warmUp={warmUp} />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return { warmUp };
}

const where = () => screen.getByTestId('where').textContent;
const taskId = async () => (await screen.findByTestId('task')).textContent!;
const today = () => localDay(new Date());

/** Закончить показанную задачу и дождаться следующей. */
async function finish(button: 'Решить' | 'Ошибиться' = 'Решить') {
  const before = (await screen.findByTestId('task')).dataset.mount;
  const calls = recordTaskResult.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => expect(recordTaskResult.mock.calls.length).toBe(calls + 1));
  await waitFor(() => expect(screen.getByTestId('task').dataset.mount).not.toBe(before));
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  vi.clearAllMocks();
});

describe('PuzzlesScreen', () => {
  it('новый пользователь: три входа, восемь тем круга 1 с рейтингом 600, повторять нечего', async () => {
    renderAt('/puzzles');
    expect(screen.getByRole('heading', { name: 'Задачи' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Подборка для тебя/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'По теме' })).toBeTruthy();
    const circle1 = THEMES.filter((t) => t.firstCircle === 1);
    for (const t of circle1) {
      expect(screen.getByRole('button', { name: `${t.title} 600` })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /Завлечение/ })).toBeNull();
    expect(screen.getByText('Повторять пока нечего. Задачи появятся здесь после ошибок')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Повторение/ })).toBeNull();
    expect(screen.getByText('Сегодня решено: 0 из 10 для серии')).toBeTruthy();
  });

  it('счётчик повторения берётся из getDueReviews за сегодня', async () => {
    await db.reviews.bulkPut([
      { puzzleId: 'c1-pin-3', stage: 1, dueDay: today() },
      { puzzleId: 'c1-fork-1', stage: 0, dueDay: '2020-01-01' },
      { puzzleId: 'c1-fork-4', stage: 1, dueDay: '2999-01-01' },
    ]);
    renderAt('/puzzles');
    const review = await screen.findByRole('button', { name: /Повторение/ });
    expect(review.textContent).toContain('2');
    expect(getDueReviews).toHaveBeenCalledWith(today());
    fireEvent.click(review);
    await waitFor(() => expect(where()).toBe('/run/review'));
  });

  it('рейтинг темы из статистики; вход в тему и в подборку', async () => {
    await db.themeStats.put({ theme: 'fork', rating: 655, solved: 4, clean: 3 });
    renderAt('/puzzles');
    fireEvent.click(await screen.findByRole('button', { name: 'Вилка 655' }));
    await waitFor(() => expect(where()).toBe('/run/theme-fork'));
  });

  it('подборка ведёт на поток', async () => {
    renderAt('/puzzles');
    fireEvent.click(await screen.findByRole('button', { name: /Подборка для тебя/ }));
    await waitFor(() => expect(where()).toBe('/run/free'));
  });

  it('засчитанный день: «День засчитан» вместо счётчика', async () => {
    await db.days.put({ day: today(), lessons: 0, freePuzzles: 10 });
    renderAt('/puzzles');
    expect(await screen.findByText('День засчитан')).toBeTruthy();
    expect(screen.queryByText(/Сегодня решено/)).toBeNull();
  });
});

describe('поток задач', () => {
  it('после решения сразу следующая задача, запись с источником free и изменение рейтинга', async () => {
    const { warmUp } = renderAt('/run/free');
    const first = await taskId();
    expect(warmUp).toHaveBeenCalled();
    expect(screen.getByLabelText('Рейтинг в задачах').textContent).toContain('600');
    expect(screen.getByText('Сегодня решено: 0 из 10 для серии')).toBeTruthy();

    await finish('Решить');
    expect(recordTaskResult).toHaveBeenCalledWith(expect.objectContaining({
      puzzleId: first, source: 'free', rated: true, result: 'clean', themes: expect.any(Array),
      puzzleRating: expect.any(Number), now: expect.any(Date),
    }));
    expect(await taskId()).not.toBe(first);
    const after = (await repo.getProfile()).rating;
    expect(screen.getByLabelText('Рейтинг в задачах').textContent).toContain(String(after));
    expect(screen.getByText(`+${after - 600}`)).toBeTruthy();
    expect(screen.getByText('Сегодня решено: 1 из 10 для серии')).toBeTruthy();

    const before = after;
    await finish('Ошибиться');
    const now = (await repo.getProfile()).rating;
    expect(now).toBeLessThan(before);
    expect(screen.getByText(`−${before - now}`)).toBeTruthy();
  });

  it('подборка берёт задачи только из открытых тем коридора круга 1', async () => {
    renderAt('/run/free');
    const open = new Set(THEMES.filter((t) => t.firstCircle === 1).map((t) => t.id));
    const ids = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const el = await screen.findByTestId('task');
      ids.add(el.textContent!);
      expect(el.textContent!.startsWith('c1-')).toBe(true);
      expect(el.dataset.themes!.split(' ').every((t) => open.has(t))).toBe(true);
      await finish();
    }
    expect(ids.size).toBe(6);
  });

  it('десять задач засчитывают день', async () => {
    renderAt('/run/free');
    for (let i = 0; i < 10; i++) await finish();
    expect(await screen.findByText('День засчитан')).toBeTruthy();
    expect(screen.queryByText(/Сегодня решено/)).toBeNull();
  });

  it('режим темы: все задачи этой темы', async () => {
    renderAt('/run/theme-pin');
    for (let i = 0; i < 5; i++) {
      const el = await screen.findByTestId('task');
      expect(el.dataset.themes!.split(' ')).toContain('pin');
      await finish(i % 2 ? 'Ошибиться' : 'Решить');
    }
    expect(recordTaskResult.mock.calls.every(([r]) => r.source === 'free' && r.themes.includes('pin'))).toBe(true);
    expect(screen.getByTestId('task').dataset.title).toBe('Связка');
  });

  it('уже виденная задача идёт без рейтинга', async () => {
    const pins = pools.byCircle.get(1)!.filter((p) => p.themes.includes('pin'));
    await db.attempts.bulkAdd(pins.map((p) => ({ puzzleId: p.id, themes: p.themes, puzzleRating: p.rating,
      result: 'clean' as const, source: 'free' as const, rated: true, at: 0 })));
    renderAt('/run/theme-pin');
    await finish();
    expect(recordTaskResult.mock.calls[0][0].rated).toBe(false);
    expect(screen.queryByText(/^[+−]\d+$/)).toBeNull();
  });

  it('закрытая тема: сообщение и возврат к задачам', async () => {
    renderAt('/run/theme-attraction');
    expect(await screen.findByText('Эта тема пока закрыта')).toBeTruthy();
    expect(screen.queryByTestId('task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'К задачам' }));
    await waitFor(() => expect(where()).toBe('/puzzles'));
  });

  it('крестик без подтверждения ведёт к задачам', async () => {
    renderAt('/run/free');
    await taskId();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(where()).toBe('/puzzles'));
  });
});

describe('повторение', () => {
  it('задачи со сроком по очереди с источником review, потом «На сегодня всё повторено»', async () => {
    await db.reviews.bulkPut([
      { puzzleId: 'c1-pin-3', stage: 1, dueDay: today() },
      { puzzleId: 'нет-такой', stage: 1, dueDay: today() },
      { puzzleId: 'c2-fork-4', stage: 0, dueDay: '2020-01-01' },
      { puzzleId: 'c1-fork-5', stage: 1, dueDay: '2999-01-01' },
    ]);
    renderAt('/run/review');
    const shown = [await taskId()];
    await finish('Ошибиться');
    shown.push(await taskId());
    expect(new Set(shown)).toEqual(new Set(['c1-pin-3', 'c2-fork-4']));

    fireEvent.click(screen.getByRole('button', { name: 'Решить' }));
    expect(await screen.findByText('На сегодня всё повторено')).toBeTruthy();
    expect(recordTaskResult).toHaveBeenCalledTimes(2);
    expect(recordTaskResult.mock.calls.map(([r]) => [r.puzzleId, r.source, r.rated, r.result])).toEqual([
      [shown[0], 'review', false, 'mistake'],
      [shown[1], 'review', false, 'clean'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'К задачам' }));
    await waitFor(() => expect(where()).toBe('/puzzles'));
  });

  it('без задач со сроком сразу «На сегодня всё повторено»', async () => {
    renderAt('/run/review');
    expect(await screen.findByText('На сегодня всё повторено')).toBeTruthy();
    expect(screen.queryByTestId('task')).toBeNull();
  });

  it('крестик выходит из повторения', async () => {
    await db.reviews.put({ puzzleId: 'c1-pin-3', stage: 1, dueDay: today() });
    renderAt('/run/review');
    await taskId();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(where()).toBe('/puzzles'));
  });
});
