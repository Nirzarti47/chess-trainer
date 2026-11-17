import { describe, expect, it, vi } from 'vitest';
import { ChessComError, fetchArchives, fetchPlayer, normalizeNick, toGameRecord } from './api';
import archives from './fixtures/archives.json';
import month from './fixtures/month.json';

const [a, b, c, d, e] = month.games;

const reply = (status: number, body: unknown = {}): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('normalizeNick', () => {
  it('обрезает пробелы и приводит к нижнему регистру', () => {
    expect(normalizeNick(' Owner_Test ')).toBe('owner_test');
  });
});

describe('toGameRecord', () => {
  it('победа белыми матом', () => {
    const r = toGameRecord(a, 'owner_test')!;
    expect(r.userColor).toBe('white');
    expect(r.result).toBe('win');
    expect(r.endReason).toBe('checkmated');
    expect(r.moves).toEqual(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    expect(r.endTime).toBe(a.end_time * 1000);
    expect(r.timeClass).toBe('rapid');
    expect(r.opponent).toBe('rival_one');
  });

  it('поражение чёрными', () => {
    const r = toGameRecord(b, 'owner_test')!;
    expect(r.userColor).toBe('black');
    expect(r.result).toBe('loss');
    expect(r.endReason).toBe('resigned');
  });

  it('ничья по согласию', () => {
    const r = toGameRecord(c, 'owner_test')!;
    expect(r.result).toBe('draw');
    expect(r.endReason).toBe('agreed');
  });

  it('неподходящие партии дают null', () => {
    expect(toGameRecord(d, 'owner_test')).toBeNull();
    expect(toGameRecord(e, 'owner_test')).toBeNull();
    expect(toGameRecord({ ...a, uuid: undefined }, 'owner_test')).toBeNull();
    expect(toGameRecord(null, 'owner_test')).toBeNull();
    expect(toGameRecord('строка', 'owner_test')).toBeNull();
    expect(toGameRecord(a, 'someone_else')).toBeNull();
  });

  it('партия с заголовком SetUp и короткая партия дают null', () => {
    const setUp = { ...a, pgn: '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 e5 2. Nf3 *' };
    expect(toGameRecord(setUp, 'owner_test')).toBeNull();
    expect(toGameRecord({ ...a, pgn: '1. e4 *' }, 'owner_test')).toBeNull();
  });
});

describe('запросы', () => {
  it('fetchPlayer: 404 — notFound', async () => {
    await expect(fetchPlayer('nobody', reply(404))).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('fetchPlayer: TypeError от fetch — offline', async () => {
    const failing = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    const err = await fetchPlayer('owner_test', failing).catch(x => x);
    expect(err).toBeInstanceOf(ChessComError);
    expect(err.kind).toBe('offline');
  });

  it('другой статус — bad', async () => {
    await expect(fetchPlayer('owner_test', reply(500))).rejects.toMatchObject({ kind: 'bad' });
  });

  it('fetchArchives возвращает месяцы по возрастанию', async () => {
    expect(await fetchArchives('owner_test', reply(200, archives))).toEqual(['2026/09', '2026/10', '2026/11']);
  });

  it('fetchArchives: неверная форма ответа — bad', async () => {
    await expect(fetchArchives('owner_test', reply(200, { x: 1 }))).rejects.toMatchObject({ kind: 'bad' });
  });

  it('fetchArchives: адрес с посторонним хвостом молча отбрасывается', async () => {
    const list = { archives: [
      'https://api.chess.com/pub/player/owner_test/games/2026/10',
      'https://api.chess.com/pub/player/owner_test/games/2026/11?x=../../../other',
      'https://api.chess.com/pub/player/owner_test/games/2026/09',
    ] };
    expect(await fetchArchives('owner_test', reply(200, list))).toEqual(['2026/09', '2026/10']);
  });

  it('fetch бросает не TypeError (DOMException), сеть есть — Chess.com не ответил', async () => {
    const failing = (async () => { throw new DOMException('Отказано', 'SecurityError'); }) as typeof fetch;
    const err = await fetchPlayer('owner_test', failing).catch(x => x);
    expect(err).toBeInstanceOf(ChessComError);
    expect(err.kind).toBe('noAnswer');
    expect(err.message).toBe('Не удалось связаться с Chess.com. Попробуй ещё раз.');
  });

  it('fetch бросает, а сеть за время запроса пропала — offline', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get');
    try {
      const failing = (async () => {
        onLine.mockReturnValue(false);
        throw new DOMException('Прервано', 'NetworkError');
      }) as typeof fetch;
      const err = await fetchPlayer('owner_test', failing).catch(x => x);
      expect(err).toBeInstanceOf(ChessComError);
      expect(err.kind).toBe('offline');
    } finally {
      onLine.mockRestore();
    }
  });

  it('navigator.onLine === false — offline без запроса', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const fetchFn = vi.fn(reply(200));
      await expect(fetchPlayer('owner_test', fetchFn)).rejects.toMatchObject({ kind: 'offline' });
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      onLine.mockRestore();
    }
  });
});
