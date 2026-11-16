import 'fake-indexeddb/auto';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessComError } from '../chesscom/api';
import { syncGames } from '../chesscom/sync';
import { db } from '../data/db';
import { setChessUser } from '../data/gamesRepo';
import { GamesBackground, syncNow, useGamesState } from './gamesStore';

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
