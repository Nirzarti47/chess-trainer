import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CURRICULUM } from '../content/curriculum';
import { db } from '../data/db';
import { getProfile } from '../data/repo';
import { localDay } from '../domain/dates';
import type { LessonProgress } from '../domain/types';
import { LearnScreen, NOTE_MS } from './LearnScreen';

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function renderLearn() {
  return render(
    <MemoryRouter initialEntries={['/learn']}>
      <Routes>
        <Route path="/learn" element={<LearnScreen />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = async () => (await screen.findByTestId('where')).textContent;
const row = (nodeId: string, lessonIndex: number, clean = 10, total = 10): LessonProgress =>
  ({ nodeId, lessonIndex, clean, total });
/** Первая кнопка пути с таким названием: темы повторяются в следующих кругах. */
const node = async (name: RegExp) => (await screen.findAllByRole('button', { name }))[0];

/** Все уроки всех узлов до указанного, без ошибок. */
async function doneBefore(nodeId: string, extra: LessonProgress[] = []) {
  const rows: LessonProgress[] = [];
  for (const n of CURRICULUM.flatMap((s) => s.nodes)) {
    if (n.id === nodeId) break;
    for (let i = 0; i < n.lessons; i++) rows.push(row(n.id, i));
  }
  await db.lessons.bulkPut([...rows, ...extra]);
}

const scrolled = vi.fn();

beforeEach(async () => {
  await db.delete();
  await db.open();
  scrolled.mockClear();
  Element.prototype.scrollIntoView = function (this: Element) { scrolled(this); };
});

describe('LearnScreen: ошибка чтения', () => {
  it('«Повторить» загружает путь заново, ошибка уходит', async () => {
    await getProfile();
    db.close();
    renderLearn();
    expect(await screen.findByText('Не удалось загрузить путь')).toBeTruthy();
    await db.open();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await node(/^Проверка основ/)).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить путь')).toBeNull();
  });

  it('ошибка уходит после удачной загрузки при возвращении в приложение', async () => {
    await getProfile();
    db.close();
    renderLearn();
    expect(await screen.findByText('Не удалось загрузить путь')).toBeTruthy();
    await db.open();
    fireEvent(document, new Event('visibilitychange'));
    expect(await node(/^Проверка основ/)).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить путь')).toBeNull();
  });
});

describe('LearnScreen', () => {
  it('новый пользователь: раздел «Проверка основ» с текущим узлом, без «Слабых мест»', async () => {
    renderLearn();
    const basics = await node(/^Проверка основ/);
    expect(basics.dataset.status).toBe('current');
    expect(screen.getByRole('heading', { name: 'Проверка основ' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Круг 1. Первые удары' })).toBeTruthy();
    expect((await node(/^Мат в один ход/)).dataset.status).toBe('locked');
    expect(screen.queryByRole('button', { name: /Слабые места/ })).toBeNull();
    // Верхняя строка: серия, опыт, рейтинг.
    expect(screen.getByLabelText('Серия').textContent).toBe('0');
    expect(screen.getByLabelText('Опыт').textContent).toBe('Опыт 0');
    expect(screen.getByLabelText('Рейтинг в задачах').textContent).toBe('600');
    // Экран прокручен к текущему узлу.
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith(basics.closest('li')));
  });

  it('верхняя строка берёт серию, опыт и рейтинг из базы', async () => {
    const p = await getProfile();
    await db.kv.put({ key: 'profile', value: { ...p, xp: 1240, rating: 870 } });
    await db.days.put({ day: localDay(new Date()), lessons: 1, freePuzzles: 0 });
    renderLearn();
    await waitFor(() => expect(screen.getByLabelText('Серия').textContent).toBe('1'));
    expect(screen.getByLabelText('Опыт').textContent).toMatch(/^Опыт 1\s240$/);
    expect(screen.getByLabelText('Рейтинг в задачах').textContent).toBe('870');
  });

  it('текущий узел открывает следующий урок; на кнопке темы фигура из набора', async () => {
    await doneBefore('c1:mateIn1', [row('c1:mateIn1', 0, 5, 10)]);
    renderLearn();
    const mate = await node(/^Мат в один ход/);
    expect(mate.dataset.status).toBe('current');
    expect(within(mate).getByText('Урок 2 из 5')).toBeTruthy();
    expect(mate.querySelector('img')?.getAttribute('src')).toBe('./pieces/maestro/wQ.svg');
    expect((await node(/^Вилка/)).querySelector('img')?.getAttribute('src')).toBe('./pieces/maestro/wN.svg');
    expect((await node(/^Проверка основ/)).dataset.status).toBe('done');
    fireEvent.click(mate);
    expect(await where()).toBe('/lesson/c1:mateIn1/1');
  });

  it('ускорение: окно перед уроком, «Идти по порядку» вызывает declineFastTrack', async () => {
    await doneBefore('c1:mateIn1', [row('c1:mateIn1', 0, 12, 12), row('c1:mateIn1', 1, 12, 12)]);
    renderLearn();
    fireEvent.click(await node(/^Мат в один ход/));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Тема идёт легко. Пройти сразу последний урок?')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Идти по порядку' }));
    expect(await where()).toBe('/lesson/c1:mateIn1/2');
    expect((await getProfile()).fastTrackDeclined).toEqual(['c1:mateIn1']);
  });

  it('ускорение: «Да, к последнему» открывает последний урок темы', async () => {
    await doneBefore('c1:mateIn1', [row('c1:mateIn1', 0, 12, 12), row('c1:mateIn1', 1, 12, 12)]);
    renderLearn();
    fireEvent.click(await node(/^Мат в один ход/));
    fireEvent.click(await screen.findByRole('button', { name: 'Да, к последнему' }));
    expect(await where()).toBe('/lesson/c1:mateIn1/4');
    expect((await getProfile()).fastTrackDeclined).toEqual([]);
  });

  it('закрытый узел не открывает урок: подпись, которая исчезает сама', async () => {
    renderLearn();
    const fork = await node(/^Вилка/);
    expect(fork.dataset.status).toBe('locked');
    fireEvent.click(fork);
    expect(screen.getByText('Сначала пройди предыдущую тему')).toBeTruthy();
    expect(screen.queryByTestId('where')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Сначала пройди предыдущую тему')).toBeNull(),
      { timeout: NOTE_MS + 1000 });
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('пройденный узел: список его уроков для повторения', async () => {
    await doneBefore('c1:hangingPiece');
    renderLearn();
    const mate = await node(/^Мат в один ход/);
    expect(mate.dataset.status).toBe('done');
    expect(mate.textContent).toContain('✓');
    fireEvent.click(mate);
    const sheet = await screen.findByRole('dialog', { name: 'Мат в один ход' });
    expect(within(sheet).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Урок 1', 'Урок 2', 'Урок 3', 'Урок 4', 'Урок 5']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Урок 3' }));
    expect(await where()).toBe('/lesson/c1:mateIn1/2');
  });

  it('закрепление: отдельная кнопка открывает урок закрепления', async () => {
    await doneBefore('c1:mateIn1', [0, 1, 2, 3, 4].map((i) => row('c1:mateIn1', i, 5, 10)));
    renderLearn();
    const reinforce = await node(/^Закрепление: Мат в один ход/);
    expect(reinforce.dataset.status).toBe('current');
    fireEvent.click(reinforce);
    expect(await where()).toBe('/lesson/c1:mateIn1:reinforce/0');
  });

  it('«Слабые места»: голубая кнопка со счётчиком задач со сроком ведёт на /run/weak', async () => {
    await doneBefore('c1:hangingPiece');
    await db.themeStats.put({ theme: 'mateIn1', rating: 650, solved: 20, clean: 15 });
    const today = localDay(new Date());
    await db.reviews.bulkPut([
      { puzzleId: 'a', stage: 0, dueDay: today }, { puzzleId: 'b', stage: 1, dueDay: today },
      { puzzleId: 'c', stage: 1, dueDay: '2999-01-01' },
    ]);
    renderLearn();
    const weak = await node(/^Слабые места/);
    expect(weak.textContent).toContain('2 задачи ждут');
    fireEvent.click(weak);
    expect(await where()).toBe('/run/weak');
  });

  it('контрольная: значок вместо фигуры', async () => {
    renderLearn();
    const exam = (await screen.findAllByRole('button', { name: /^Контрольная/ }))[0];
    expect(exam.querySelector('img')).toBeNull();
    expect(exam.querySelector('svg')).toBeTruthy();
  });
});
