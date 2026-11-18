// Собирает public/openings.json — список позиций из дебютов Lichess.
// Источник: https://github.com/lichess-org/chess-openings (файлы a.tsv…e.tsv), лицензия CC0 (общественное достояние).
// Скачивает файлы с raw.githubusercontent.com (нужна сеть), на диск .tsv не кладёт.
// Для каждой записи проходит ходы pgn с начальной позиции и берёт ключ каждой позиции
// (расстановка, очередь хода, рокировки). Ключ хешируется (FNV-1a, 32 бита); файл — отсортированные
// хеши, записанные как разности соседних: { v: 1, count, deltas }.
// positionKey и hashKey держать одинаковыми с src/analysis/openings.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function positionKey(fen) {
  return fen.split(' ').slice(0, 3).join(' ');
}

function hashKey(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const hashes = new Set();
let entries = 0;
for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const response = await fetch(`${BASE}${letter}.tsv`);
  if (!response.ok) throw new Error(`${letter}.tsv: HTTP ${response.status}`);
  const lines = (await response.text()).split('\n').slice(1).filter((l) => l.trim());
  for (const line of lines) {
    const [, , pgn] = line.split('\t');
    const chess = new Chess();
    // Из pgn берём только ходы: убираем номера «1.» и «1...».
    for (const token of pgn.trim().split(/\s+/)) {
      if (/^\d+\.+$/.test(token)) continue;
      chess.move(token);
      hashes.add(hashKey(positionKey(chess.fen())));
    }
    entries++;
  }
}

const sorted = [...hashes].sort((x, y) => x - y);
const deltas = sorted.map((h, i) => (i === 0 ? h : h - sorted[i - 1]));
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'openings.json'), JSON.stringify({ v: 1, count: sorted.length, deltas }));
console.log(`openings: ${entries} записей, ${sorted.length} позиций`);
