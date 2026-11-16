import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PIECE_SETS } from '../content/pieceSets';
import { exportBackup } from '../data/backup';
import { ChessComError } from '../chesscom/api';
import { db } from '../data/db';
import { gamesQueue } from '../games/gamesStore';
import { setChessUser } from '../data/gamesRepo';
import { getProfile } from '../data/repo';
import { addDays, localDay } from '../domain/dates';
import type { Profile } from '../domain/types';
import { AboutScreen, REPO_URL } from './AboutScreen';
import { BackupScreen, RELOAD_DELAY_MS } from './BackupScreen';
import { CHART_POINTS, ProfileScreen, thinPoints } from './ProfileScreen';

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
    expect(screen.getByLabelText('Решено без ошибок').textContent).toBe('0');
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
      // Задача с одной ошибкой не решена.
      { puzzleId: 'c', themes: ['fork'], result: 'mistake', source: 'free', rated: true, at: 4 },
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
    expect(screen.getByLabelText('Решено без ошибок').textContent).toBe('2');
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

describe('ProfileScreen: устойчивость', () => {
  it('график прореживает длинную историю и считает границы без разворота массива', async () => {
    const long = Array.from({ length: 70_000 }, (_, i) => 600 + (i % 300));
    const thin = thinPoints(long);
    expect(thin).toHaveLength(CHART_POINTS);
    expect(thin[0]).toBe(long[0]);
    expect(thin[thin.length - 1]).toBe(long[long.length - 1]);
    expect(thinPoints([1, 2, 3])).toEqual([1, 2, 3]);

    // В базу — история покороче: запись 70 тысяч строк в тестовую базу слишком долгая.
    await db.ratingHistory.bulkAdd(long.slice(0, 1000).map((rating, at) => ({ at, rating })));
    renderAt('/profile');
    const chart = await screen.findByRole('img', { name: 'График рейтинга' });
    expect(chart.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(CHART_POINTS);
  });

  it('ошибка чтения: «Повторить» и меню видны, после удачной загрузки ошибка уходит', async () => {
    await getProfile();
    db.close();
    renderAt('/profile');
    expect(await screen.findByText('Не удалось загрузить профиль')).toBeTruthy();
    for (const name of ['Оформление', 'Резервная копия', 'О приложении']) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).toBeTruthy();
    }
    await db.open();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByLabelText('Опыт')).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить профиль')).toBeNull();
  });

  it('ошибка уходит и после загрузки при возвращении в приложение', async () => {
    await getProfile();
    db.close();
    renderAt('/profile');
    expect(await screen.findByText('Не удалось загрузить профиль')).toBeTruthy();
    await db.open();
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByLabelText('Опыт')).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить профиль')).toBeNull();
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
    // В файле lastBackupAt: null, но восстановленное состояние и есть содержимое копии.
    await waitFor(async () => expect((await getProfile()).lastBackupAt).not.toBeNull());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: RELOAD_DELAY_MS + 1000 });
  });

  it('после успешного восстановления партии перечитываются; сбой перечитывания не ломает восстановление', async () => {
    const copy = await (await exportBackup()).text();
    const refresh = vi.spyOn(gamesQueue, 'refresh').mockRejectedValue(new Error('сбой'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderAt('/profile/backup');
      await chooseFile(copy);
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Заменить' }));
      expect(await screen.findByText('Прогресс восстановлен')).toBeTruthy();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).toBeNull();
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: RELOAD_DELAY_MS + 1000 });
    } finally {
      refresh.mockRestore();
      log.mockRestore();
    }
  });

  it('ошибка импорта выводит сообщение и не меняет данные', async () => {
    const refresh = vi.spyOn(gamesQueue, 'refresh').mockResolvedValue();
    await setProfile({ xp: 300 });
    renderAt('/profile/backup');
    await chooseFile('{"app":"другое"}');
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Заменить' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Это не файл резервной копии');
    expect(refresh).not.toHaveBeenCalled();
    refresh.mockRestore();
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
    // Версия: дата и время сборки, чтобы было видно, дошло ли обновление.
    expect(text).toMatch(/Версия от \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} \(сборка [0-9a-z]+\)/);
    // Ссылка на исходный код (GPL-3.0) ведёт в репозиторий.
    const link = screen.getByRole('link', { name: /репозитор/i });
    expect(link.getAttribute('href')).toBe(REPO_URL);
    expect(REPO_URL).toMatch(/^https:\/\/github\.com\//);
  });
});

describe('Профиль: ник', () => {
  const change = vi.fn(async (_nick: string) => {});
  const sync = vi.fn(async () => {});
  const fetchPlayer = vi.fn(async (_nick: string) => {});

  beforeEach(() => {
    change.mockClear();
    sync.mockClear();
  });

  const renderProfile = () => render(
    <MemoryRouter initialEntries={['/profile']}>
      <ProfileScreen fetchPlayer={fetchPlayer} sync={sync} change={change} />
    </MemoryRouter>,
  );

  it('смена ника вызывает changeNick только после подтверждения в листе', async () => {
    await setChessUser({ nick: 'owner_test', loadedThrough: null });
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: /Ник на Chess.com: owner_test/ }));
    expect(screen.getByText('Партии и задачи из них для прежнего ника будут удалены')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ник на Chess.com'), { target: { value: ' Rival_One ' } });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сменить ник' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith('rival_one'));
    expect(sync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('закрытие листа ничего не меняет', async () => {
    await setChessUser({ nick: 'owner_test', loadedThrough: null });
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: /Ник на Chess.com: owner_test/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it('без ника строка называется «Подключить Chess.com»', async () => {
    renderProfile();
    expect(await screen.findByRole('button', { name: /Подключить Chess.com/ })).toBeTruthy();
  });

  it('пока ник не прочитан, нажатие на строку не открывает лист', async () => {
    const readUser = vi.fn(() => new Promise<never>(() => {}));
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileScreen fetchPlayer={fetchPlayer} sync={sync} change={change} readUser={readUser} />
      </MemoryRouter>,
    );
    const row = await screen.findByRole('button', { name: /Ник на Chess.com/ });
    fireEvent.click(row);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Подключить Chess.com/ })).toBeNull();
  });

  it('сбой чтения ника: виден текст сбоя, лист не открывается', async () => {
    const readUser = vi.fn(async () => { throw new Error('база закрыта'); });
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ProfileScreen fetchPlayer={fetchPlayer} sync={sync} change={change} readUser={readUser} />
      </MemoryRouter>,
    );
    const row = await screen.findByRole('button', { name: /Не удалось прочитать ник/ });
    fireEvent.click(row);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Подключить Chess.com/ })).toBeNull();
  });

  it('смена на тот же ник (другой регистр, пробелы): запросов нет, лист закрывается', async () => {
    await setChessUser({ nick: 'owner_test', loadedThrough: null });
    fetchPlayer.mockClear();
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: /Ник на Chess.com: owner_test/ }));
    fireEvent.change(screen.getByLabelText('Ник на Chess.com'), { target: { value: ' OWNER_test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сменить ник' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchPlayer).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it.each([
    ['notFound', 'Игрок не найден'],
    ['offline', 'Нет сети. Проверь интернет и попробуй ещё раз'],
  ] as const)('смена ника, проверка нового не прошла (%s): change не вызван, лист открыт, виден текст', async (kind, text) => {
    await setChessUser({ nick: 'owner_test', loadedThrough: null });
    fetchPlayer.mockRejectedValueOnce(new ChessComError(kind, 'сбой'));
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: /Ник на Chess.com: owner_test/ }));
    fireEvent.change(screen.getByLabelText('Ник на Chess.com'), { target: { value: 'rival_one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сменить ник' }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
