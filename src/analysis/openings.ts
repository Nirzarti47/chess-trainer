import { Chess } from 'chess.js';

export interface OpeningBook {
  has(key: string): boolean;
}

/** Ключ позиции: первые три поля FEN — расстановка, очередь хода, рокировки. */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 3).join(' ');
}

/** FNV-1a, 32 бита. Держать одинаковой с scripts/build_openings.mjs. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Книга из набора ключей — для тестов и для loadOpeningBook. */
export function bookFromKeys(keys: Iterable<string>): OpeningBook {
  const hashes = new Set<number>();
  for (const key of keys) hashes.add(hashKey(key));
  return { has: (key) => hashes.has(hashKey(key)) };
}

/** Файл public/openings.json: { v: 1, deltas } — отсортированные хеши, записанные как разности соседних. */
export function parseOpeningsFile(file: { deltas: number[] }): OpeningBook {
  const hashes = new Set<number>();
  let sum = 0;
  for (const d of file.deltas) {
    sum += d;
    hashes.add(sum);
  }
  return { has: (key) => hashes.has(hashKey(key)) };
}

/** Сколько первых полуходов партии (UCI с начальной позиции) подряд ведут в позиции из книги. */
export function bookLength(moves: string[], book: OpeningBook): number {
  const chess = new Chess();
  let n = 0;
  for (const uci of moves) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    if (!book.has(positionKey(chess.fen()))) break;
    n++;
  }
  return n;
}

const EMPTY_BOOK: OpeningBook = { has: () => false };
let cached: Promise<OpeningBook> | null = null;

/** Для тестов: забыть загруженную книгу. */
export function resetOpeningBookCache(): void {
  cached = null;
}

/** Книга из файла public/openings.json; грузится один раз и запоминается; при сбое — пустая книга (без исключения). */
export function loadOpeningBook(): Promise<OpeningBook> {
  cached ??= (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}openings.json`);
      if (!response.ok) return EMPTY_BOOK;
      return parseOpeningsFile(await response.json());
    } catch {
      return EMPTY_BOOK;
    }
  })();
  return cached;
}
