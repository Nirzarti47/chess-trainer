import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirstLoadScreen, OFFLINE_READY_KEY, REQUIRED_FILES } from './FirstLoadScreen';

type Env = {
  controller?: boolean;
  active?: boolean;
  cached?: string[];
  online?: boolean;
  /** Сколько записей уже лежит в кэше предзагрузки. */
  stored?: number;
  /** Сколько записей в манифесте sw.js. */
  expected?: number;
  /** sw.js не отдаётся. */
  swMissing?: boolean;
  /** Воркер, который сейчас устанавливается. */
  installing?: EventTarget & { state: string };
};

const STALLED = 'Загрузка остановилась. Проверь связь и попробуй ещё раз.';
const LOADING = 'Загружаю задачи и доску. Это один раз, лучше по Wi-Fi';

function fakeInstallingWorker() {
  return Object.assign(new EventTarget(), { state: 'installing' });
}

const update = vi.fn(() => Promise.resolve());

function setEnv({
  controller = false,
  active = false,
  cached = [],
  online = true,
  stored = 0,
  expected = 10,
  swMissing = false,
  installing,
}: Env) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: controller ? {} : null,
      getRegistration: () =>
        Promise.resolve(active || installing ? { active: active ? {} : null, installing: installing ?? null, update } : undefined),
    },
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  vi.stubGlobal('caches', {
    match: (file: string) => Promise.resolve(cached.includes(file) ? new Response('') : undefined),
    keys: () => Promise.resolve(['workbox-precache-v2-test', 'other']),
    open: () => Promise.resolve({ keys: () => Promise.resolve(Array.from({ length: stored })) }),
  });
  const manifest = Array.from({ length: expected }, (_, i) => `{url:"f${i}",revision:"r"}`).join(',');
  const sw = swMissing ? new Response('', { status: 404 }) : new Response(`precacheAndRoute([${manifest}])`);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(sw.clone())));
}

function renderScreen(skip = false) {
  return render(
    <FirstLoadScreen skip={skip}>
      <p>Приложение</p>
    </FirstLoadScreen>,
  );
}

describe('FirstLoadScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    update.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    Reflect.deleteProperty(navigator, 'onLine');
  });

  it('при разработке экран пропускается', () => {
    renderScreen(true);
    expect(screen.getByText('Приложение')).toBeTruthy();
  });

  it('если всё уже сохранено, сразу открывает приложение', () => {
    localStorage.setItem(OFFLINE_READY_KEY, '1');
    setEnv({ controller: true, active: true, cached: REQUIRED_FILES });
    renderScreen();
    expect(screen.getByText('Приложение')).toBeTruthy();
  });

  it('если отметка есть, а сервис-воркера нет, загружает заново', () => {
    localStorage.setItem(OFFLINE_READY_KEY, '1');
    setEnv({});
    renderScreen();
    expect(screen.queryByText('Приложение')).toBeNull();
    expect(screen.getByText('Загружаю задачи и доску. Это один раз, лучше по Wi-Fi')).toBeTruthy();
  });

  it('пока идёт загрузка, показывает текст и долю сохранённого', async () => {
    setEnv({ active: true, stored: 4, expected: 10 });
    renderScreen();
    expect(screen.getByText('Загружаю задачи и доску. Это один раз, лучше по Wi-Fi')).toBeTruthy();
    await vi.waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40'));
    expect(screen.queryByText('Приложение')).toBeNull();
  });

  it('когда всё сохранено, говорит «Готово» и открывает приложение', async () => {
    setEnv({ controller: true, active: true, cached: REQUIRED_FILES });
    renderScreen();
    expect(await screen.findByText('Готово. Дальше интернет не нужен')).toBeTruthy();
    expect(await screen.findByText('Приложение', undefined, { timeout: 3000 })).toBeTruthy();
    expect(localStorage.getItem(OFFLINE_READY_KEY)).toBe('1');
  });

  it('без сети и без сохранённых файлов просит интернет и предлагает повторить', async () => {
    setEnv({ online: false, active: true, cached: REQUIRED_FILES.slice(0, 2) });
    renderScreen();
    expect(screen.getByText('Нужен интернет для первой загрузки')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    // Дать первой проверке закончиться, пока сеть ещё выключена: иначе она сама уберёт кнопку.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();

    setEnv({ online: true, active: true });
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(screen.getByText('Загружаю задачи и доску. Это один раз, лучше по Wi-Fi')).toBeTruthy();
  });

  it('без поддержки сервис-воркера показывает приложение с пометкой', () => {
    renderScreen();
    expect(screen.getByText('Приложение')).toBeTruthy();
    expect(screen.getByText('Этот браузер не умеет работать без сети')).toBeTruthy();
  });

  it('отметка есть, страница не под управлением воркера, но всё сохранено — открывает приложение', async () => {
    localStorage.setItem(OFFLINE_READY_KEY, '1');
    setEnv({ controller: false, active: true, cached: REQUIRED_FILES });
    renderScreen();
    expect(await screen.findByText('Приложение')).toBeTruthy();
  });

  it('если установка воркера сорвалась при живой сети, предлагает повторить', async () => {
    const worker = fakeInstallingWorker();
    setEnv({ installing: worker });
    renderScreen();
    expect(screen.getByText(LOADING)).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    act(() => {
      worker.state = 'redundant';
      worker.dispatchEvent(new Event('statechange'));
    });
    expect(screen.getByText(STALLED)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(screen.getByText(LOADING)).toBeTruthy();
  });

  it('если сохранение 25 секунд стоит на месте, предлагает повторить, и повтор заново заводит отсчёт', async () => {
    vi.useFakeTimers();
    setEnv({ active: true, stored: 3, expected: 10 });
    renderScreen();
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.getByText(LOADING)).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(screen.getByText(STALLED)).toBeTruthy();

    act(() => screen.getByRole('button', { name: 'Повторить' }).click());
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(update).toHaveBeenCalled();
    expect(screen.getByText(LOADING)).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(screen.getByText(STALLED)).toBeTruthy();
  });

  it('после «Повторить» число файлов в sw.js запрашивается заново', async () => {
    setEnv({ online: false, swMissing: true });
    renderScreen();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByText('Нужен интернет для первой загрузки')).toBeTruthy();

    setEnv({ active: true, stored: 5, expected: 10 });
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await vi.waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50'));
  });
});
