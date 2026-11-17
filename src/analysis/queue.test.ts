import 'fake-indexeddb/auto';
import { Chess } from 'chess.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../data/db';
import * as repo from '../data/gamesRepo';
import { changeNick, getAnalysis, getGamePuzzles, putGames, saveAnalysis } from '../data/gamesRepo';
import type { GameAnalysis, GameRecord, SideSummary, TimeClass } from '../domain/gameTypes';
import type { AnalysisEngine, AnalysisPriority } from '../engine/analysisEngine';
import { CONFIG } from './config';
import { createAnalysisQueue, ENGINE_FAILED, type AnalysisQueue } from './queue';
import { tableEngine } from './testEngine';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CYCLE = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];

const game = (id: string, endTime: number, timeClass: TimeClass = 'rapid', moves = CYCLE): GameRecord => ({
  id, url: `https://www.chess.com/game/live/${id}`, endTime, timeClass, timeControl: '600',
  userColor: 'white', userRating: 800, opponent: 'rival_one', opponentRating: 790,
  result: 'win', endReason: 'resigned', moves,
});

const summary = (): SideSummary => ({
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 0, kinds: {},
});

const analysis = (gameId: string, rulesVersion: number): GameAnalysis => ({
  gameId, rulesVersion, analysedAt: 1, tookMs: 1, scores: [], moves: [], white: summary(), black: summary(),
});

/** Движок по таблице, который запоминает приоритет и даёт вмешаться перед ответом. */
function spyEngine(before?: (fen: string) => void) {
  const inner = tableEngine({});
  const calls: { fen: string; priority: AnalysisPriority }[] = [];
  const engine: Pick<AnalysisEngine, 'analyse'> = {
    async analyse(fen, opts) {
      calls.push({ fen, priority: opts.priority });
      before?.(fen);
      // ответ приходит не сразу, как у настоящего движка
      await new Promise(r => setTimeout(r, 0));
      return inner.analyse(fen, opts);
    },
  };
  return { engine, calls };
}

/** Очередь с управляемой видимостью. */
function makeQueue(engine: Pick<AnalysisEngine, 'analyse'>) {
  let visible = true;
  const handlers = new Set<() => void>();
  const queue = createAnalysisQueue({
    engine,
    isVisible: () => visible,
    onVisibilityChange(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
  });
  const setVisible = (v: boolean) => {
    visible = v;
    for (const fn of [...handlers]) fn();
  };
  return { queue, setVisible };
}

/** Порядок партий, которые брались в разбор (по первому появлению в running). */
function trackRuns(queue: AnalysisQueue): string[] {
  const order: string[] = [];
  queue.subscribe(() => {
    const id = queue.status().running?.gameId;
    if (id && order[order.length - 1] !== id) order.push(id);
  });
  return order;
}

const idle = (queue: AnalysisQueue, analysed: number) => vi.waitFor(() => {
  expect(queue.status().running).toBeNull();
  expect(queue.status().analysed).toBe(analysed);
}, { timeout: 5000 });

const rapidIds = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

describe('очередь разбора', () => {
  it('start разбирает 20 самых новых партий рапида, блиц не трогает', async () => {
    // r0 — самая новая партия рапида; блиц ещё новее
    await putGames([
      ...rapidIds(25).map((id, i) => game(id, 1000 - i)),
      ...Array.from({ length: 5 }, (_, i) => game(`b${i}`, 2000 + i, 'blitz')),
    ]);
    const { engine } = spyEngine();
    const { queue } = makeQueue(engine);
    queue.start();
    await idle(queue, 20);
    expect(queue.status().total).toBe(30);
    const done = (await db.analyses.toArray()).map(a => a.gameId).sort();
    expect(done).toEqual(rapidIds(20).sort());
  });

  it('по переписке разбирается вместе с рапидом, пуля — нет', async () => {
    await putGames([game('d', 300, 'daily'), game('p', 200, 'bullet')]);
    const { queue } = makeQueue(spyEngine().engine);
    queue.start();
    await idle(queue, 1);
    expect(await getAnalysis('d')).toBeDefined();
    expect(await getAnalysis('p')).toBeUndefined();
  });

  it('open разбирает блиц с приоритетом screen и возвращает разбор', async () => {
    await putGames([game('b', 100, 'blitz')]);
    const { engine, calls } = spyEngine();
    const { queue } = makeQueue(engine);
    const a = await queue.open('b');
    expect(a?.gameId).toBe('b');
    expect(a?.rulesVersion).toBe(CONFIG.RULES_VERSION);
    expect(await getAnalysis('b')).toEqual(a);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(c => c.priority === 'screen')).toBe(true);
    expect(queue.status().analysed).toBe(1);
  });

  it('open партии с готовым разбором текущей версии не вызывает движок', async () => {
    await putGames([game('a', 100)]);
    const ready = analysis('a', CONFIG.RULES_VERSION);
    await saveAnalysis(ready, { put: [], removeIds: [] });
    const { engine, calls } = spyEngine();
    const { queue } = makeQueue(engine);
    expect(await queue.open('a')).toEqual(ready);
    expect(calls).toHaveLength(0);
  });

  it('open неизвестной партии → null', async () => {
    const { queue } = makeQueue(spyEngine().engine);
    expect(await queue.open('nope')).toBeNull();
  });

  it('два open одной партии подряд — один результат, один счёт', async () => {
    await putGames([game('b', 100, 'blitz')]);
    const { engine, calls } = spyEngine();
    const { queue } = makeQueue(engine);
    const [x, y] = await Promise.all([queue.open('b'), queue.open('b')]);
    expect(x).not.toBeNull();
    expect(y).toBe(x);
    expect(calls).toHaveLength(CYCLE.length + 1);
  });

  it('open посреди фонового разбора другой партии: сначала открытая, прерванная считается потом', async () => {
    await putGames([game('r', 200), game('b', 100, 'blitz')]);
    let opened = null as Promise<GameAnalysis | null> | null;
    let queue!: AnalysisQueue;
    const { engine } = spyEngine(() => {
      if (!opened && queue.status().running?.gameId === 'r') opened = queue.open('b');
    });
    queue = makeQueue(engine).queue;
    const order = trackRuns(queue);
    queue.start();
    await idle(queue, 2);
    expect((await opened)?.gameId).toBe('b');
    expect(order).toEqual(['r', 'b', 'r']);
    expect(queue.status().lastError).toBeNull();
  });

  it('при скрытом приложении open ждёт возвращения', async () => {
    await putGames([game('b', 100, 'blitz')]);
    const { engine, calls } = spyEngine();
    const { queue, setVisible } = makeQueue(engine);
    setVisible(false);
    let result: GameAnalysis | null | undefined;
    void queue.open('b').then(a => { result = a; });
    await new Promise(r => setTimeout(r, 30));
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(0);
    setVisible(true);
    await vi.waitFor(() => expect(result?.gameId).toBe('b'));
  });

  it('партия из setRange вне последних 20 разбирается раньше автоматических', async () => {
    await putGames(rapidIds(25).map((id, i) => game(id, 1000 - i)));
    const { queue } = makeQueue(spyEngine().engine);
    const order = trackRuns(queue);
    queue.setRange(['r24']);
    queue.start();
    await idle(queue, 21);
    expect(order[0]).toBe('r24');
    expect(order.slice(1)).toEqual(rapidIds(20));
  });

  it('разбор старой версии среди последних партий пересчитывается по порядку от новых; задача со сменившимся ходом удалена с повторением', async () => {
    await putGames([game('old', 500), game('n1', 400), game('n2', 300)]);
    await saveAnalysis(analysis('old', CONFIG.RULES_VERSION - 1), {
      put: [{ id: 'g:old:2', gameId: 'old', ply: 2, endTime: 500, fen: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
        moves: ['g8f6', 'd2d4'], kind: 'other', phrase: 'Фраза', loss: 0.3 }],
      removeIds: [],
    });
    await db.reviews.put({ puzzleId: 'g:old:2', stage: 1, dueDay: '2026-11-20' });
    const { queue } = makeQueue(spyEngine().engine);
    const order = trackRuns(queue);
    queue.start();
    await idle(queue, 3);
    expect(order).toEqual(['old', 'n1', 'n2']);
    expect((await getAnalysis('old'))!.rulesVersion).toBe(CONFIG.RULES_VERSION);
    expect(await getGamePuzzles('old')).toEqual([]);
    expect(await db.reviews.get('g:old:2')).toBeUndefined();
  });

  it('Л3: самая новая партия промежутка с устаревшим разбором идёт раньше неразобранных', async () => {
    await putGames([game('a', 500), game('b', 400), game('c', 300)]);
    await saveAnalysis(analysis('a', CONFIG.RULES_VERSION - 1), { put: [], removeIds: [] });
    const { queue } = makeQueue(spyEngine().engine);
    const order = trackRuns(queue);
    queue.setRange(['a', 'b', 'c']);
    queue.start();
    await idle(queue, 3);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('скрытие посреди партии отменяет разбор; после возвращения партия разобрана', async () => {
    await putGames([game('a', 100)]);
    let hide = () => {};
    let n = 0;
    const { engine } = spyEngine(() => {
      if (++n === 3) hide();
    });
    const { queue, setVisible } = makeQueue(engine);
    hide = () => setVisible(false);
    queue.start();
    await vi.waitFor(() => expect(n).toBe(3));
    await vi.waitFor(() => expect(queue.status().running).toBeNull());
    expect(await getAnalysis('a')).toBeUndefined();
    setVisible(true);
    await idle(queue, 1);
    expect(await getAnalysis('a')).toBeDefined();
    expect(queue.status().lastError).toBeNull();
  });

  it('движок молчит по одной партии: остальные разобраны, она исключена после двух попыток', async () => {
    const badMoves = ['a2a3', 'a7a6', 'a3a4', 'a6a5'];
    const chess = new Chess();
    chess.move('a3');
    const silent = chess.fen();
    await putGames([game('bad', 300, 'rapid', badMoves), game('g1', 200), game('g2', 100)]);
    const inner = tableEngine({});
    let calls = 0;
    const engine: Pick<AnalysisEngine, 'analyse'> = {
      async analyse(fen, opts) {
        calls++;
        return fen === silent ? null : inner.analyse(fen, opts);
      },
    };
    const { queue } = makeQueue(engine);
    const order = trackRuns(queue);
    queue.start();
    await vi.waitFor(() => {
      expect(queue.status().lastError).toBe(ENGINE_FAILED);
      expect(queue.status().running).toBeNull();
    }, { timeout: 5000 });
    expect(queue.status().analysed).toBe(2);
    expect(order).toEqual(['bad', 'g1', 'g2', 'bad']);
    // две попытки по два запроса + две партии по пять позиций
    expect(calls).toBe(2 * 2 + 2 * (CYCLE.length + 1));
    await new Promise(r => setTimeout(r, 30));
    expect(calls).toBe(14);
    // И2: refresh и start забывают неудачи — исключённая партия снова получает две попытки
    await queue.refresh();
    await vi.waitFor(() => expect(calls).toBe(18));
    queue.start();
    await vi.waitFor(() => expect(calls).toBe(22));
    await new Promise(r => setTimeout(r, 30));
    expect(calls).toBe(22);
    expect(queue.status().analysed).toBe(2);
  });

  it('И2: движок на паузе — партии не исключаются, цикл ждёт и после паузы разбирает', async () => {
    await putGames([game('a', 200), game('b', 100), game('x', 50, 'blitz')]);
    const inner = tableEngine({});
    let end = () => {};
    let pause: Promise<void> | null = new Promise<void>(r => {
      end = () => {
        pause = null;
        r();
      };
    });
    let calls = 0;
    const engine: Pick<AnalysisEngine, 'analyse' | 'paused'> = {
      async analyse(fen, opts) {
        calls++;
        return pause ? null : inner.analyse(fen, opts);
      },
      paused: () => pause,
    };
    const { queue } = makeQueue(engine);
    queue.start();
    await vi.waitFor(() => {
      expect(queue.status().lastError).toBe(ENGINE_FAILED);
      expect(queue.status().running).toBeNull();
    });
    // открытая партия на паузе сразу получает null, а не ждёт минуту
    expect(await queue.open('x')).toBeNull();
    await new Promise(r => setTimeout(r, 30));
    // фон стоит, а не проваливает партии одну за другой
    expect(calls).toBe(2);
    end();
    await idle(queue, 2);
    expect((await db.analyses.toArray()).map(a => a.gameId).sort()).toEqual(['a', 'b']);
    expect(queue.status().lastError).toBeNull();
  });

  it('refresh снимает текст прошлого сбоя: «Повторить» не оставляет старую ошибку', async () => {
    await putGames([game('x', 50, 'blitz')]);
    const { queue } = makeQueue({ analyse: async () => null });
    queue.start();
    expect(await queue.open('x')).toBeNull();
    expect(queue.status().lastError).toBe(ENGINE_FAILED);
    await queue.refresh();
    expect(queue.status().lastError).toBeNull();
  });

  it('И2: lastError сбрасывается при успешном разборе', async () => {
    await putGames([game('a', 200), game('b', 100)]);
    const inner = tableEngine({});
    let n = 0;
    const engine: Pick<AnalysisEngine, 'analyse'> = {
      analyse: async (fen, opts) => (++n === 1 ? null : inner.analyse(fen, opts)),
    };
    const { queue } = makeQueue(engine);
    const errors: (string | null)[] = [];
    queue.subscribe(() => errors.push(queue.status().lastError));
    queue.start();
    await idle(queue, 2);
    expect(errors).toContain(ENGINE_FAILED);
    expect(queue.status().lastError).toBeNull();
  });

  it('первая же неудача партии ставит текст ошибки: open получает null, текст уже на месте', async () => {
    await putGames([game('b', 100, 'blitz')]);
    const engine: Pick<AnalysisEngine, 'analyse'> = { analyse: async () => null };
    const { queue } = makeQueue(engine);
    expect(await queue.open('b')).toBeNull();
    expect(queue.status().lastError).toBe(ENGINE_FAILED);
  });

  it('партию дважды подряд прерывает потеря видимости: сбоем это не считается', async () => {
    await putGames([game('a', 100)]);
    let hide = () => {};
    let n = 0;
    const { engine } = spyEngine(() => {
      // третий запрос первой попытки и третий запрос второй
      if (++n === 3 || n === 6) hide();
    });
    const { queue, setVisible } = makeQueue(engine);
    hide = () => setVisible(false);
    queue.start();
    await vi.waitFor(() => expect(n).toBe(3));
    await vi.waitFor(() => expect(queue.status().running).toBeNull());
    setVisible(true);
    await vi.waitFor(() => {
      expect(n).toBeGreaterThanOrEqual(6);
      expect(queue.status().running).toBeNull();
    });
    expect(await getAnalysis('a')).toBeUndefined();
    setVisible(true);
    await idle(queue, 1);
    expect(await getAnalysis('a')).toBeDefined();
    expect(queue.status().lastError).toBeNull();
  });

  it('прерванная open другой партии не уходит в конец очереди', async () => {
    await putGames([game('r1', 200), game('r2', 100), game('b', 50, 'blitz')]);
    let opened = null as Promise<GameAnalysis | null> | null;
    let queue!: AnalysisQueue;
    const { engine } = spyEngine(() => {
      if (!opened && queue.status().running?.gameId === 'r1') opened = queue.open('b');
    });
    queue = makeQueue(engine).queue;
    const order = trackRuns(queue);
    queue.start();
    await idle(queue, 3);
    expect((await opened)?.gameId).toBe('b');
    expect(order).toEqual(['r1', 'b', 'r1', 'r2']);
    expect(queue.status().lastError).toBeNull();
  });

  it('refresh, чьё чтение базы перекрылось с сохранением разбора, не вызывает повторный разбор', async () => {
    await putGames([game('a', 100)]);
    const real = repo.getAnalyses;
    let reads = 0;
    let release = () => {};
    const gate = new Promise<void>(r => { release = r; });
    // чтение refresh берёт данные до сохранения, а возвращает их после
    vi.spyOn(repo, 'getAnalyses').mockImplementation(async () => {
      const rows = await real();
      if (++reads === 2) await gate;
      return rows;
    });
    let queue!: AnalysisQueue;
    let refreshing: Promise<void> | null = null;
    let n = 0;
    const { engine, calls } = spyEngine(() => {
      if (++n === 2) refreshing = queue.refresh();
    });
    queue = makeQueue(engine).queue;
    const analysedSeen: number[] = [];
    queue.subscribe(() => analysedSeen.push(queue.status().analysed));
    queue.start();
    await vi.waitFor(async () => expect(await getAnalysis('a')).toBeDefined());
    await idle(queue, 1);
    const callsAfterAnalysis = calls.length;
    release();
    await refreshing;
    await new Promise(r => setTimeout(r, 30));
    expect(reads).toBe(2);
    expect(calls).toHaveLength(callsAfterAnalysis);
    expect(queue.status().analysed).toBe(1);
    expect(Math.min(...analysedSeen.slice(analysedSeen.lastIndexOf(1)))).toBe(1);
  });

  it('И1: смена ника — reset забывает разборы сеанса: общая партия у нового ника разбирается заново', async () => {
    await putGames([game('a', 100)]);
    const { queue } = makeQueue(spyEngine().engine);
    queue.start();
    await idle(queue, 1);
    // партия есть и у прежнего, и у нового ника: после смены ника её разбора в базе нет
    await changeNick('rival_one');
    await putGames([game('a', 100)]);
    await queue.reset();
    await idle(queue, 1);
    expect(await getAnalysis('a')).toBeDefined();
  });

  it('сбой чтения базы: open возвращает null, следующий open читает заново и разбирает', async () => {
    await putGames([game('a', 100, 'blitz')]);
    vi.spyOn(repo, 'getGames').mockRejectedValueOnce(new Error('база недоступна'));
    const { queue } = makeQueue(spyEngine().engine);
    expect(await queue.open('a')).toBeNull();
    // М3: причина сбоя базы — своим текстом
    expect(queue.status().lastError).toBe('Не удалось прочитать партии: Error: база недоступна');
    expect((await queue.open('a'))?.gameId).toBe('a');
    expect(queue.status().analysed).toBe(1);
    expect(queue.status().lastError).toBeNull();
  });

  it('М3: сбой базы при сохранении разбора — свой текст, а не «движок не ответил»', async () => {
    await putGames([game('b', 100, 'blitz')]);
    vi.spyOn(repo, 'saveAnalysis').mockRejectedValueOnce(new Error('диск полон'));
    const { queue } = makeQueue(spyEngine().engine);
    expect(await queue.open('b')).toBeNull();
    expect(queue.status().lastError).toBe('Не удалось сохранить разбор: Error: диск полон');
  });

  it('подписчик слышит смену running и analysed; снимок стабилен между изменениями', async () => {
    await putGames([game('a', 100)]);
    const { queue } = makeQueue(spyEngine().engine);
    expect(queue.status()).toBe(queue.status());
    const seen: { running: string | null; analysed: number }[] = [];
    const off = queue.subscribe(() => {
      const s = queue.status();
      seen.push({ running: s.running?.gameId ?? null, analysed: s.analysed });
    });
    queue.start();
    await idle(queue, 1);
    off();
    expect(seen).toContainEqual({ running: 'a', analysed: 0 });
    expect(seen[seen.length - 1]).toEqual({ running: null, analysed: 1 });
    expect(queue.status()).toBe(queue.status());
  });
});
