import { CONFIG } from './config';
import type { GameAnalysis, GameRecord, Grade, MistakeKind, MoveReview, SideSummary, TimeClass } from '../domain/gameTypes';
import { countKinds, gamesInRange, RANGE_OPTIONS, tooFew, trainKinds } from './patterns';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 15, 12);

function game(id: string, endTime: number, timeClass: TimeClass = 'rapid', userColor: GameRecord['userColor'] = 'white'): GameRecord {
  return {
    id, url: `https://www.chess.com/game/live/${id}`, endTime, timeClass, timeControl: '600', userColor,
    userRating: 800, opponent: 'rival_one', opponentRating: 820, result: 'loss', endReason: 'resigned', moves: [],
  };
}

const side: SideSummary = {
  grades: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, brilliant: 0, great: 0, accuracy: 70, kinds: {},
};

const move = (ply: number, grade: Grade, kind?: MistakeKind): MoveReview =>
  ({ ply, move: 'e2e4', loss: 0.3, grade, kind, best: [], deep: false });

const analysis = (gameId: string, moves: MoveReview[], rulesVersion: number = CONFIG.RULES_VERSION): GameAnalysis =>
  ({ gameId, rulesVersion, analysedAt: 1, tookMs: 1, scores: [], moves, white: side, black: side });

describe('RANGE_OPTIONS', () => {
  it('семь вариантов с подписями', () => {
    expect(RANGE_OPTIONS.map((o) => o.label)).toEqual(['Последние 10', 'Последние 20', 'Последние 50',
      'За неделю', 'За месяц', 'За три месяца', 'За всё время']);
  });
});

describe('gamesInRange', () => {
  // 30 рапидов раз в сутки и 10 блицев, все в перемешку.
  const rapids = Array.from({ length: 30 }, (_, i) => game(`r${i}`, NOW - i * DAY - 1000));
  const blitzes = Array.from({ length: 10 }, (_, i) => game(`b${i}`, NOW - i * DAY - 500, 'blitz'));
  const all = [...blitzes, ...rapids.slice().reverse()];

  it('по числу: 20 самых новых рапидов, от новых к старым', () => {
    expect(gamesInRange(all, { by: 'count', n: 20 }, NOW).map((g) => g.id))
      .toEqual(rapids.slice(0, 20).map((g) => g.id));
  });

  it('за неделю: только партии не старше 7 суток', () => {
    const ids = gamesInRange(all, { by: 'time', span: 'week' }, NOW).map((g) => g.id);
    expect(ids).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
    const edge = [game('in', NOW - 7 * DAY), game('out', NOW - 7 * DAY - 1)];
    expect(gamesInRange(edge, { by: 'time', span: 'week' }, NOW).map((g) => g.id)).toEqual(['in']);
  });

  it('месяц — 30 суток, три месяца — 90', () => {
    const gs = [game('d29', NOW - 29 * DAY), game('d31', NOW - 31 * DAY), game('d89', NOW - 89 * DAY), game('d91', NOW - 91 * DAY)];
    expect(gamesInRange(gs, { by: 'time', span: 'month' }, NOW).map((g) => g.id)).toEqual(['d29']);
    expect(gamesInRange(gs, { by: 'time', span: 'quarter' }, NOW).map((g) => g.id)).toEqual(['d29', 'd31', 'd89']);
  });

  it('daily входит, blitz и bullet нет; «за всё время» — все rapid и daily', () => {
    const gs = [game('old', 1000, 'daily'), game('bl', NOW, 'blitz'), game('bu', NOW, 'bullet'), game('ra', NOW - DAY)];
    expect(gamesInRange(gs, { by: 'time', span: 'all' }, NOW).map((g) => g.id)).toEqual(['ra', 'old']);
    expect(gamesInRange(gs, { by: 'count', n: 10 }, NOW).map((g) => g.id)).toEqual(['ra', 'old']);
  });
});

describe('countKinds', () => {
  it('только ходы владельца с ошибкой или грубой ошибкой, по убыванию числа', () => {
    const white = game('w', NOW);
    const black = game('k', NOW, 'rapid', 'black');
    const counts = countKinds([white, black], [
      analysis('w', [
        move(0, 'mistake', 'missedMate'), move(1, 'blunder', 'pieceEnPrise') /* ход соперника */,
        move(2, 'blunder', 'pieceEnPrise'), move(4, 'inaccuracy'), move(6, 'mistake', 'pieceEnPrise'),
      ]),
      analysis('k', [
        move(0, 'blunder', 'missedFork') /* ход соперника */, move(1, 'mistake', 'missedFork'),
        move(3, 'blunder', 'pieceEnPrise'), move(5, 'good'),
      ]),
      // Партии нет в промежутке — не считается.
      analysis('x', [move(0, 'blunder', 'badTrade')]),
    ]);
    expect(counts).toEqual([
      { kind: 'pieceEnPrise', count: 3 }, { kind: 'missedMate', count: 1 }, { kind: 'missedFork', count: 1 },
    ]);
  });

  it('при равенстве — порядок объявления видов; устаревший разбор не считается', () => {
    const counts = countKinds([game('a', NOW), game('b', NOW)], [
      analysis('a', [move(0, 'mistake', 'other'), move(2, 'mistake', 'missedFork'), move(4, 'mistake', 'allowedMate')]),
      analysis('b', [move(0, 'blunder', 'badTrade')], CONFIG.RULES_VERSION + 1),
    ]);
    expect(counts.map((c) => c.kind)).toEqual(['allowedMate', 'missedFork', 'other']);
  });

  it('«пропущен сильный шах» считается и при равенстве идёт перед other, после badTrade', () => {
    const counts = countKinds([game('a', NOW)], [
      analysis('a', [move(0, 'mistake', 'other'), move(2, 'mistake', 'missedCheck'), move(4, 'blunder', 'badTrade')]),
    ]);
    expect(counts.map((c) => c.kind)).toEqual(['badTrade', 'missedCheck', 'other']);
    expect(trainKinds(counts)).toEqual(['badTrade', 'missedCheck']);
  });
});

describe('tooFew', () => {
  it('меньше трёх партий или меньше десяти ошибок', () => {
    expect(tooFew(2, 50)).toBe(true);
    expect(tooFew(3, 9)).toBe(true);
    expect(tooFew(3, 10)).toBe(false);
  });
});

describe('trainKinds', () => {
  it('до трёх самых частых, кроме other', () => {
    expect(trainKinds([
      { kind: 'pieceEnPrise', count: 9 }, { kind: 'other', count: 7 }, { kind: 'missedMate', count: 4 },
      { kind: 'missedCapture', count: 2 }, { kind: 'missedFork', count: 1 },
    ])).toEqual(['pieceEnPrise', 'missedMate', 'missedCapture']);
  });

  it('только other — [other]', () => {
    expect(trainKinds([{ kind: 'other', count: 5 }])).toEqual(['other']);
  });
});
