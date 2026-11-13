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
    if (!Array.isArray(rows) || !rows.every(isObject)) throw new BackupError('Файл повреждён');
  }
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
  } catch {
    throw new BackupError('Файл повреждён');
  }
}
