import openingsRaw from '../../public/openings.json?raw';
import { Chess } from 'chess.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bookFromKeys,
  bookLength,
  hashKey,
  loadOpeningBook,
  loadBookPlies,
  parseOpeningsFile,
  positionKey,
  resetOpeningBookCache,
} from './openings';

/** Ключи всех позиций после каждого полухода линии (UCI с начальной позиции). */
function keysOf(line: string): string[] {
  const chess = new Chess();
  const keys: string[] = [];
  for (const uci of line.split(' ')) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    keys.push(positionKey(chess.fen()));
  }
  return keys;
}

const ITALIAN = 'e2e4 e7e5 g1f3 b8c6 f1c4';

describe('positionKey', () => {
  it('отбрасывает счётчики ходов и поле взятия на проходе', () => {
    const a = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
    const b = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 5 9';
    expect(positionKey(a)).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq');
    expect(positionKey(a)).toBe(positionKey(b));
  });
});

describe('hashKey', () => {
  it('даёт заранее посчитанные числа (держать одинаковой со scripts/build_openings.mjs)', () => {
    expect(hashKey('')).toBe(2166136261);
    expect(hashKey('a')).toBe(3826002220);
    expect(hashKey('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq')).toBe(1709598787);
    expect(hashKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq')).toBe(618225972);
  });
});

describe('bookLength', () => {
  const italian = bookFromKeys(keysOf(ITALIAN));

  it('считает теоретические полуходы подряд', () => {
    expect(bookLength(ITALIAN.split(' ').concat('g8f6'), italian)).toBe(5);
  });

  it('перестановка ходов тоже теория', () => {
    const book = bookFromKeys([...keysOf('g1f3 b8c6 e2e4'), ...keysOf('e2e4 e7e5 g1f3 b8c6')]);
    expect(bookLength(['g1f3', 'b8c6', 'e2e4', 'e7e5'], book)).toBe(4);
  });

  it('первый ход вне книги — ноль', () => {
    expect(bookLength(['d2d4', 'd7d5'], italian)).toBe(0);
  });

  it('после выхода из книги возврат не считается', () => {
    const all = keysOf(ITALIAN);
    const book = bookFromKeys([all[0], all[2]]);
    expect(bookLength(ITALIAN.split(' '), book)).toBe(1);
  });

  it('недопустимый ход — ноль', () => {
    expect(bookLength(['e2e5'], italian)).toBe(0);
  });

  it('пустая книга — ноль', () => {
    expect(bookLength(ITALIAN.split(' '), bookFromKeys([]))).toBe(0);
  });
});

describe('public/openings.json', () => {
  const book = parseOpeningsFile(JSON.parse(openingsRaw));

  it('содержит итальянскую партию', () => {
    expect(bookLength(ITALIAN.split(' '), book)).toBe(5);
  });

  it('содержит ферзевый гамбит', () => {
    expect(bookLength(['d2d4', 'd7d5', 'c2c4'], book)).toBe(3);
  });
});

describe('loadOpeningBook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetOpeningBookCache();
  });

  it('при сбое fetch возвращает пустую книгу и не бросает', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('нет сети')));
    const book = await loadOpeningBook();
    expect(book.has(positionKey(new Chess().fen()))).toBe(false);
  });

  it('loadBookPlies при сбое fetch — ноль', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('нет сети')));
    expect(await loadBookPlies(['e2e4', 'e7e5'])).toBe(0);
  });

  it('грузит файл один раз', async () => {
    const file = JSON.parse(openingsRaw);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => file });
    vi.stubGlobal('fetch', fetchMock);
    const a = await loadOpeningBook();
    const b = await loadOpeningBook();
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bookLength(['e2e4', 'e7e5'], a)).toBe(2);
  });

  it('сбой не запоминается: следующий вызов снова пробует fetch', async () => {
    const file = JSON.parse(openingsRaw);
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('нет сети'))
      .mockResolvedValue({ ok: true, json: async () => file });
    vi.stubGlobal('fetch', fetchMock);
    const failed = await loadOpeningBook();
    expect(failed.has(positionKey(new Chess().fen()))).toBe(false);
    const book = await loadOpeningBook();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bookLength(['e2e4', 'e7e5'], book)).toBe(2);
  });
});
