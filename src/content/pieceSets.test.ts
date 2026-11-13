import { PIECE_SETS, pieceUrl } from './pieceSets';

const files = import.meta.glob<string>('/public/pieces/*/*.svg', { query: '?raw', import: 'default', eager: true });

describe('PIECE_SETS', () => {
  it('в public/pieces ровно 96 картинок', () => {
    expect(Object.keys(files)).toHaveLength(96);
  });

  it('для каждого набора лежат 12 картинок SVG в public/pieces', () => {
    expect(PIECE_SETS).toHaveLength(8);
    for (const set of PIECE_SETS) {
      for (const color of 'wb') {
        for (const role of 'KQRBNP') {
          const path = '/public' + pieceUrl(set.id, color + role).slice(1);
          expect(files[path], path).toBeDefined();
          expect(files[path].trimStart()).toMatch(/^(<svg|<\?xml)/);
        }
      }
    }
  });

  it('pieceUrl даёт относительный адрес, неизвестный набор заменяется набором по умолчанию', () => {
    expect(pieceUrl('cburnett', 'wN')).toBe('./pieces/cburnett/wN.svg');
    expect(pieceUrl('нет-такого', 'bQ')).toBe('./pieces/maestro/bQ.svg');
  });
});
