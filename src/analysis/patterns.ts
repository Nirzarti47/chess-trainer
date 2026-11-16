// «Частые ошибки»: промежуток партий и подсчёт видов ошибок владельца. Без базы и React.
import type { GameAnalysis, GameRecord, MistakeKind, RangeChoice } from '../domain/gameTypes';
import { CONFIG } from './config';
import { KIND_TITLE } from './phrases';

export const RANGE_OPTIONS: { choice: RangeChoice; label: string }[] = [
  { choice: { by: 'count', n: 10 }, label: 'Последние 10' },
  { choice: { by: 'count', n: 20 }, label: 'Последние 20' },
  { choice: { by: 'count', n: 50 }, label: 'Последние 50' },
  { choice: { by: 'time', span: 'week' }, label: 'За неделю' },
  { choice: { by: 'time', span: 'month' }, label: 'За месяц' },
  { choice: { by: 'time', span: 'quarter' }, label: 'За три месяца' },
  { choice: { by: 'time', span: 'all' }, label: 'За всё время' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const SPAN_DAYS = { week: 7, month: 30, quarter: 90 } as const;
/** Порядок объявления видов: KIND_TITLE перечисляет их в порядке MistakeKind. */
const KIND_ORDER = Object.keys(KIND_TITLE) as MistakeKind[];

/** Только rapid и daily, от новых к старым. Неделя — 7 дней, месяц — 30, три месяца — 90 от now. */
export function gamesInRange(games: GameRecord[], range: RangeChoice, now: number): GameRecord[] {
  const slow = games.filter((g) => g.timeClass === 'rapid' || g.timeClass === 'daily')
    .sort((a, b) => b.endTime - a.endTime);
  if (range.by === 'count') return slow.slice(0, range.n);
  if (range.span === 'all') return slow;
  const from = now - SPAN_DAYS[range.span] * DAY_MS;
  return slow.filter((g) => g.endTime >= from);
}

/** Ошибки и грубые ошибки владельца по видам, по убыванию числа; при равенстве — порядок объявления MistakeKind.
 *  Считаются только разборы нынешней версии правил и только партий из games. */
export function countKinds(games: GameRecord[], analyses: GameAnalysis[]): { kind: MistakeKind; count: number }[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  const counts = new Map<MistakeKind, number>();
  for (const a of analyses) {
    const game = byId.get(a.gameId);
    if (!game || a.rulesVersion !== CONFIG.RULES_VERSION) continue;
    const ownerParity = game.userColor === 'white' ? 0 : 1;
    for (const m of a.moves) {
      if (m.ply % 2 !== ownerParity || (m.grade !== 'mistake' && m.grade !== 'blunder')) continue;
      const kind = m.kind ?? 'other';
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return KIND_ORDER.filter((k) => counts.has(k)).map((kind) => ({ kind, count: counts.get(kind)! }))
    .sort((a, b) => b.count - a.count);
}

/** Мало данных для выводов: меньше FEW_GAMES разобранных партий или меньше FEW_MISTAKES ошибок. */
export function tooFew(analysedGames: number, mistakes: number): boolean {
  return analysedGames < CONFIG.FEW_GAMES || mistakes < CONFIG.FEW_MISTAKES;
}

/** Сколько видов идёт в тренировку. */
const TRAIN_KINDS = 3;

/** До трёх самых частых видов, кроме 'other'; если других нет — ['other']. */
export function trainKinds(counts: { kind: MistakeKind; count: number }[]): MistakeKind[] {
  const kinds = counts.filter((c) => c.kind !== 'other' && c.count > 0).slice(0, TRAIN_KINDS).map((c) => c.kind);
  return kinds.length > 0 ? kinds : ['other'];
}
