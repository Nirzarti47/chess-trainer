import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { changeNick, getChessUser, getGames, setChessUser } from '../data/gamesRepo';
import { syncGames } from './sync';
import archives from './fixtures/archives.json';
import month from './fixtures/month.json';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setChessUser({ nick: 'owner_test', loadedThrough: null });
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Подставной fetch: месяц → партии; записывает порядок начала и конца запросов. */
function makeFetch(opts: { failMonth?: string; log?: string[]; games?: (m: string) => unknown[] } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/games/archives')) return json(archives);
    const m = url.split('/').slice(-2).join('/');
    opts.log?.push(`start ${m}`);
    await new Promise(r => setTimeout(r, 5));
    opts.log?.push(`end ${m}`);
    if (m === opts.failMonth) throw new TypeError('Failed to fetch');
    return json({ games: opts.games ? opts.games(m) : [] });
  }) as typeof fetch;
}

// В каждом месяце свои uuid, чтобы партии разных месяцев не совпадали
const [a, b] = month.games;
const gamesOf = (m: string) => [
  { ...a, uuid: `${a.uuid}-${m}` },
  { ...b, uuid: `${b.uuid}-${m}` },
];

describe('syncGames', () => {
  it('первая загрузка идёт строго по очереди и ставит loadedThrough', async () => {
    const log: string[] = [];
    const res = await syncGames({ fetchFn: makeFetch({ log, games: gamesOf }) });
    expect(log).toEqual(['start 2026/09', 'end 2026/09', 'start 2026/10', 'end 2026/10', 'start 2026/11', 'end 2026/11']);
    expect(res.added).toBe(6);
    expect((await getChessUser())!.loadedThrough).toBe('2026/11');
  });

  it('повторная загрузка запрашивает только последний месяц', async () => {
    await syncGames({ fetchFn: makeFetch({ games: gamesOf }) });
    const log: string[] = [];
    const res = await syncGames({ fetchFn: makeFetch({ log, games: gamesOf }) });
    expect(log).toEqual(['start 2026/11', 'end 2026/11']);
    expect(res.added).toBe(0);
  });

  it('сбой на втором месяце сохраняет первый и не создаёт дублей при повторе', async () => {
    await expect(syncGames({ fetchFn: makeFetch({ failMonth: '2026/10', games: gamesOf }) }))
      .rejects.toMatchObject({ kind: 'offline' });
    expect((await getGames()).length).toBe(2);
    expect((await getChessUser())!.loadedThrough).toBe('2026/09');

    const log: string[] = [];
    await syncGames({ fetchFn: makeFetch({ log, games: gamesOf }) });
    expect(log.filter(l => l.startsWith('start'))).toEqual(['start 2026/09', 'start 2026/10', 'start 2026/11']);
    expect((await getGames()).length).toBe(6);
  });

  it('негодная партия пропускается, годная сохраняется', async () => {
    await syncGames({ fetchFn: makeFetch({ games: m => (m === '2026/09' ? [a, month.games[4]] : []) }) });
    expect((await getGames()).map(g => g.id)).toEqual([a.uuid]);
  });

  it('И1: ник сменили между месяцами — загрузка останавливается без записи', async () => {
    const base = makeFetch({ games: gamesOf });
    const fetchFn = (async (input: RequestInfo | URL) => {
      // ник сменили, пока шёл запрос второго месяца прежнего ника
      if (String(input).endsWith('/2026/10')) await changeNick('rival_one');
      return base(input);
    }) as typeof fetch;
    await syncGames({ fetchFn });
    expect(await getChessUser()).toEqual({ nick: 'rival_one', loadedThrough: null });
    expect(await getGames()).toEqual([]);
  });

  it('И1: ник сменили и вернули прежний посреди загрузки — загрузка не продолжает с середины', async () => {
    const base = makeFetch({ games: gamesOf });
    const fetchFn = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/2026/10')) {
        await changeNick('rival_one');
        await changeNick('owner_test');
      }
      return base(input);
    }) as typeof fetch;
    await syncGames({ fetchFn });
    // следующая загрузка начнёт с первого месяца, а не с 2026/10
    expect(await getChessUser()).toEqual({ nick: 'owner_test', loadedThrough: null });
    expect(await getGames()).toEqual([]);
  });

  it('без ника ничего не запрашивает', async () => {
    await db.kv.clear();
    const fetchFn = (async () => { throw new Error('не должно быть запросов'); }) as typeof fetch;
    expect(await syncGames({ fetchFn })).toEqual({ added: 0 });
  });
});
