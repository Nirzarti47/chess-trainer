// Копирует однопоточную lite-сборку Stockfish и текст её лицензии (GPL-3.0) из node_modules в public/engine/.
// Файлы закоммичены, поэтому после свежего клонирования запускать скрипт не нужно:
// он нужен только при обновлении пакета stockfish.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', 'stockfish');
const from = join(pkg, 'bin');
const to = join(root, 'public', 'engine');
// Имена должны совпадать с ENGINE_URL в src/engine/engine.ts.
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

mkdirSync(to, { recursive: true });
for (const file of files) {
  copyFileSync(join(from, file), join(to, file));
  console.log(`engine: ${file}`);
}
// GPL-3.0 требует класть текст лицензии рядом с распространяемым движком.
copyFileSync(join(pkg, 'Copying.txt'), join(to, 'Copying.txt'));
console.log('engine: Copying.txt');
