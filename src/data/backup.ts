import { db, TABLES, type TableName } from './db';

const APP = 'chess-trainer';
const VERSION = 1;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

type Tables = Record<TableName, object[]>;

const table = (name: TableName) => db.table(name);

/** Всё состояние приложения одним JSON-файлом. */
export async function exportBackup(): Promise<Blob> {
  const tables = {} as Tables;
  await db.transaction('r', TABLES.map(table), async () => {
    for (const name of TABLES) tables[name] = await table(name).toArray();
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
};

/** Числовые поля профиля: на них держатся рейтинг и опыт. */
function profileOk(kv: Record<string, unknown>[]): boolean {
  const row = kv.find((r) => r.key === 'profile');
  if (!row) return true;
  const p = row.value;
  return isObject(p) && isNumber(p.rating) && isNumber(p.ratedCount) && isNumber(p.xp);
}

function parse(text: string): Tables {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('Файл повреждён');
  }
  if (!isObject(data) || data.app !== APP) throw new BackupError('Это не файл резервной копии');
  if (data.version !== VERSION) throw new BackupError('Файл от другой версии приложения');
  const tables = data.tables;
  if (!isObject(tables)) throw new BackupError('Файл повреждён');
  for (const name of TABLES) {
    const rows = tables[name];
    if (!Array.isArray(rows) || !rows.every((r) => isObject(r) && KEY_OK[name](r))) {
      throw new BackupError('Файл повреждён');
    }
  }
  if (!profileOk(tables.kv as Record<string, unknown>[])) throw new BackupError('Файл повреждён');
  return tables as Tables;
}

/** Заменяет всё состояние содержимым резервной копии. Файл проверяется до записи; запись — одна транзакция. */
export async function importBackup(text: string): Promise<void> {
  const tables = parse(text);
  try {
    await db.transaction('rw', TABLES.map(table), async () => {
      for (const name of TABLES) {
        await table(name).clear();
        await table(name).bulkAdd(tables[name]);
      }
    });
  } catch (e: unknown) {
    // Ключи проверены в parse; оставшиеся ошибки ограничений — тоже испорченный файл.
    if (e instanceof Error && (e.name === 'ConstraintError' || e.name === 'BulkError')) throw new BackupError('Файл повреждён');
    console.error('Не удалось записать копию', e);
    throw new BackupError('Не удалось записать данные');
  }
}
