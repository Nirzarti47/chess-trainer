import { db, TABLES as V1_TABLES, type TableName as V1Table } from './db';

const APP = 'chess-trainer';
const VERSION = 2;

/** Таблицы этапа 2: партии с Chess.com, их разборы и задачи из ошибок. */
const GAME_TABLES = ['games', 'analyses', 'gamePuzzles'] as const;
type TableName = V1Table | typeof GAME_TABLES[number];
/** Все таблицы копии версии 2. TABLES из db.ts остаётся списком версии 1. */
const ALL_TABLES: readonly TableName[] = [...V1_TABLES, ...GAME_TABLES];

/** Строки kv этапа 2: в файле версии 1 их нет, поэтому при его восстановлении они остаются как на устройстве. */
const GAME_KV_KEYS = ['chessUser', 'patternRange'];

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

type Tables = Record<TableName, object[]>;
type Parsed = { version: 1 | 2; tables: Partial<Tables> };

const table = (name: TableName) => db.table(name);

/** Всё состояние приложения одним JSON-файлом. */
export async function exportBackup(): Promise<Blob> {
  const tables = {} as Tables;
  await db.transaction('r', ALL_TABLES.map(table), async () => {
    for (const name of ALL_TABLES) tables[name] = await table(name).toArray();
  });
  const data = { app: APP, version: VERSION, exportedAt: new Date().toISOString(), tables };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isText = (v: unknown) => typeof v === 'string' && v !== '';
const isNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Первичный ключ строки каждой таблицы: без него запись в базу не пройдёт или испортит её. */
const KEY_OK: Record<TableName, (row: Record<string, unknown>) => boolean> = {
  kv: (r) => isText(r.key),
  attempts: (r) => isNumber(r.id),
  themeStats: (r) => isText(r.theme),
  reviews: (r) => isText(r.puzzleId),
  lessons: (r) => isText(r.nodeId) && isNumber(r.lessonIndex),
  days: (r) => isText(r.day),
  ratingHistory: (r) => isNumber(r.id),
  games: (r) => isText(r.id) && Array.isArray(r.moves),
  analyses: (r) => isText(r.gameId) && Array.isArray(r.moves) && Array.isArray(r.scores),
  gamePuzzles: (r) => isText(r.id) && Array.isArray(r.moves) && r.moves.length === 2,
};

/** Числовые поля профиля: на них держатся рейтинг и опыт. */
function profileOk(kv: Record<string, unknown>[]): boolean {
  const row = kv.find((r) => r.key === 'profile');
  if (!row) return true;
  const p = row.value;
  return isObject(p) && isNumber(p.rating) && isNumber(p.ratedCount) && isNumber(p.xp);
}

/** Версия 1 содержит только таблицы этапа 1, версия 2 — все. */
const tablesOf = (version: 1 | 2): readonly TableName[] => (version === 1 ? V1_TABLES : ALL_TABLES);

function parse(text: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('Файл повреждён');
  }
  if (!isObject(data) || data.app !== APP) throw new BackupError('Это не файл резервной копии');
  const version = data.version;
  if (version !== 1 && version !== 2) throw new BackupError('Файл от другой версии приложения');
  const tables = data.tables;
  if (!isObject(tables)) throw new BackupError('Файл повреждён');
  for (const name of tablesOf(version)) {
    const rows = tables[name];
    if (!Array.isArray(rows) || !rows.every((r) => isObject(r) && KEY_OK[name](r))) {
      throw new BackupError('Файл повреждён');
    }
  }
  if (!profileOk(tables.kv as Record<string, unknown>[])) throw new BackupError('Файл повреждён');
  return { version, tables: tables as Partial<Tables> };
}

/** Заменяет всё состояние содержимым резервной копии. Файл проверяется до записи; запись — одна транзакция. */
export async function importBackup(text: string): Promise<void> {
  const { version, tables } = parse(text);
  const names = tablesOf(version);
  try {
    await db.transaction('rw', names.map(table), async () => {
      // Версия 1: ник и диапазон партий читаются до замены kv и записываются поверх файла.
      const keep = version === 1 ? (await db.kv.bulkGet(GAME_KV_KEYS)).filter((r) => r !== undefined) : [];
      for (const name of names) {
        await table(name).clear();
        let rows = tables[name] ?? [];
        if (name === 'kv' && version === 1) rows = rows.filter((r) => !GAME_KV_KEYS.includes((r as { key: string }).key));
        await table(name).bulkAdd(rows);
      }
      if (keep.length > 0) await db.kv.bulkPut(keep);
    });
  } catch (e: unknown) {
    // Ключи проверены в parse; оставшиеся ошибки ограничений — тоже испорченный файл.
    if (e instanceof Error && (e.name === 'ConstraintError' || e.name === 'BulkError')) throw new BackupError('Файл повреждён');
    console.error('Не удалось записать копию', e);
    throw new BackupError('Не удалось записать данные');
  }
}
