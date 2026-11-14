// Копирует однопоточную lite-сборку Stockfish из node_modules в public/engine/.
// Файлы закоммичены, поэтому после свежего клонирования запускать скрипт не нужно:
// он нужен только при обновлении пакета stockfish.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'stockfish', 'bin');
const to = join(root, 'public', 'engine');
// Имена должны совпадать с ENGINE_URL в src/engine/engine.ts.
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

mkdirSync(to, { recursive: true });
for (const file of files) {
  copyFileSync(join(from, file), join(to, file));
  console.log(`engine: ${file}`);
}
