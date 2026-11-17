import 'fake-indexeddb/auto';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessComError } from '../chesscom/api';
import { syncGames } from '../chesscom/sync';
import archives from '../chesscom/fixtures/archives.json';
import month from '../chesscom/fixtures/month.json';
import { db } from '../data/db';
import { changeNick, getChessUser, getGames, setChessUser } from '../data/gamesRepo';
import { GamesBackground, gamesQueue, syncNow, useGamesState } from './gamesStore';

vi.mock('../chesscom/sync', () => ({ syncGames: vi.fn() }));
const sync = vi.mocked(syncGames);

beforeEach(async () => {
  await db.delete();
  await db.open();
  sync.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncNow', () => {
  it('игрок не найден → error с текстом', async () => {
    sync.mockRejectedValue(new ChessComError('notFound', 'текст из ошибки не нужен'));
    const { result } = renderHook(() => useGamesState());
    await act(() => syncNow());
    expect(result.current.sync).toBe('error');
    expect(result.current.syncError).toBe('Игрок не найден');
  });

  it('нет сети → offline', async () => {
    sync.mockRejectedValue(new ChessComError('offline', 'Нет сети'));
    const { result } = renderHook(() => useGamesState());
    await act(() => syncNow());
    expect(result.current.sync).toBe('offline');
    expect(result.current.syncError).toBe('Нет сети, список не обновлён');
  });

  it('Chess.com не ответил → error без «ответил ошибкой»', async () => {
    sync.mockRejectedValue(new ChessComError('noAnswer', 'текст из ошибки не нужен'));
    const { result } = renderHook(() => useGamesState());
    await act(() => syncNow());
    expect(result.current.sync).toBe('error');
    expect(result.current.syncError).toBe('Не удалось связаться с Chess.com. Попробуй ещё раз.');
  });

  it('плохой ответ → error с причиной', async () => {
    sync.mockRejectedValue(new ChessComError('bad', 'Chess.com ответил кодом 500'));
    const { result } = renderHook(() => useGamesState());
    await act(() => syncNow());
    expect(result.current.sync).toBe('error');
    expect(result.current.syncError).toBe('Chess.com ответил ошибкой: код 500');
  });

  it('плохой ответ с другой причиной → причина без повтора начала', async () => {
    sync.mockRejectedValue(new ChessComError('bad', 'Неверный список месяцев'));
    const { result } = renderHook(() => useGamesState());
    await act(() => syncNow());
    expect(result.current.syncError).toBe('Chess.com ответил ошибкой: Неверный список месяцев');
  });

  it('успех → idle, revision вырос, ход загрузки виден', async () => {
    const seen: unknown[] = [];
    const { result } = renderHook(() => {
      const s = useGamesState();
      seen.push(s.syncProgress);
      return s;
    });
    sync.mockImplementation(async deps => {
      deps?.onProgress?.(1, 3);
      await new Promise(r => setTimeout(r, 0));
      return { added: 2 };
    });
    const before = result.current.revision;
    await act(() => syncNow());
    expect(seen).toContainEqual({ done: 1, total: 3 });
    expect(result.current.sync).toBe('idle');
    expect(result.current.syncError).toBeNull();
    expect(result.current.syncProgress).toBeNull();
    expect(result.current.revision).toBeGreaterThan(before);
  });

  it('И1: syncNow во время загрузки — ещё один проход сразу после текущего', async () => {
    let release = () => {};
    sync.mockImplementationOnce(() => new Promise(r => { release = () => r({ added: 0 }); }));
    sync.mockResolvedValue({ added: 0 });
    const first = syncNow();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    void syncNow();
    void syncNow();
    release();
    await act(() => first);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('И1: смена ника посреди загрузки — ник новый, партий прежнего нет, новый загружен целиком', async () => {
    const real = await vi.importActual<typeof import('../chesscom/sync')>('../chesscom/sync');
    // Разбор здесь ни при чём: очередь не трогаем.
    const refresh = vi.spyOn(gamesQueue, 'refresh').mockResolvedValue();
    const start = vi.spyOn(gamesQueue, 'start').mockImplementation(() => {});
    try {
      await setChessUser({ nick: 'owner_test', loadedThrough: null });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      const [a, b] = month.games;
      let changed = false;
      const fetchFn = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/games/archives')) return json(archives);
        const m = url.split('/').slice(-2).join('/');
        if (!changed && m === '2026/10') {
          changed = true;
          // Как в NickForm: прежние партии стёрты, ник новый, загрузка запрошена.
          await changeNick('rival_one');
          void syncNow();
        }
        return json({ games: [{ ...a, uuid: `${a.uuid}-${m}` }, { ...b, uuid: `${b.uuid}-${m}` }] });
      }) as typeof fetch;
      sync.mockImplementation(deps => real.syncGames({ ...deps, fetchFn }));
      await act(() => syncNow());
      expect(await getChessUser()).toEqual({ nick: 'rival_one', loadedThrough: '2026/11' });
      const games = await getGames();
      // у rival_one в каждом месяце одна партия: первая образца, он в ней чёрными
      expect(games.map(g => g.id).sort()).toEqual(['2026/09', '2026/10', '2026/11'].map(m => `${a.uuid}-${m}`));
      expect(games.every(g => g.userColor === 'black')).toBe(true);
    } finally {
      refresh.mockRestore();
      start.mockRestore();
    }
  });

  it('снимок состояния стабилен между изменениями', () => {
    const { result, rerender } = renderHook(() => useGamesState());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('GamesBackground', () => {
  it('без ника не делает запросов', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<GamesBackground />);
    await act(() => new Promise(r => setTimeout(r, 30)));
    expect(sync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('с ником загружает партии при монтировании', async () => {
    await setChessUser({ nick: 'owner_test', loadedThrough: null });
    sync.mockResolvedValue({ added: 0 });
    render(<GamesBackground />);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  });
});
