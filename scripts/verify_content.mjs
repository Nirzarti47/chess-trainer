// Проверяет авторское содержание движком: node scripts/verify_content.mjs
//
// Для каждого авторского задания каждый ход из accept должен быть не хуже лучшего хода
// больше чем на 0,5 пешки (Stockfish, глубина 14). Для каждого шага объяснения с ходом
// тот же порог — чтобы «ход из урока» не оказался ошибкой, — и ещё ход должен быть
// единственным: приложение принимает в шаге только его, поэтому другой ход не может
// быть так же хорош. Печатает таблицу; при любом расхождении выходит с кодом 1.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEPTH = 14;
const MULTIPV = 5;
const THRESHOLD_CP = 50;
/** Мат в N ходов: больше любой материальной оценки, и чем короче мат, тем выше оценка. */
const MATE_CP = 100000;
const MATE_STEP_CP = 1000;

// Исходники приложения импортируют модули без расширения (так принято для Vite).
// Node сам удаляет типы из .ts, но расширение ему нужно, поэтому дописываем его здесь.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
    return next(specifier, context);
  },
});

const contentUrl = (file) => pathToFileURL(join(root, 'src', 'content', file)).href;
const { getAuthoredLesson, getExplain } = await import(contentUrl('explanations.ts'));
const { THEMES } = await import(contentUrl('themes.ts'));
const { CURRICULUM } = await import(contentUrl('curriculum.ts'));

/** Однопоточный Stockfish из пакета stockfish, общение по UCI через stdin/stdout. */
class Engine {
  constructor() {
    const path = join(root, 'node_modules', 'stockfish', 'bin', 'stockfish-19-lite-single.js');
    this.proc = spawn(process.execPath, [path], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buffer = '';
    this.waiters = [];
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        for (const w of [...this.waiters]) w(line);
      }
    });
  }

  send(cmd) { this.proc.stdin.write(`${cmd}\n`); }

  /** Отправляет команду и собирает строки до той, что начинается с until. */
  collect(cmd, until) {
    return new Promise((resolve) => {
      const lines = [];
      const w = (line) => {
        lines.push(line);
        if (line.startsWith(until)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          resolve(lines);
        }
      };
      this.waiters.push(w);
      this.send(cmd);
    });
  }

  async init() {
    await this.collect('uci', 'uciok');
    await this.collect('isready', 'readyok');
  }

  /** Оценки ходов со стороны того, кто ходит: [{ move, cp }], лучший первым. */
  async analyse(fen, { multipv = 1, searchmoves = [] } = {}) {
    this.send('ucinewgame');
    this.send(`setoption name MultiPV value ${multipv}`);
    await this.collect('isready', 'readyok');
    this.send(`position fen ${fen}`);
    const go = `go depth ${DEPTH}${searchmoves.length ? ` searchmoves ${searchmoves.join(' ')}` : ''}`;
    const lines = await this.collect(go, 'bestmove');
    const byPv = new Map();
    for (const line of lines) {
      const m = line.match(/^info .*\bdepth (\d+)\b.*\bmultipv (\d+)\b.*\bscore (cp|mate) (-?\d+).*\bpv (\S+)/);
      if (!m || Number(m[1]) !== DEPTH || line.includes(' upperbound') || line.includes(' lowerbound')) continue;
      const n = Number(m[4]);
      const cp = m[3] === 'cp' ? n : Math.sign(n) * (MATE_CP - MATE_STEP_CP * Math.abs(n));
      byPv.set(Number(m[2]), { move: m[5], cp, label: m[3] === 'cp' ? fmtCp(n) : `мат ${n}` });
    }
    return [...byPv.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  /** Оценка одного хода: из списка лучших, а если его там нет — отдельным поиском. */
  async scoreOf(fen, move, top) {
    return top.find((t) => t.move === move) ?? (await this.analyse(fen, { searchmoves: [move] }))[0];
  }

  quit() { this.send('quit'); }
}

function fmtCp(cp) {
  const p = (cp / 100).toFixed(2);
  return cp > 0 ? `+${p}` : p;
}

/** Ход UCI в записи SAN: так таблицу проще читать. */
function san(fen, uci) {
  const c = new Chess(fen);
  try {
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return `${uci}?`;
  }
}

function collectItems() {
  const items = [];
  for (const node of CURRICULUM.flatMap((s) => s.nodes).filter((n) => n.kind === 'authored')) {
    for (let l = 0; l < node.lessons; l++) {
      getAuthoredLesson(node.id, l).forEach((task, i) => {
        const where = `${node.id}#${l}[${i}]`;
        if (task.kind === 'authored') items.push({ where, kind: 'задание', fen: task.task.fen, moves: task.task.accept });
        if (task.kind === 'explain' && task.step.move) items.push({ where, kind: 'шаг', fen: task.step.fen, moves: [task.step.move] });
      });
    }
  }
  for (const t of THEMES) {
    for (const mode of ['full', 'reminder']) {
      getExplain(t.id, mode).forEach((step, i) => {
        if (step.move) items.push({ where: `${t.id}.${mode}[${i}]`, kind: 'шаг', fen: step.fen, moves: [step.move], unique: true });
      });
    }
  }
  return items;
}

const engine = new Engine();
await engine.init();

const rows = [];
let failed = 0;
for (const item of collectItems()) {
  const top = await engine.analyse(item.fen, { multipv: MULTIPV });
  const best = top[0];
  const problems = [];
  const parts = [];
  for (const move of item.moves) {
    const s = await engine.scoreOf(item.fen, move, top);
    const loss = best.cp - s.cp;
    parts.push(`${san(item.fen, move)} ${s.label}`);
    if (loss > THRESHOLD_CP) problems.push(`${san(item.fen, move)} хуже лучшего на ${(loss / 100).toFixed(2)}`);
  }
  let note = '';
  if (item.kind === 'шаг') {
    // Единственность: следующий по силе ход должен заметно уступать ходу шага. Обязательна для
    // объяснений тем, где человек ищет удар сам; в дебютных шагах и в «Проверке основ» текст
    // называет ход, а равноценные дебютные ходы — норма, поэтому там это только заметка.
    const own = await engine.scoreOf(item.fen, item.moves[0], top);
    const rival = top.find((t) => t.move !== item.moves[0]);
    if (item.unique && rival && own.cp - rival.cp <= THRESHOLD_CP) problems.push(`не единственный: ${san(item.fen, rival.move)} ${rival.label}`);
    if (rival) note = `следующий ${san(item.fen, rival.move)} ${rival.label}`;
  } else {
    // Ходы, которых нет в accept, но которые почти не хуже лучшего: на них стоит взглянуть тренеру.
    const near = top.filter((t) => !item.moves.includes(t.move) && best.cp - t.cp <= THRESHOLD_CP);
    if (near.length) note = `не в accept: ${near.map((t) => `${san(item.fen, t.move)} ${t.label}`).join(', ')}`;
  }
  if (problems.length) failed++;
  rows.push({
    'где': item.where, 'вид': item.kind, 'ходы': parts.join('; '),
    'лучший': `${san(item.fen, best.move)} ${best.label}`,
    'итог': problems.length ? `ОШИБКА: ${problems.join('; ')}` : 'да', 'заметка': note,
  });
}
engine.quit();

const cols = Object.keys(rows[0] ?? {});
const width = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => r[c].length))]));
const line = (r) => `| ${cols.map((c) => r[c].padEnd(width[c])).join(' | ')} |`;
console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
console.log(`|${cols.map((c) => '-'.repeat(width[c] + 2)).join('|')}|`);
for (const r of rows) console.log(line(r));
console.log();
if (failed) {
  console.log(`расхождений: ${failed} из ${rows.length}`);
  process.exit(1);
}
console.log(`все задания подтверждены (${rows.length})`);
