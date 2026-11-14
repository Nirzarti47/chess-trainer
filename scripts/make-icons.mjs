// Рисует значки приложения из фигуры public/pieces/maestro/wN.svg:
// белый конь на фоне #16222C с янтарной (#F0B243) подставкой.
// Запуск: node scripts/make-icons.mjs — PNG ложатся в public/icons/.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

const BG = '#16222C';
const ACCENT = '#F0B243';

const knight = (await readFile(join(root, 'public', 'pieces', 'maestro', 'wN.svg'), 'utf8'))
  .replace(/^<\?xml[^>]*>\s*/, '')
  .trim();

/**
 * Значок на холсте 100×100. scale — доля холста, которую занимает рисунок:
 * 1 для обычных значков, меньше для «маскируемого», чтобы конь не попал под обрезку.
 */
function iconSvg(scale) {
  const offset = (100 - 100 * scale) / 2;
  // Конь занимает квадрат 64×64 над подставкой, подставка — янтарная полоса под ним.
  const art = `
    <g transform="translate(${offset} ${offset}) scale(${scale})">
      <rect x="24" y="76" width="52" height="6" rx="3" fill="${ACCENT}"/>
      ${knight.replace('<svg ', '<svg x="18" y="16" width="64" height="64" ')}
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" fill="${BG}"/>${art}
  </svg>`;
}

const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  // Безопасная зона маскируемого значка — круг диаметром 80 % стороны.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72 },
  { file: 'apple-touch-icon-180.png', size: 180, scale: 1 },
];

await mkdir(outDir, { recursive: true });
for (const { file, size, scale } of ICONS) {
  await sharp(Buffer.from(iconSvg(scale)), { density: (72 * size) / 100 })
    .resize(size, size)
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, file));
  console.log(`public/icons/${file}`);
}
