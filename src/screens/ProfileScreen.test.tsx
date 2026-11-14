import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PIECE_SETS } from '../content/pieceSets';
import { exportBackup } from '../data/backup';
import { db } from '../data/db';
import { getProfile } from '../data/repo';
import { addDays, localDay } from '../domain/dates';
import type { Profile } from '../domain/types';
import { AboutScreen } from './AboutScreen';
import { BackupScreen, RELOAD_DELAY_MS } from './BackupScreen';
import { ProfileScreen } from './ProfileScreen';

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

const reload = vi.fn();

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/profile/backup" element={<BackupScreen reload={reload} />} />
        <Route path="/profile/about" element={<AboutScreen />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const today = () => localDay(new Date());

async function setProfile(over: Partial<Profile>) {
  const p = await getProfile();
  await db.kv.put({ key: 'profile', value: { ...p, ...over } });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  reload.mockReset();
});

describe('ProfileScreen: прогресс', () => {
  it('новый пользователь: нули, заглушки графика и тем, пункты меню', async () => {
    renderAt('/profile');
    expect(await screen.findByLabelText('Опыт')).toBeTruthy();
    expect(screen.getByLabelText('Опыт').textContent).toBe('0');
    expect(screen.getByLabelText('Рейтинг в задачах').textContent).toBe('600');
    expect(screen.getByLabelText('Пройдено тем').textContent).toBe('0');
    expect(screen.getByLabelText('Пройдено уроков').textContent).toBe('0');
    expect(screen.getByLabelText('Решено задач').textContent).toBe('0');
    expect(screen.getByText('График появится после первых задач')).toBeTruthy();
    expect(screen.getByText('Статистика по темам появится после первых уроков')).toBeTruthy();
    expect(screen.getByText('Пропуск на этой неделе: есть')).toBeTruthy();
    for (const name of ['Оформление', 'Резервная копия', 'О приложении']) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).toBeTruthy();
    }
    expect(screen.queryByText('Давно не было резервной копии')).toBeNull();
  });

  it('полоска недели: семь дней с пн по вс, сегодня отмечено', async () => {
    renderAt('/profile');
    const week = await screen.findByRole('list', { name: 'Эта неделя' });
    const days = within(week).getAllByRole('listitem');
    expect(days.map((d) => d.textContent)).toEqual(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']);
    const marked = days.filter((d) => d.dataset.state === 'today');
    expect(marked).toHaveLength(1);
    const weekday = (new Date().getDay() + 6) % 7;
    expect(marked[0]).toBe(days[weekday]);
  });

  it('берёт числа из базы: серия, опыт, рейтинг, график, темы, уроки, задачи', async () => {
    const day = today();
    await setProfile({ xp: 1240, rating: 870, firstDay: addDays(day, -2) });
    await db.days.bulkPut([
      { day: addDays(day, -2), lessons: 1, freePuzzles: 0 },
      { day: addDays(day, -1), lessons: 0, freePuzzles: 10 },
      { day, lessons: 2, freePuzzles: 0 },
    ]);
    await db.ratingHistory.bulkAdd([{ at: 1, rating: 620 }, { at: 2, rating: 640 }, { at: 3, rating: 610 }]);
    await db.lessons.bulkPut([
      { nodeId: 'basics:basics', lessonIndex: 0, clean: 5, total: 5 },
      { nodeId: 'c1:openings', lessonIndex: 0, clean: 5, total: 5 },
    ]);
    await db.attempts.bulkAdd([
      { puzzleId: 'a', themes: ['fork'], result: 'clean', source: 'free', rated: true, at: 1 },
      { puzzleId: 'a', themes: ['fork'], result: 'clean', source: 'free', rated: true, at: 2 },
      { puzzleId: 'b', themes: ['fork'], result: 'clean', source: 'free', rated: true, at: 3 },
    ]);
    await db.themeStats.bulkPut([
      { theme: 'fork', rating: 900, solved: 12, clean: 10 },
      { theme: 'pin', rating: 700, solved: 6, clean: 3 },
      { theme: 'mateIn1', rating: 1000, solved: 8, clean: 8 },
      { theme: 'skewer', rating: 500, solved: 5, clean: 1 },
      { theme: 'mateIn2', rating: 650, solved: 9, clean: 4 },
      { theme: 'hangingPiece', rating: 820, solved: 7, clean: 6 },
      { theme: 'deflection', rating: 300, solved: 4, clean: 0 },
    ]);

    renderAt('/profile');
    await waitFor(() => expect(screen.getByLabelText('Опыт').textContent).toMatch(/^1\s240$/));
    expect(screen.getByLabelText('Серия').textContent).toBe('3');
    expect(screen.getByLabelText('Рейтинг в задачах').textContent).toBe('870');
    expect(screen.getByLabelText('Пройдено тем').textContent).toBe('0');
    expect(screen.getByLabelText('Пройдено уроков').textContent).toBe('2');
    expect(screen.getByLabelText('Решено задач').textContent).toBe('2');
    expect(screen.getByRole('img', { name: 'График рейтинга' }).querySelector('polyline')).toBeTruthy();

    const names = (label: string) => within(screen.getByRole('list', { name: label }))
      .getAllByRole('listitem').map((li) => li.textContent);
    expect(names('Сильные темы')).toEqual(['Мат в один ход1000', 'Вилка900', 'Незащищённая фигура820']);
    expect(names('Слабые темы')).toEqual(['Сквозной удар500', 'Мат в два хода650', 'Связка700']);
  });

  it('пройденная тема пути учитывается в «Пройдено тем»', async () => {
    await db.lessons.bulkPut([
      { nodeId: 'basics:basics', lessonIndex: 0, clean: 5, total: 5 },
      { nodeId: 'c1:openings', lessonIndex: 0, clean: 5, total: 5 },
      { nodeId: 'c1:openings', lessonIndex: 1, clean: 5, total: 5 },
      { nodeId: 'c1:openings', lessonIndex: 2, clean: 5, total: 5 },
      ...Array.from({ length: 5 }, (_, i) => ({ nodeId: 'c1:mateIn1', lessonIndex: i, clean: 5, total: 5 })),
    ]);
    renderAt('/profile');
    await waitFor(() => expect(screen.getByLabelText('Пройдено тем').textContent).toBe('1'));
    expect(screen.getByLabelText('Пройдено уроков').textContent).toBe('9');
  });
});

describe('ProfileScreen: напоминание о резервной копии', () => {
  it('на 14-й день без копии напоминания нет', async () => {
    await setProfile({ firstDay: addDays(today(), -14) });
    renderAt('/profile');
    await screen.findByLabelText('Опыт');
    expect(screen.queryByText('Давно не было резервной копии')).toBeNull();
  });

  it('на 15-й день показывается; «Позже» прячет его и запоминает отсрочку', async () => {
    await setProfile({ firstDay: addDays(today(), -15) });
    const { unmount } = renderAt('/profile');
    expect(await screen.findByText('Давно не было резервной копии')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Позже' }));
    await waitFor(() => expect(screen.queryByText('Давно не было резервной копии')).toBeNull());
    expect((await getProfile()).backupSnoozedAt).not.toBeNull();

    unmount();
    renderAt('/profile');
    await screen.findByLabelText('Опыт');
    expect(screen.queryByText('Давно не было резервной копии')).toBeNull();
  });

  it('«Сохранить» ведёт на экран резервной копии', async () => {
    await setProfile({ firstDay: addDays(today(), -30) });
    renderAt('/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('heading', { name: 'Резервная копия' })).toBeTruthy();
  });
});

describe('BackupScreen: сохранение', () => {
  const nav = navigator;
  const createObjectURL = vi.fn(() => 'blob:backup');
  const revokeObjectURL = vi.fn();
  let clicked: HTMLAnchorElement[] = [];

  beforeEach(() => {
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    createObjectURL.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });

  function stubShare(share: (data: ShareData) => Promise<void>) {
    Object.defineProperty(navigator, 'share', { value: vi.fn(share), configurable: true });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn((data: ShareData) => Boolean(data.files?.length)), configurable: true,
    });
  }

  it('меню «Поделиться» доступно: отдаёт файл и отмечает копию', async () => {
    stubShare(async () => {});
    await getProfile();
    renderAt('/profile/backup');
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить в файл' }));
    expect(await screen.findByText('Копия сохранена')).toBeTruthy();

    const share = nav.share as ReturnType<typeof vi.fn>;
    expect(share).toHaveBeenCalledTimes(1);
    const file = (share.mock.calls[0][0] as ShareData).files![0];
    expect(file.name).toBe(`chess-trainer-${today()}.json`);
    expect(JSON.parse(await file.text()).app).toBe('chess-trainer');
    expect(clicked).toHaveLength(0);
    expect((await getProfile()).lastBackupAt).not.toBeNull();
  });

  it('отмена «Поделиться» — не ошибка, копия не отмечена', async () => {
    stubShare(async () => { throw new DOMException('Отменено', 'AbortError'); });
    await getProfile();
    renderAt('/profile/backup');
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить в файл' }));
    await waitFor(() => expect(nav.share).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Копия сохранена')).toBeNull();
    expect((await getProfile()).lastBackupAt).toBeNull();
  });

  it('файл готовится заранее: кнопка неактивна, пока он не готов', async () => {
    await getProfile();
    renderAt('/profile/backup');
    const waiting = screen.getByRole('button', { name: 'Готовлю файл…' }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    const ready = (await screen.findByRole('button', { name: 'Сохранить в файл' })) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
  });

  it('share вызывается в том же такте, что и нажатие, с уже готовым файлом', async () => {
    stubShare(async () => {});
    await getProfile();
    renderAt('/profile/backup');
    const button = await screen.findByRole('button', { name: 'Сохранить в файл' });
    fireEvent.click(button);
    // Никакого await между нажатием и проверкой: Safari пускает share только сразу после касания.
    expect(nav.share).toHaveBeenCalledTimes(1);
    const file = ((nav.share as ReturnType<typeof vi.fn>).mock.calls[0][0] as ShareData).files![0];
    expect(file.name).toBe(`chess-trainer-${today()}.json`);
    expect(await screen.findByText('Копия сохранена')).toBeTruthy();
  });

  it('share отклонён (NotAllowedError): файл скачивается, копия отмечена', async () => {
    stubShare(async () => { throw new DOMException('Нет активации', 'NotAllowedError'); });
    await getProfile();
    renderAt('/profile/backup');
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить в файл' }));
    expect(await screen.findByText('Копия сохранена')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe(`chess-trainer-${today()}.json`);
    expect((await getProfile()).lastBackupAt).not.toBeNull();
  });

  it('при новом показе экрана файл собирается заново', async () => {
    stubShare(async () => {});
    await setProfile({ xp: 10 });
    renderAt('/profile/backup');
    await screen.findByRole('button', { name: 'Сохранить в файл' });
    await setProfile({ xp: 99 });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByRole('button', { name: 'Готовлю файл…' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить в файл' }));
    const file = ((nav.share as ReturnType<typeof vi.fn>).mock.calls[0][0] as ShareData).files![0];
    const kv = JSON.parse(await file.text()).tables.kv as { key: string; value: { xp: number } }[];
    expect(kv.find((r) => r.key === 'profile')!.value.xp).toBe(99);
    expect(await screen.findByText('Копия сохранена')).toBeTruthy();
  });

  it('без «Поделиться» скачивает файл и отмечает копию', async () => {
    await getProfile();
    renderAt('/profile/backup');
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить в файл' }));
    expect(await screen.findByText('Копия сохранена')).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe(`chess-trainer-${today()}.json`);
    expect(clicked[0].getAttribute('href')).toBe('blob:backup');
    expect((await getProfile()).lastBackupAt).not.toBeNull();
  });
});

describe('BackupScreen: восстановление', () => {
  const chooseFile = async (text: string) => {
    const input = (await screen.findByLabelText('Восстановить из файла')) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([text], 'copy.json', { type: 'application/json' })] } });
  };

  it('спрашивает подтверждение; «Отмена» ничего не меняет', async () => {
    await setProfile({ xp: 50 });
    const copy = await (await exportBackup()).text();
    await setProfile({ xp: 300 });
    renderAt('/profile/backup');
    await chooseFile(copy);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Текущий прогресс будет заменён')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await getProfile()).xp).toBe(300);
    expect(reload).not.toHaveBeenCalled();
  });

  it('«Заменить» восстанавливает прогресс и перезагружает приложение', async () => {
    await setProfile({ xp: 50 });
    const copy = await (await exportBackup()).text();
    await setProfile({ xp: 300 });
    renderAt('/profile/backup');
    await chooseFile(copy);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Заменить' }));
    expect(await screen.findByText('Прогресс восстановлен')).toBeTruthy();
    expect((await getProfile()).xp).toBe(50);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: RELOAD_DELAY_MS + 1000 });
  });

  it('ошибка импорта выводит сообщение и не меняет данные', async () => {
    await setProfile({ xp: 300 });
    renderAt('/profile/backup');
    await chooseFile('{"app":"другое"}');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Заменить' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Это не файл резервной копии');
    expect((await getProfile()).xp).toBe(300);
    expect(screen.queryByText('Прогресс восстановлен')).toBeNull();
    await new Promise((r) => setTimeout(r, RELOAD_DELAY_MS + 100));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('AboutScreen', () => {
  it('перечисляет авторов и лицензии', async () => {
    renderAt('/profile/about');
    expect(await screen.findByRole('heading', { name: 'О приложении' })).toBeTruthy();
    for (const set of PIECE_SETS) {
      const item = screen.getByText(set.name).closest('li')!;
      expect(item.textContent).toContain(set.author);
      expect(item.textContent).toContain(set.license);
    }
    const text = document.body.textContent!;
    for (const part of ['chessground', 'chess.js', 'BSD-2-Clause', 'Stockfish', 'Lichess', 'CC0',
      'Golos Text', 'SIL Open Font License', 'Код приложения открыт под лицензией GPL-3.0']) {
      expect(text).toContain(part);
    }
    // Репозитория пока нет — ссылки тоже нет.
    expect(screen.queryByRole('link', { name: /репозитор/i })).toBeNull();
  });
});
