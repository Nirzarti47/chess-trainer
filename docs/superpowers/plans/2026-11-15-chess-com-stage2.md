# Этап 2: партии с Chess.com — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Приложение по нику загружает партии с Chess.com, разбирает их движком на устройстве, показывает разбор по ходам с пробой своих ходов и делает из ошибок владельца задачи.

**Architecture:** Партии, разборы и задачи из партий лежат в трёх новых таблицах IndexedDB. Разбор считает второй, отдельный экземпляр Stockfish (`analysisEngine`), чтобы существующий движок урока не менялся; чистые функции в `src/analysis/` превращают линии движка в оценки ходов, виды ошибок и задачи. Экраны читают готовый `GameAnalysis` из базы и не знают, кто его посчитал. Фоновая очередь разбирает партии, пока приложение видно.

**Tech Stack:** как на этапе 1 — Vite, React 19, TypeScript, Vitest (jsdom, fake-indexeddb), chess.js 1.4, chessground 9, Dexie 4, Stockfish 19 lite single (WASM в Web Worker). Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-11-15-chess-com-stage2-design.md` (продолжает `2026-11-13-chess-trainer-design.md`). Исполнитель читает оба.

## Global Constraints

- Всё бесплатно; новых npm-зависимостей не добавлять.
- Сеть: только `https://api.chess.com/pub/...`, только с ником в адресе. Никаких ключей, аккаунтов, других адресов.
- IndexedDB без курсоров: новые чтения — `table.toArray()`, `get`, `bulkGet` и фильтр в коде. Не использовать `orderBy(...).uniqueKeys()`, `each`, `where(...).filter(...)`, `count()` по индексу. (Safari на iPhone: «Unable to open cursor».)
- `src/engine/engine.ts` и его тесты не менять: движок урока остаётся как есть.
- Настоящие партии владельца и ники соперников в репозиторий не попадают. Образцы для тестов пишутся руками с именами `Owner_Test`, `rival_one`, `rival_two`.
- Все тексты интерфейса на русском, простым языком, без терминов, которых не было в уроках этапа 1. Обращение на «ты», без форм прошедшего времени с родом («сыграл», «решил» — нельзя; «партия сыграна», «решено» — можно).
- Кнопки действий экрана видны без прокрутки (приём этапа 1: `position: sticky; bottom: 0`, см. `.task-actions` в `src/screens/LessonScreen.css`).
- Любой сбой загрузки или разбора показывает на экране свой текст (по образцу `describeError` в `src/screens/lessonErrors.ts`).
- Цвета этапа 1 (`--bg #16222C`, `--surface #1F303D`, `--accent #F0B243`, успех `#63C29A`, повторение `#5AA9D6`) плюс два новых: ошибка `#E8873A`, грубая ошибка `#E25C4C`.
- Каждая команда в Git Bash начинается с `export PATH="/c/Program Files/nodejs:$PATH"`. Проверка задачи: `npx vitest run <файлы>`, перед коммитом `npm test` и `npx tsc -b` — оба без ошибок.
- В `main` не отправлять (`git push` запрещён): публикация только с согласия владельца.
- Все числа разбора лежат в `src/analysis/config.ts`; в остальном коде чисел-порогов нет.

## Review Focus

1. Chess.com отдаёт партию, которую нельзя разобрать (пустой или битый `pgn`, 0–1 ход, нет `uuid`) — она пропускается, остальные партии месяца загружаются. → тест в задаче 2.
2. Ник введён с пробелами или другим регистром (` nirzarti `) — запросы идут с `nirzarti`, цвет владельца определяется без учёта регистра. → тест в задаче 2.
3. Сеть пропала посреди первой загрузки (месяц 3 из 5) — уже загруженные месяцы сохранены, повтор продолжает с третьего, дублей нет. → тест в задаче 2.
4. Приложение свернули или движок умер посреди партии — недосчитанный разбор не сохраняется, партия считается заново, очередь идёт дальше, вторая подряд неудача той же партии не зацикливает очередь. → тесты в задаче 7.
5. Задача из партии стоит в повторении, а её партию удалили сменой ника — запись повторения исчезает, экран повторения открывается без сбоя. → тест в задаче 12.

---

## Карта файлов

| Файл | За что отвечает |
|---|---|
| `src/domain/gameTypes.ts` | все типы этапа (ниже, задача 1) |
| `src/domain/types.ts` | `Source` + `'game' \| 'pattern'`; `Puzzle.game?` |
| `src/data/db.ts` | версия 2: `games`, `analyses`, `gamePuzzles` |
| `src/data/gamesRepo.ts` | чтение и запись партий, разборов, задач из партий, ника, промежутка |
| `src/data/backup.ts` | формат копии версии 2, чтение версии 1 |
| `src/chesscom/api.ts`, `sync.ts`, `fixtures/*.json` | запросы к Chess.com, разбор ответов, загрузка по месяцам |
| `src/engine/analysisEngine.ts` | второй экземпляр движка: несколько линий, приоритеты, отмена |
| `src/analysis/config.ts` | все числа |
| `src/analysis/score.ts` | перевес → ожидаемый результат, потеря, точность, запись оценки |
| `src/analysis/grade.ts` | оценка хода, знаки «!» и «!!», сводка стороны |
| `src/analysis/material.ts` | материал, размен на поле, выигрыш материала по линии |
| `src/analysis/kinds.ts`, `phrases.ts` | вид ошибки, фразы, советы, названия |
| `src/analysis/notation.ts` | русская запись хода |
| `src/analysis/analyseGame.ts` | два прохода: партия → `GameAnalysis` |
| `src/analysis/gamePuzzles.ts` | отбор задач из партии, сверка при пересчёте, перевод в `Puzzle` |
| `src/analysis/patterns.ts` | промежутки и подсчёт частых ошибок |
| `src/analysis/queue.ts` | очередь разбора |
| `src/games/gamesStore.ts` | состояние загрузки и очереди для экранов, фоновый запуск |
| `src/screens/games/*` | экраны: список, ник, сводка, разбор, частые ошибки |
| `src/screens/gameLessons.ts` | уроки «Исправить ошибки» и «Частые ошибки» |

---

### Task 1: Типы и хранение

**Files:**
- Create: `src/domain/gameTypes.ts`, `src/data/gamesRepo.ts`, `src/data/gamesRepo.test.ts`
- Modify: `src/data/db.ts`, `src/domain/types.ts`

**Interfaces — Produces:**

```ts
// src/domain/gameTypes.ts
export type TimeClass = 'rapid' | 'blitz' | 'bullet' | 'daily';
export type Side = 'white' | 'black';
export interface GameRecord {
  id: string;              // uuid партии на Chess.com
  url: string; endTime: number /* мс */; timeClass: TimeClass; timeControl: string;
  userColor: Side; userRating: number; opponent: string; opponentRating: number;
  result: 'win' | 'loss' | 'draw'; endReason: string /* код Chess.com: checkmated, resigned, timeout… */;
  moves: string[];         // ходы в UCI с начальной позиции
}
/** Оценка всегда с точки зрения белых. mate > 0 — мат ставят белые. over — партия на доске закончена. */
export type Score = { cp: number } | { mate: number } | { over: Side | 'draw' };
export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type Mark = 'brilliant' | 'great';
export type MistakeKind = 'missedMate' | 'allowedMate' | 'pieceEnPrise' | 'pieceUndefended'
  | 'missedCapture' | 'missedFork' | 'badTrade' | 'other';
export interface AltMove { move: string; score: Score; pv: string[] }
export interface MoveReview {
  ply: number;             // 0 — первый ход белых
  move: string; loss: number /* 0..1, потеря ожидаемого результата сыгравшего */;
  grade: Grade; mark?: Mark;
  kind?: MistakeKind; phrase?: string;   // только у mistake и blunder
  best: AltMove[];         // 1–3 лучших хода из позиции перед ходом, сильнейший первым
  deep: boolean;           // true — данные второго прохода
}
export interface SideSummary { grades: Record<Grade, number>; brilliant: number; great: number;
  accuracy: number /* 0..100 */; kinds: Partial<Record<MistakeKind, number>> }
export interface GameAnalysis {
  gameId: string; rulesVersion: number; analysedAt: number; tookMs: number;
  scores: Score[];         // scores[i] — позиция после i полуходов; длина moves.length + 1
  moves: MoveReview[]; white: SideSummary; black: SideSummary;
}
export interface GamePuzzle {
  id: string /* `g:${gameId}:${ply}` */; gameId: string; ply: number; endTime: number;
  fen: string /* позиция перед ходом соперника (ply − 1) */; moves: [string, string] /* ход соперника, верный ход */;
  kind: MistakeKind; phrase: string; loss: number;
}
export interface ChessUser { nick: string; loadedThrough: string | null /* 'YYYY/MM' */ }
export type RangeChoice = { by: 'count'; n: 10 | 20 | 50 } | { by: 'time'; span: 'week' | 'month' | 'quarter' | 'all' };

// src/domain/types.ts
export type Source = 'lesson' | 'free' | 'review' | 'weak' | 'exam' | 'game' | 'pattern';
export interface Puzzle { /* как было */ game?: { gameId: string; ply: number; phrase: string } }

// src/data/db.ts — version(2).stores({ ...прежние, games: 'id', analyses: 'gameId', gamePuzzles: 'id' })
// TABLES дополняется: 'games', 'analyses', 'gamePuzzles'

// src/data/gamesRepo.ts
export async function getChessUser(): Promise<ChessUser | null>;        // kv 'chessUser'
export async function setChessUser(u: ChessUser): Promise<void>;
/** Удаляет партии, разборы, задачи из партий и записи повторения с id на 'g:'; ставит новый ник, loadedThrough = null. */
export async function changeNick(nick: string): Promise<void>;
/** Добавляет только отсутствующие (по id); возвращает число новых. */
export async function putGames(games: GameRecord[]): Promise<number>;
export async function getGames(): Promise<GameRecord[]>;                // от новых к старым
export async function getGame(id: string): Promise<GameRecord | undefined>;
export async function getAnalysis(gameId: string): Promise<GameAnalysis | undefined>;
export async function getAnalyses(): Promise<GameAnalysis[]>;
/** Одна транзакция: кладёт разбор, вносит put, удаляет removeIds из gamePuzzles и из reviews. */
export async function saveAnalysis(a: GameAnalysis, puzzles: { put: GamePuzzle[]; removeIds: string[] }): Promise<void>;
export async function getGamePuzzles(gameId?: string): Promise<GamePuzzle[]>;
export async function getGamePuzzle(id: string): Promise<GamePuzzle | undefined>;
/** id задач (любых), у которых есть попытка с результатом 'clean'. */
export async function getCleanPuzzleIds(): Promise<Set<string>>;
export async function getPatternRange(): Promise<RangeChoice>;          // по умолчанию { by: 'count', n: 20 }
export async function setPatternRange(r: RangeChoice): Promise<void>;
```

- [ ] **Step 1: тесты `src/data/gamesRepo.test.ts`** (fake-indexeddb, как `repo.test.ts`):
  - `putGames` дважды с одной партией → второй вызов возвращает `0`, `getGames()` длины 1.
  - `getGames` для партий с `endTime` 100, 300, 200 → порядок 300, 200, 100.
  - `saveAnalysis(a, { put: [p1, p2], removeIds: [] })`, затем `saveAnalysis(a2, { put: [], removeIds: [p1.id] })` при существующей записи `reviews` с `puzzleId = p1.id` → `getGamePuzzles(gameId)` содержит только `p2`, `db.reviews.get(p1.id)` — `undefined`.
  - `changeNick('other')` при партии, разборе, задаче `g:x:5`, записях повторения `g:x:5` и `00abc` → таблицы партий, разборов, задач пусты; запись `00abc` осталась, `g:x:5` удалена; `getChessUser()` равен `{ nick: 'other', loadedThrough: null }`.
  - `getPatternRange()` без сохранённого значения → `{ by: 'count', n: 20 }`.
  - Ни один вызов модуля не открывает курсор: шпионы на `IDBIndex.prototype.openCursor/openKeyCursor` и `IDBObjectStore.prototype.openCursor/openKeyCursor` (приём из `src/data/repo.test.ts`) не вызваны после прогона всех функций.
  - База, созданная версией 1 с профилем в `kv`, после открытия версией 2 сохраняет профиль и имеет пустые новые таблицы.
- [ ] **Step 2:** `npx vitest run src/data/gamesRepo.test.ts` → FAIL (модуля нет).
- [ ] **Step 3:** типы, версия базы 2, `gamesRepo.ts`. Фильтрация и сортировка — в коде после `toArray()`.
- [ ] **Step 4:** тест проходит; `npm test` и `npx tsc -b` чистые (добавление значений в `Source` и необязательного поля в `Puzzle` существующий код не ломает).
- [ ] **Step 5:** commit `feat: хранение партий, разборов и задач из партий`.

---

### Task 2: Загрузка с Chess.com

**Files:**
- Create: `src/chesscom/api.ts`, `src/chesscom/sync.ts`, `src/chesscom/api.test.ts`, `src/chesscom/sync.test.ts`, `src/chesscom/fixtures/archives.json`, `src/chesscom/fixtures/month.json`

**Interfaces:**
- Consumes: `GameRecord`, `ChessUser`, `getChessUser`, `setChessUser`, `putGames` (задача 1).
- Produces:

```ts
// api.ts
export class ChessComError extends Error { kind: 'notFound' | 'offline' | 'bad'; }
export const normalizeNick = (raw: string): string;                     // trim + toLowerCase
export async function fetchPlayer(nick: string, fetchFn?: typeof fetch): Promise<void>;   // 404 → notFound
export async function fetchArchives(nick: string, fetchFn?: typeof fetch): Promise<string[]>; // ['2023/01', …] по возрастанию
export async function fetchMonth(nick: string, month: string, fetchFn?: typeof fetch): Promise<unknown[]>;
export function toGameRecord(raw: unknown, nick: string): GameRecord | null;
// sync.ts
/** Грузит месяцы по одному. После каждого месяца сохраняет партии и loadedThrough. При сбое бросает ChessComError. */
export async function syncGames(deps?: { fetchFn?: typeof fetch; onProgress?(done: number, total: number): void }): Promise<{ added: number }>;
```

Адреса: `https://api.chess.com/pub/player/{nick}`, `…/{nick}/games/archives` (ответ `{ archives: [url…] }`, месяц — два последних сегмента адреса), `…/{nick}/games/{YYYY}/{MM}` (ответ `{ games: [...] }`). `TypeError` от `fetch` и `navigator.onLine === false` → `offline`; статус не 200 и не 404, неверная форма ответа → `bad`.

Поля партии в ответе: `url`, `pgn`, `time_control`, `end_time` (секунды), `uuid`, `time_class`, `rules`, необязательное `initial_setup`, `white` и `black` вида `{ rating, result, username }`.

Правила `toGameRecord`: `null`, если `rules !== 'chess'`, `time_class` не из четырёх, нет `uuid`, `pgn` не читается `chess.js` (`loadPgn`), в `pgn` есть заголовок `SetUp "1"` или в партии меньше 2 полуходов, или ник не совпал ни с одной стороной (сравнение без учёта регистра). `result`: у стороны владельца `win` → `'win'`; `agreed`, `repetition`, `stalemate`, `insufficient`, `50move`, `timevsinsufficient` → `'draw'`; иначе `'loss'`. `endReason` — `result` той стороны, у которой он не `win` (при ничьей — общий код). `moves` — UCI из истории `chess.js` (`from + to + promotion`).

`syncGames`: месяцы = все из `fetchArchives`, если `loadedThrough === null`, иначе те, что `>= loadedThrough`. Запросы строго по очереди.

Сервис-воркер менять не нужно: он отдаёт из офлайн-хранилища только файлы самого приложения, запросы к `api.chess.com` проходят мимо него. В `vite.config.ts` правил кэширования для этого адреса не добавлять.

- [ ] **Step 1: образцы.** `archives.json`: 3 месяца (`2026/09`, `2026/10`, `2026/11`) для `owner_test`. `month.json`: 5 партий — (а) рапид, `Owner_Test` белыми, победа матом, pgn с комментариями `{[%clk 0:09:58.1]}` (детский мат: `1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#`); (б) рапид, `owner_test` чёрными, поражение, `resigned`; (в) блиц, ничья `agreed`; (г) `rules: "chess960"`; (д) партия с `pgn: ""`.
- [ ] **Step 2: тесты `api.test.ts`:**
  - `normalizeNick(' Nirzarti ')` → `'nirzarti'`.
  - `toGameRecord(а, 'owner_test')` → `userColor: 'white'`, `result: 'win'`, `endReason: 'checkmated'`, `moves` равно `['e2e4','e7e5','f1c4','b8c6','d1h5','g8f6','h5f7']`, `endTime` равен `end_time * 1000`, `timeClass: 'rapid'`.
  - (б) → `userColor: 'black'`, `result: 'loss'`, `endReason: 'resigned'`; (в) → `result: 'draw'`, `endReason: 'agreed'`.
  - (г), (д), объект без `uuid`, `null`, строка → `null`.
  - `fetchPlayer` при ответе 404 бросает `ChessComError` с `kind: 'notFound'`; при `fetchFn`, бросающем `TypeError`, — `'offline'`.
  - `fetchArchives` возвращает `['2026/09','2026/10','2026/11']`.
- [ ] **Step 3: тесты `sync.test.ts`** (подставной `fetchFn`, fake-indexeddb):
  - первая загрузка: запросы месяцев идут в порядке 09, 10, 11 и ни один не начинается до завершения предыдущего; после неё `loadedThrough === '2026/11'`.
  - повторная загрузка запрашивает только `2026/11`; `added === 0`.
  - сбой на втором месяце: `syncGames` бросает, партии первого месяца в базе, `loadedThrough === '2026/09'`; следующий вызов запрашивает 09, 10, 11 и не создаёт дублей.
  - месяц с одной годной и одной негодной партией → годная сохранена.
- [ ] **Step 4:** FAIL → реализация → PASS. `npm test`, `npx tsc -b`.
- [ ] **Step 5:** commit `feat: загрузка партий с Chess.com по нику`.

---

### Task 3: Движок разбора

**Files:**
- Create: `src/engine/analysisEngine.ts`, `src/engine/analysisEngine.test.ts`

**Interfaces — Produces:**

```ts
/** Оценка с точки зрения стороны, чей ход (как отдаёт UCI). */
export type UciScore = { cp: number } | { mate: number };
export interface EngineLine { move: string; score: UciScore; pv: string[] }
export type AnalysisPriority = 'screen' | 'background';
export interface AnalyseOptions { nodes: number; multipv: 1 | 2 | 3; priority: AnalysisPriority;
  timeoutMs?: number /* по умолчанию 20000 */; signal?: AbortSignal }
export interface AnalysisEngine {
  /** Линии последней завершённой глубины, сильнейшая первой. null — сбой, таймаут, отмена. Никогда не отклоняется. */
  analyse(fen: string, opts: AnalyseOptions): Promise<EngineLine[] | null>;
}
export function createAnalysisEngine(workerFactory: () => Worker): AnalysisEngine;
export const analysisEngine: AnalysisEngine;   // свой new Worker(ENGINE_URL), создаётся при первом запросе
```

Поведение:
- UCI: запуск `uci` → `uciok` → `isready` → `readyok` (как в `engine.ts`); перед поиском `setoption name MultiPV value N`, `position fen …`, `go nodes N`. Строки `info … multipv K … score cp X | mate Y … pv …` копятся по K; строки с `upperbound`/`lowerbound` пропускаются; по `bestmove` — ответ.
- Очередь: сначала все `screen` по порядку прихода, потом `background`. Запрос `screen`, пришедший во время поиска `background`, шлёт `stop`, результат прерванного поиска выбрасывается, а сам прерванный запрос возвращается в начало своей очереди и позже выполняется заново (его обещание всё это время ждёт).
- `signal.abort()`: запрос в очереди снимается, идущий получает `stop`; обещание выполняется с `null`.
- Таймаут или сбой воркера: воркер завершается (`terminate`), запрос получает `null`, следующий запрос поднимает новый воркер. После 3 неудач подряд движок 60 секунд сразу отвечает `null`, потом пробует снова.
- FEN с переводом строки → `null` без обращения к воркеру.

- [ ] **Step 1: тесты** (подставной `Worker`, как в `engine.test.ts`):
  - разбор строк: на `info depth 12 multipv 1 score cp 35 pv e2e4 e7e5` и `info depth 12 multipv 2 score mate -3 pv d2d4` и `bestmove e2e4` → `[{ move: 'e2e4', score: { cp: 35 }, pv: ['e2e4','e7e5'] }, { move: 'd2d4', score: { mate: -3 }, pv: ['d2d4'] }]`.
  - берётся последняя глубина: `depth 10 … cp 10`, затем `depth 11 … cp 50` для того же multipv → `cp 50`.
  - воркеру уходит `setoption name MultiPV value 3` и `go nodes 300000` при `{ nodes: 300000, multipv: 3 }`.
  - приоритет: идёт `background`-поиск A, приходит `screen` B → воркер получает `stop`; после `bestmove` стартует B; после ответа B заново стартует A; обещание A выполняется линиями второго запуска.
  - отмена: `abort()` запроса в очереди → `null`, `position` для него не отправлялся.
  - таймаут: нет `bestmove` за `timeoutMs` → `null`, воркер завершён, следующий запрос создаёт новый воркер.
  - три сбоя подряд → четвёртый запрос получает `null` без создания воркера; через 60 с (подставные таймеры) воркер создаётся снова.
- [ ] **Step 2:** FAIL → реализация → PASS. `src/engine/engine.test.ts` проходит без правок.
- [ ] **Step 3:** commit `feat: движок разбора с несколькими линиями и приоритетами`.

---

### Task 4: Оценка, потеря, запись

**Files:**
- Create: `src/analysis/config.ts`, `src/analysis/score.ts`, `src/analysis/notation.ts`, `src/analysis/material.ts` и тесты к трём последним

**Interfaces — Produces:**

```ts
// config.ts
export const CONFIG = {
  RULES_VERSION: 1,
  FAST_NODES: 60_000, FAST_MULTIPV: 2,
  DEEP_NODES: 300_000, DEEP_MULTIPV: 3, DEEP_TRIGGER_LOSS: 0.08, DEEP_MAX_MOVES: 20,
  EXPLORE_NODES: 300_000,
  GOOD_MAX: 0.05, INACCURACY_MAX: 0.10, MISTAKE_MAX: 0.20,
  ALT_MAX_LOSS: 0.05,            // варианты «Лучше было»: уступают лучшему меньше этого
  GREAT_GAP: 0.10, BRILLIANT_MAX_LOSS: 0.02, BRILLIANT_MAX_BEFORE: 0.90,
  MATE_KIND_MAX: 3, MATERIAL_WIN: 2,
  PUZZLE_MAX: 8, UNIQUE_MARGIN: 0.15, PUZZLE_MIN_BEST: 0.35,
  AUTO_GAMES: 20, PATTERN_SIZE: 10, PATTERN_OWN_MAX: 6, FEW_GAMES: 3, FEW_MISTAKES: 10,
} as const;

// score.ts
export function toWhite(score: UciScore, turn: Side): Score;
/** Ожидаемый результат стороны, 0..1. cp: 1 / (1 + exp(-0.00368208 * cp)) для белых; мат и over — 1, 0 или 0.5. */
export function expected(score: Score, side: Side): number;
export function lossOf(before: Score, after: Score, mover: Side): number;   // max(0, разность expected)
export function moveAccuracy(loss: number): number;   // clamp(103.1668 * exp(-4.354 * loss) - 3.1669, 0, 100)
export function formatScore(score: Score): string;

// notation.ts
/** SAN chess.js → русская запись: K→Кр, Q→Ф, R→Л, B→С, N→К, x→:, O-O→0-0, =Q→Ф. */
export function ruSan(san: string): string;
/** «8. К:g5» для хода белых, «8… h:g5» для хода чёрных. */
export function moveLabel(ply: number, san: string): string;

// material.ts
export const PIECE_VALUE: Record<'p' | 'n' | 'b' | 'r' | 'q' | 'k', number>;   // 1, 3, 3, 5, 9, 0
/** Итог размена для стороны, чей ход, если она начинает взятием uci и обе стороны бьют на этом поле
 *  самой дешёвой фигурой, пока это выгодно. Не взятие → 0. */
export function see(fen: string, uci: string): number;
/** Изменение материала для стороны, чей ход в fen, после первых plies ходов линии (взятия и превращения). */
export function swing(fen: string, line: string[], plies: number): number;
```

- [ ] **Step 1: тесты:**
  - `expected({ cp: 0 }, 'white')` = 0.5; `expected({ cp: 100 }, 'white')` ≈ 0.591 (±0.001); `expected({ cp: 100 }, 'black')` ≈ 0.409; `expected({ cp: 300 }, 'white')` ≈ 0.751; `expected({ mate: 2 }, 'white')` = 1; `expected({ mate: 2 }, 'black')` = 0; `expected({ mate: -1 }, 'white')` = 0; `expected({ over: 'draw' }, 'black')` = 0.5; `expected({ over: 'black' }, 'black')` = 1.
  - `toWhite({ cp: 50 }, 'black')` → `{ cp: -50 }`; `toWhite({ mate: 2 }, 'black')` → `{ mate: -2 }`.
  - `lossOf({ cp: 100 }, { cp: -200 }, 'white')` ≈ 0.591 − 0.324 = 0.267 (±0.002); `lossOf({ cp: 0 }, { cp: 80 }, 'white')` = 0.
  - `moveAccuracy(0)` ≈ 100 (±0.01); `moveAccuracy(0.10)` ≈ 63.6 (±0.2); `moveAccuracy(0.5)` ≈ 8.5 (±0.2); `moveAccuracy(1)` = 0.
  - `formatScore`: `{ cp: 130 }` → `'+1,3'`; `{ cp: -40 }` → `'−0,4'` (знак U+2212); `{ cp: 0 }` → `'0,0'`; `{ mate: 3 }` → `'М3'`; `{ mate: -2 }` → `'−М2'`; `{ over: 'white' }` → `'1–0'`; `{ over: 'draw' }` → `'½–½'`.
  - `ruSan`: `'Nxg5'` → `'К:g5'`; `'Kf1'` → `'Крf1'`; `'Qh5+'` → `'Фh5+'`; `'O-O'` → `'0-0'`; `'exd5'` → `'e:d5'`; `'e8=Q#'` → `'e8Ф#'`. `moveLabel(14, 'Nxg5')` → `'8. К:g5'`; `moveLabel(15, 'hxg5')` → `'8… h:g5'`.
  - `see('4k3/8/4p3/3n4/8/8/3R4/4K3 w - - 0 1', 'd2d5')` = −2; `see('4k3/8/8/3r4/8/8/3R4/4K3 w - - 0 1', 'd2d5')` = 5; `see(…, 'e1e2')` = 0.
  - `swing('4k3/8/4p3/3n4/8/8/3R4/4K3 w - - 0 1', ['d2d5', 'e6d5'], 2)` = −2; с `plies = 1` = 3; линия короче `plies` → считается сколько есть.
- [ ] **Step 2:** FAIL → реализация → PASS.
- [ ] **Step 3:** commit `feat: перевод оценок, потеря, русская запись хода, материал`.

---

### Task 5: Оценка хода, знаки, вид ошибки, фразы

**Files:**
- Create: `src/analysis/grade.ts`, `src/analysis/kinds.ts`, `src/analysis/phrases.ts` и тесты `grade.test.ts`, `kinds.test.ts`

**Interfaces:**
- Consumes: задача 4 (`CONFIG`, `expected`, `see`, `swing`, `PIECE_VALUE`), типы задачи 1.
- Produces:

```ts
// grade.ts
export function gradeOf(loss: number, playedIsBest: boolean): Grade;
/** best — линии из позиции перед ходом (белая точка зрения), сильнейшая первой. */
export function isGreat(a: { grade: Grade; best: AltMove[]; mover: Side; isRecapture: boolean }): boolean;
export function isBrilliant(a: { loss: number; fenBefore: string; move: string; before: Score; after: Score; mover: Side }): boolean;
export function summarize(moves: MoveReview[], side: Side): SideSummary;

// kinds.ts
/** reply — лучший ответ соперника после сыгранного хода (линия из позиции после хода) или null. */
export function classifyMistake(a: { fenBefore: string; played: string; best: AltMove[]; reply: AltMove | null;
  after: Score; mover: Side }): { kind: MistakeKind; phrase: string };

// phrases.ts
export const GRADE_TITLE: Record<Grade, string>;   // 'Лучший ход', 'Хороший ход', 'Неточность', 'Ошибка', 'Грубая ошибка'
export const MARK_TITLE: Record<Mark, string>;     // 'Блестящий ход', 'Сильный ход'
export const KIND_TITLE: Record<MistakeKind, string>;   // для экрана «Частые ошибки», см. таблицу в разделе 8.4 описания
export const KIND_ADVICE: Record<MistakeKind, string>;  // совет в сводке, одно короткое предложение
export const THEMES_OF_KIND: Record<MistakeKind, ThemeId[]>;
```

Правила (числа из `CONFIG`):
- `gradeOf`: `playedIsBest` → `'best'`; иначе `< GOOD_MAX` good, `< INACCURACY_MAX` inaccuracy, `< MISTAKE_MAX` mistake, иначе blunder.
- `isGreat`: `grade === 'best'`, линий не меньше двух, `expected(best[0]) − expected(best[1]) >= GREAT_GAP` для сыгравшего, и не `isRecapture` (ход бьёт на поле, куда предыдущим ходом побил соперник).
- `isBrilliant`: `loss < BRILLIANT_MAX_LOSS`; `expected(before, mover) <= BRILLIANT_MAX_BEFORE`; `expected(after, mover) >= 0.5`; в позиции после хода у соперника есть взятие фигуры сыгравшего ценой не меньше 3 с `see >= MATERIAL_WIN`; и сам ход не взял материала на столько же или больше.
- `classifyMistake`, проверки по порядку, первая сработавшая побеждает:
  1. `missedMate`: `best[0].score` — мат в пользу сыгравшего не дольше `MATE_KIND_MAX`, а `after` — не мат в его пользу не дольше `MATE_KIND_MAX`. Фраза: `Здесь был мат в N ход/хода`.
  2. `allowedMate`: `after` — мат в пользу соперника не дольше `MATE_KIND_MAX`, а `best[0].score` — нет. Фраза: `После этого хода соперник ставит мат`.
  3. `badTrade`: сыгранный ход — взятие и `swing(fenBefore, [played, ...reply.pv], 3) <= −MATERIAL_WIN`. Фраза: `Размен в пользу соперника: <отдано> за <взято>`.
  4. `pieceEnPrise`: `reply.pv[0]` бьёт на поле, куда пришла сыгранная фигура, и `swing(позиция после хода, reply.pv, 3) >= MATERIAL_WIN`. Фраза: `<Фигура> поставлен(а) под бой: его/её заберёт <фигура> <поле>`.
  5. `pieceUndefended`: `reply.pv[0]` бьёт другую фигуру сыгравшего и тот же `swing >= MATERIAL_WIN`. Фраза: `<Фигура> на <поле> остал(ся/ась) без защиты`.
  6. `missedCapture`: `best[0].move` — взятие, не равно сыгранному, `swing(fenBefore, best[0].pv, 3) >= MATERIAL_WIN`. Фраза: `Можно было забрать <фигуру>` (+ ` бесплатно`, если `see` этого взятия равен цене взятой фигуры).
  7. `missedFork`: после `best[0].move` пришедшая фигура нападает на две фигуры соперника, каждая из которых дороже её или не защищена, либо даёт шах и нападает на одну такую; и `swing(fenBefore, best[0].pv, 3) >= MATERIAL_WIN`. Фраза содержит поле вилки: `<Фигура> на <поле> нападал(а) сразу на <фигуру> и <фигуру>`.
  8. иначе `other`, фраза `Лучше было сыграть так`.
- `THEMES_OF_KIND`: `missedMate`, `allowedMate` → `['mateIn1', 'mateIn2']`; `pieceEnPrise`, `pieceUndefended`, `missedCapture` → `['hangingPiece']`; `missedFork` → `['fork']`; `badTrade`, `other` → `[]`.
- Названия фигур в фразах: пешка, конь, слон, ладья, ферзь, король, с верным родом и падежом.

- [ ] **Step 1: тесты `grade.test.ts`:** `gradeOf(0.3, true)` → best; `(0.049, false)` → good; `(0.05, false)` → inaccuracy; `(0.10, false)` → mistake; `(0.20, false)` → blunder. `isGreat` true при линиях `{ cp: 200 }` и `{ cp: -100 }` у белых; false при `{ cp: 200 }` и `{ cp: 170 }`; false при `isRecapture`; false при одной линии. `isBrilliant` для `fenBefore = '4k3/8/4p3/8/8/8/8/3RK3 w - - 0 1'`, `mover: 'white'`: ход `d1d5` (ладья встаёт под бой пешки e6) при `before = { cp: 100 }`, `after = { cp: 150 }`, `loss = 0` → true; тот же ход при `before = { cp: 900 }` → false; при `after = { cp: -100 }` → false; при `loss = 0.03` → false; тихий ход `d1d2` → false. `summarize` считает по сторонам: ходы с чётным `ply` — белые; `accuracy` — среднее `moveAccuracy(loss)`; `kinds` — только у mistake и blunder.
- [ ] **Step 2: тесты `kinds.test.ts`** (белые ходят, `mover: 'white'`, оценки с точки зрения белых):

| fenBefore | played | best[0] | reply | after | Ожидается |
|---|---|---|---|---|---|
| `6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1` | `h2h3` | `d1d8`, `{ mate: 1 }` | `g8f8`, pv `['g8f8']` | `{ cp: 500 }` | `missedMate`, фраза `Здесь был мат в 1 ход` |
| `6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1` (`mover: 'black'`) | `g8h8` | `h7h6`, `{ cp: 450 }` | `d1d8`, pv `['d1d8']` | `{ mate: 1 }` | `allowedMate` |
| `4k3/8/4p3/3n4/8/8/3R4/4K3 w - - 0 1` | `d2d5` | `e1e2`, `{ cp: 150 }` | `e6d5`, pv `['e6d5']` | `{ cp: -200 }` | `badTrade`, фраза содержит `ладья за коня` |
| `4k3/8/8/4p3/8/8/4N3/4K3 w - - 0 1` | `e2d4` | `e2c3`, `{ cp: 200 }` | `e5d4`, pv `['e5d4']` | `{ cp: -100 }` | `pieceEnPrise`, фраза содержит `Конь` и `e5` |
| `2r1k3/8/8/8/2B5/1P6/8/4K3 w - - 0 1` | `b3b4` | `e1d2`, `{ cp: -150 }` | `c8c4`, pv `['c8c4']` | `{ cp: -500 }` | `pieceUndefended`, фраза содержит `Слон на c4` |
| `4k3/8/8/3r4/8/8/3R4/4K3 w - - 0 1` | `d2e2` | `d2d5`, `{ cp: 500 }`, pv `['d2d5']` | `e8d7`, pv `['e8d7']` | `{ cp: 0 }` | `missedCapture`, фраза `Можно было забрать ладью бесплатно` |
| `r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1` | `e1e2` | `b5c7`, `{ cp: 500 }`, pv `['b5c7','e8d7','c7a8']` | `a8a2`, pv `['a8a2']` | `{ cp: -200 }` | `missedFork`, фраза содержит `c7` |
| `4k3/8/8/8/8/8/4P3/4K3 w - - 0 1` | `e1d1` | `e2e4`, `{ cp: 100 }` | `e8d7`, pv `['e8d7']` | `{ cp: 0 }` | `other`, фраза `Лучше было сыграть так` |

  Плюс: `reply: null` не роняет функцию и даёт вид по первым двум и последним трём правилам.
- [ ] **Step 3:** FAIL → реализация → PASS.
- [ ] **Step 4:** commit `feat: оценка хода, знаки отличия, вид ошибки и фразы`.

---

### Task 6: Разбор партии в два прохода и задачи из неё

**Files:**
- Create: `src/analysis/analyseGame.ts`, `src/analysis/gamePuzzles.ts`, `src/analysis/testEngine.ts` (подставной движок для тестов), тесты `analyseGame.test.ts`, `gamePuzzles.test.ts`

**Interfaces:**
- Consumes: `AnalysisEngine`, `EngineLine`, `AnalysisPriority` (задача 3); задачи 4–5.
- Produces:

```ts
// analyseGame.ts
export interface AnalyseDeps { engine: Pick<AnalysisEngine, 'analyse'>; priority: AnalysisPriority;
  signal?: AbortSignal; onProgress?(done: number, total: number): void; now?: () => number }
/** null — движок не ответил хотя бы на один запрос или разбор отменён. Частичного результата не бывает. */
export async function analyseGame(game: GameRecord, deps: AnalyseDeps): Promise<GameAnalysis | null>;

// gamePuzzles.ts
export const gamePuzzleId = (gameId: string, ply: number) => `g:${gameId}:${ply}`;
export const isGamePuzzleId = (id: string) => id.startsWith('g:');
export function selectPuzzles(game: GameRecord, a: GameAnalysis): GamePuzzle[];
/** old — сохранённые задачи этой партии, fresh — отбор по новому разбору. */
export function reconcile(old: GamePuzzle[], fresh: GamePuzzle[], a: GameAnalysis): { put: GamePuzzle[]; removeIds: string[] };
export function toPuzzle(p: GamePuzzle): Puzzle;   // rating: 0, themes: THEMES_OF_KIND[kind], game: { gameId, ply, phrase }

// testEngine.ts
/** Отвечает по таблице fen → линии; на неизвестный fen — одна линия { cp: 0 } с первым допустимым ходом. */
export function tableEngine(table: Record<string, EngineLine[]>): Pick<AnalysisEngine, 'analyse'> & { calls: { fen: string; nodes: number; multipv: number }[] };
```

Алгоритм `analyseGame` (N — число полуходов):
1. Позиции 0..N получаются проигрыванием `moves` в `chess.js`. Позиция без допустимых ходов движку не отдаётся: мат → `{ over: победитель }`, пат → `{ over: 'draw' }`.
2. Первый проход: каждая остальная позиция — `analyse(fen, { nodes: FAST_NODES, multipv: FAST_MULTIPV })`. `scores[i]` — оценка первой линии в белой точке зрения. Для хода i: `best` — линии позиции i, `loss = lossOf(scores[i], scores[i+1], mover)`, оценка — `gradeOf(loss, move === best[0].move)`.
3. Отбор во второй проход: ходы с `loss >= DEEP_TRIGGER_LOSS`; ходы-кандидаты на «сильный» (сыгран лучший, линий две, разрыв `>= GREAT_GAP`); кандидаты на «блестящий» (условия `isBrilliant` по данным первого прохода). Не больше `DEEP_MAX_MOVES`: сначала ходы владельца (`game.userColor`), внутри — по убыванию потери.
4. Второй проход для отобранного хода i: позиция i — `{ nodes: DEEP_NODES, multipv: DEEP_MULTIPV }`; позиция i+1 (если в ней есть ходы) — `{ nodes: DEEP_NODES, multipv: 1 }`. Если сыгранный ход есть среди глубоких линий позиции i, оценка «после» берётся из его линии, иначе из поиска позиции i+1. Потеря, оценка, `best` пересчитываются; `deep = true`; `scores[i]` и `scores[i+1]` заменяются глубокими. Для mistake и blunder — `classifyMistake` (ответ соперника — линия поиска позиции i+1). Затем `isGreat`, `isBrilliant`.
5. Ходы mistake и blunder без второго прохода получают `kind: 'other'` и общую фразу.
6. `white`, `black` — `summarize`; `rulesVersion = CONFIG.RULES_VERSION`; `tookMs` — по `now()`.
7. `onProgress(done, total)` после каждого запроса к движку; `total` первого прохода известен сразу, после отбора увеличивается.

`selectPuzzles`: ходы владельца с `grade` mistake или blunder, `deep === true`, `ply >= 1`, `best.length >= 2`, `expected(best[0]) − expected(best[1]) >= UNIQUE_MARGIN` и `expected(best[0]) >= PUZZLE_MIN_BEST` (для владельца). По убыванию `loss`, не больше `PUZZLE_MAX`. `fen` — позиция `ply − 1`, `moves = [game.moves[ply − 1], best[0].move]`.

`reconcile`: старая задача остаётся (в `put` не попадает, в `removeIds` тоже), если `a.moves[old.ply].best[0].move === old.moves[1]`; иначе её id в `removeIds`. Новые задачи, которых не было среди старых, — в `put`.

- [ ] **Step 1: тесты `analyseGame.test.ts`** на `tableEngine`:
  - партия детского мата из задачи 2 (7 полуходов): `scores` длины 8, последний — `{ over: 'white' }`; `moves` длины 7; для последней позиции движок не вызывался.
  - таблица, где после 3-го хода чёрных оценка падает с `{ cp: 0 }` до `{ cp: 400 }` (в белой точке зрения): этот ход получает `deep: true`, оценку blunder, поле `kind` заполнено; движок вызван для его позиции с `nodes: 300000, multipv: 3`.
  - спокойные ходы: `deep: false`, вызовы только с `nodes: 60000, multipv: 2`.
  - движок вернул `null` на одном запросе → результат `null`.
  - `signal.abort()` посреди разбора → `null`, дальнейших вызовов движка нет.
  - ограничение `DEEP_MAX_MOVES`: в партии с 30 ходами выше порога во второй проход идут 20, ходы владельца первыми.
  - `onProgress` вызывается с растущим `done` и в конце `done === total`.
- [ ] **Step 2: тесты `gamePuzzles.test.ts`** на собранных руками `GameAnalysis`:
  - ход владельца blunder, deep, линии `{ cp: 300 }` и `{ cp: -50 }` → задача с `id = 'g:<id>:<ply>'`, `moves[1]` — первая линия, `fen` — позиция перед ходом соперника; `startPuzzle(toPuzzle(p))` из `src/domain/puzzle.ts` не бросает, и `tryMove` с `moves[1]` даёт `'solved'`.
  - не попадают: ход соперника; `deep: false`; одна линия; линии `{ cp: 300 }` и `{ cp: 250 }`; обе линии — маты в пользу владельца; лучшая линия `{ cp: -400 }` для владельца-белых; `ply === 0`.
  - 12 подходящих → 8 с наибольшей потерей.
  - `reconcile`: старая задача с прежним лучшим ходом остаётся нетронутой; старая, у которой лучший ход сменился, — в `removeIds`; новая — в `put`.
  - `toPuzzle(...).game` заполнено, `rating === 0`, `themes` для `missedFork` — `['fork']`.
- [ ] **Step 3:** FAIL → реализация → PASS.
- [ ] **Step 4:** commit `feat: разбор партии в два прохода и отбор задач из неё`.

---

### Task 7: Очередь разбора и фоновая работа

**Files:**
- Create: `src/analysis/queue.ts`, `src/analysis/queue.test.ts`, `src/games/gamesStore.ts`, `src/games/gamesStore.test.ts`
- Modify: `src/App.tsx` (смонтировать `<GamesBackground />` внутри `HashRouter`)

**Interfaces:**
- Consumes: `analyseGame`, `selectPuzzles`, `reconcile` (6); `gamesRepo` (1); `syncGames`, `ChessComError` (2); `analysisEngine` (3).
- Produces:

```ts
// queue.ts
export interface QueueStatus { total: number; analysed: number;
  running: { gameId: string; done: number; total: number } | null; lastError: string | null }
export interface AnalysisQueue {
  start(): void; stop(): void;
  /** Ставит партию первой и считает с приоритетом screen. Готовый разбор текущей версии отдаёт сразу. */
  open(gameId: string): Promise<GameAnalysis | null>;
  setRange(gameIds: string[]): void;      // партии выбранного промежутка «Частых ошибок»
  refresh(): Promise<void>;               // перечитать партии из базы (после загрузки или смены ника)
  status(): QueueStatus; subscribe(fn: () => void): () => void;
}
export function createAnalysisQueue(deps: { engine: Pick<AnalysisEngine, 'analyse'>;
  isVisible(): boolean; onVisibilityChange(fn: () => void): () => void }): AnalysisQueue;

// gamesStore.ts
export interface GamesState { sync: 'idle' | 'loading' | 'error' | 'offline'; syncError: string | null;
  syncProgress: { done: number; total: number } | null; queue: QueueStatus; revision: number /* растёт при изменении данных */ }
export const gamesQueue: AnalysisQueue;
export function useGamesState(): GamesState;         // useSyncExternalStore
export async function syncNow(): Promise<void>;      // не бросает: ошибка уходит в состояние
/** В App: при монтировании и при возвращении в приложение (не чаще раза в 10 минут) — syncNow, затем gamesQueue.refresh() и start(). Без ника ничего не делает. */
export function GamesBackground(): null;
```

Порядок очереди: открытая партия (`open`) → партии `setRange` от новых к старым → последние `AUTO_GAMES` партий с `timeClass` rapid или daily → партии с разбором старой версии правил. Блиц и пуля — только через `open`. Одна партия за раз. `total` — все партии, `analysed` — с разбором текущей версии.

Когда приложение не видно (`isVisible() === false`): текущий разбор отменяется (`AbortController`), очередь ждёт; при возвращении продолжает, прерванная партия считается заново. Результат `null` от `analyseGame`: партия уходит в конец; вторая неудача той же партии за сеанс исключает её из очереди до перезапуска и пишет `lastError` (`Не удалось разобрать партию: движок не ответил`). Успех: `saveAnalysis(a, reconcile(старые, selectPuzzles(game, a), a))`, `revision` растёт.

Тексты `syncError`: notFound — `Игрок не найден`; offline — состояние `'offline'`, текст `Нет сети, список не обновлён`; bad — `Chess.com ответил ошибкой` плюс текст причины.

- [ ] **Step 1: тесты `queue.test.ts`** (fake-indexeddb, `tableEngine`, управляемая видимость):
  - 25 партий рапида и 5 блица без разборов, `start()` → разобраны 20 самых новых партий рапида, блиц не тронут; `status().analysed === 20`, `total === 30`.
  - `open(blitzId)` разбирает блиц и возвращает разбор; движок для неё вызывается с `priority: 'screen'`.
  - `open` партии с готовым разбором текущей версии не вызывает движок.
  - `setRange([...])` с партией вне последних 20 → она разобрана раньше автоматических.
  - разбор версии `RULES_VERSION − 1` пересчитывается после остальных; задача, чей лучший ход сменился, удалена вместе с записью повторения.
  - видимость `false` посреди партии → в базе нет её разбора; после `true` партия разобрана.
  - движок отвечает `null` на всё для одной партии → остальные разобраны, эта исключена после двух попыток, `lastError` заполнен, очередь не крутится вхолостую (число вызовов движка конечно).
  - подписчик вызывается при изменении `running` и `analysed`.
- [ ] **Step 2: тесты `gamesStore.test.ts`:** `syncNow` при `ChessComError('notFound')` → `sync: 'error'`, `syncError: 'Игрок не найден'`; при offline → `sync: 'offline'`; при успехе `revision` вырос, `sync: 'idle'`. `GamesBackground` без ника не делает запросов.
- [ ] **Step 3:** FAIL → реализация → PASS; `npm test`, `npx tsc -b`.
- [ ] **Step 4:** commit `feat: очередь разбора и фоновая загрузка партий`.

---

### Task 8: Вкладка «Партии», ник

**Files:**
- Create: `src/screens/games/GamesScreen.tsx`, `GamesScreen.css`, `NickForm.tsx`, `GamesScreen.test.tsx`
- Modify: `src/ui/TabBar.tsx` (четвёртая вкладка между «Задачи» и «Профиль», путь `/games`, своя иконка), `src/ui/TabBar.test.tsx`, `src/App.tsx` (маршрут `/games`), `src/screens/ProfileScreen.tsx` (строка «Ник на Chess.com» → смена ника), `src/screens/ProfileScreen.test.tsx`

**Interfaces:**
- Consumes: `useGamesState`, `syncNow`, `gamesQueue` (7); `getGames`, `getAnalyses`, `getChessUser`, `setChessUser`, `changeNick` (1); `fetchPlayer`, `normalizeNick`, `ChessComError` (2).
- Produces: `GamesScreen`, `NickForm({ current?: string; onSaved(): void })`.

Поведение:
- Без ника вкладка показывает `NickForm`: поле, кнопка «Найти партии». Проверка — `fetchPlayer`; `notFound` → «Игрок не найден», `offline` → «Нет сети. Проверь интернет и попробуй ещё раз». Успех: первый ник — `setChessUser({ nick, loadedThrough: null })`, затем `syncNow()`.
- С ником: блок «Частые ошибки» (ссылка на `/games/patterns`), строка состояния («Разобрано 15 из 94»; при `queue.running` — «Идёт разбор…»; при загрузке — «Загружаю партии: 3 из 21»; `offline` — «Нет сети, список не обновлён»; `error` — текст и «Повторить»), кнопка «Обновить» (`syncNow`), список.
- Строка партии: соперник и его рейтинг, цвет владельца (кружок), результат («Победа», «Поражение», «Ничья»), дата `ДД.ММ.ГГГГ`, вид («Рапид», «Блиц», «Пуля», «По переписке»); у разобранной — «Ошибок: N» (mistake + blunder стороны владельца). Нажатие → `/games/:gameId`.
- Пустой список после загрузки: «Партий пока нет».
- Профиль: строка «Ник на Chess.com: <ник>» открывает `Sheet` с `NickForm` и предупреждением «Партии и задачи из них для прежнего ника будут удалены»; сохранение — `changeNick`, затем `gamesQueue.refresh()` и `syncNow()`. Без ника строка называется «Подключить Chess.com».

- [ ] **Step 1: тесты `GamesScreen.test.tsx`** (подставные `fetchPlayer`/`syncNow` через параметры или `vi.mock`):
  - без ника видна форма; ввод ` Nirzarti ` и нажатие → `fetchPlayer` вызван с `'nirzarti'`; после успеха в базе `nick: 'nirzarti'`.
  - `notFound` → на экране «Игрок не найден», ник не сохранён.
  - с ником и тремя партиями — три строки в порядке от новой к старой; у разобранной «Ошибок: 4».
  - состояние `offline` → строка «Нет сети, список не обновлён», список показан.
  - `TabBar` содержит четыре ссылки в порядке Учёба, Задачи, Партии, Профиль.
  - профиль: смена ника вызывает `changeNick` только после подтверждения в листе.
- [ ] **Step 2:** FAIL → реализация → PASS; `npm test`, `npx tsc -b`.
- [ ] **Step 3:** commit `feat: вкладка «Партии» и подключение ника`.

---

### Task 9: Сводка партии

**Files:**
- Create: `src/screens/games/GameSummaryScreen.tsx`, `GameSummaryScreen.css`, `GameSummaryScreen.test.tsx`
- Modify: `src/App.tsx` (маршрут `/games/:gameId`)

**Interfaces:**
- Consumes: `getGame`, `getAnalysis`, `getGamePuzzles` (1); `gamesQueue.open`, `useGamesState` (7); `GRADE_TITLE`, `MARK_TITLE`, `KIND_ADVICE` (5).
- Produces: `GameSummaryScreen`.

Поведение: шапка (назад к `/games`, «Ты — соперник», результат, дата). Нет разбора → `gamesQueue.open(gameId)`, полоса `ProgressBar` по `queue.running` с подписью «Разбираю партию…»; `null` → «Не удалось разобрать партию» + текст `lastError` + «Повторить». Есть разбор → таблица в два столбца («Ты», соперник): строки Блестящие, Сильные, Лучшие, Хорошие, Неточности, Ошибки, Грубые ошибки, Точность (целый процент). Строки «Блестящие» и «Сильные» показываются, только если хотя бы у одной стороны не ноль. Совет: один-два самых частых `kind` владельца в этой партии, кроме `other`, по убыванию: «N раз: <KIND_TITLE>. <KIND_ADVICE>». Внизу мелко: «Разбор занял N с» (из `tookMs`). Кнопки (прижаты к низу): «Смотреть разбор» → `/games/:gameId/review`; «Исправить ошибки» → `/games/:gameId/fix`, только если `getGamePuzzles(gameId)` не пуст. Неизвестный `gameId` → «Партия не найдена» и кнопка «К партиям».

- [ ] **Step 1: тесты:** таблица показывает числа из `white`/`black` в столбцах по цвету владельца (владелец чёрными → его столбец из `black`); точность `87.4` показана как `87%`; совет называет вид с наибольшим счётом; «Исправить ошибки» нет при пустом списке задач; без разбора вызван `gamesQueue.open` и видна полоса; `open` вернул `null` → текст сбоя и «Повторить»; неизвестная партия → «Партия не найдена».
- [ ] **Step 2:** FAIL → реализация → PASS.
- [ ] **Step 3:** commit `feat: сводка партии`.

---

### Task 10: Экран разбора

**Files:**
- Create: `src/screens/games/ReviewScreen.tsx`, `ReviewScreen.css`, `EvalBar.tsx`, `MoveCard.tsx`, `GameChart.tsx`, `reviewModel.ts`, тесты `reviewModel.test.ts`, `ReviewScreen.test.tsx`
- Modify: `src/ui/Board.tsx` и `board.css` (цвет стрелки, тон подсветки последнего хода, значок на поле), `src/ui/Board.test.tsx`, `src/App.tsx` (маршрут `/games/:gameId/review`; `isFullscreenRoute` возвращает true для `/games/<id>/review`, `/games/<id>/fix`, `/games/patterns/train`)

**Interfaces:**
- Consumes: `getGame`, `getAnalysis` (1); `expected`, `formatScore`, `ruSan`, `moveLabel`, `CONFIG.ALT_MAX_LOSS` (4); `GRADE_TITLE`, `MARK_TITLE` (5).
- Produces:

```ts
// Board.tsx — новые необязательные свойства; прежнее поведение без них не меняется
arrows?: ([string, string] | { from: string; to: string; tone: 'best' | 'alt' })[];
lastMoveTone?: 'normal' | 'bad';
badge?: { square: string; text: string; tone: Grade | Mark };

// reviewModel.ts
export interface PlyView { fen: string; lastMove: [string, string] | null; score: Score;
  review: MoveReview | null /* ход, приведший к позиции; null в начальной */; label: string | null }
export function buildPlyViews(game: GameRecord, a: GameAnalysis): PlyView[];      // длина moves.length + 1
/** Варианты «Лучше было»: лучший ход и те, что уступают ему меньше ALT_MAX_LOSS; не больше трёх. */
export function alternatives(review: MoveReview, mover: Side): AltMove[];
export function nextUserMistake(a: GameAnalysis, userColor: Side, fromPly: number): number | null;
/** Точки графика: доля белых 0..1 для каждой позиции. */
export function chartPoints(a: GameAnalysis): number[];
export const badgeText: (r: MoveReview) => string | null;   // '!!', '!', '?!', '?', '??' или null
```

Экран (сверху вниз, расположение — раздел 9.3 описания и набросок `.superpowers/brainstorm/441-1794756645/content/review-layout.html`): строка «‹ Партии / Ты — соперник · результат»; `EvalBar` слева от доски (цвет владельца внизу, число `formatScore`); доска цветом владельца вниз, не интерактивная в этой задаче; `MoveCard`; `GameChart`; кнопки ◀ «Следующая ошибка» ▶, прижатые к низу.

- Экран открывается на позиции 0; параметр адреса `?ply=N` открывает на позиции после хода N (то есть индекс N + 1).
- Доска на позиции i > 0: `lastMove` — сыгранный ход, `lastMoveTone: 'bad'` для mistake и blunder; значок `badgeText` на поле прибытия; зелёная стрелка (`tone: 'best'`) лучшего хода, если сыгран не он; при выборе варианта в карточке — его стрелка (`tone: 'alt'`).
- `MoveCard`: в позиции 0 — «Начало партии»; иначе плашка `MARK_TITLE` или `GRADE_TITLE` своим цветом, `label`, `phrase` (если есть), блок «Лучше было» со строками `alternatives` (запись хода по-русски и `formatScore` его оценки) — блок не показывается, если сыгран лучший ход и вариант один. Ход соперника получает такую же карточку.
- `GameChart`: SVG во всю ширину; верхняя половина поля светлая, нижняя тёмная; линия по `chartPoints` (вверх — лучше у белых); точки на ошибках (`#E8873A`) и грубых ошибках (`#E25C4C`) владельца и на его «!»/«!!»; вертикальная метка текущей позиции; нажатие и ведение пальцем (pointer events) переносят на ближайшую позицию.
- ◀ ▶ — на одну позицию, на краях выключены. «Следующая ошибка» — `nextUserMistake` от текущей позиции; `null` → кнопка выключена.

- [ ] **Step 1: тесты `reviewModel.test.ts`:** `buildPlyViews` для партии детского мата: длина 8, `[0].review === null`, `[7].label === '4. Ф:f7#'`, `[1].lastMove` равен `['e2','e4']`. `alternatives` для линий с потерями 0, 0.03, 0.2 → две; для одной линии → одна. `nextUserMistake` пропускает ошибки соперника и возвращает `null` после последней. `chartPoints` для `{ cp: 0 }` → 0.5, `{ mate: -2 }` → 0. `badgeText`: brilliant → `'!!'`, great → `'!'`, inaccuracy → `'?!'`, mistake → `'?'`, blunder → `'??'`, best без знака → `null`.
- [ ] **Step 2: тесты `ReviewScreen.test.tsx`** (партия и разбор в fake-indexeddb): открывается с «Начало партии»; ▶ показывает `1. e4`; «Следующая ошибка» переводит на ход с mistake владельца и показывает его фразу и блок «Лучше было»; `?ply=3` открывает четвёртую позицию; нажатие на вариант добавляет стрелку `alt`; на последней позиции ▶ выключена; шкала показывает `formatScore` текущей позиции; у хода соперника с blunder карточка «Грубая ошибка».
- [ ] **Step 3: тесты `Board.test.tsx`:** прежние проходят без правок; `badge` рисует элемент с текстом на нужном поле; `lastMoveTone: 'bad'` ставит отдельный класс полям хода.
- [ ] **Step 4:** FAIL → реализация → PASS; `npm test`, `npx tsc -b`.
- [ ] **Step 5:** commit `feat: экран разбора партии`.

---

### Task 11: Проба своих ходов

**Files:**
- Modify: `src/screens/games/ReviewScreen.tsx`, `ReviewScreen.css`, `ReviewScreen.test.tsx`
- Create: `src/screens/games/useExplore.ts`, `useExplore.test.ts`

**Interfaces:**
- Consumes: `analysisEngine` (3) — в экран передаётся параметром `engine` с этим значением по умолчанию; `toWhite`, `CONFIG.EXPLORE_NODES` (4); `legalDests` из `src/domain/puzzle.ts`.
- Produces:

```ts
export interface ExploreState { active: boolean; fen: string; lastMove: [string, string] | null;
  score: Score | null; best: AltMove | null; thinking: boolean; failed: boolean; depth: number /* ходов в варианте */ }
export function useExplore(engine: Pick<AnalysisEngine, 'analyse'>): ExploreState & {
  start(fen: string, uci: string): void; move(uci: string): void; back(): void; exit(): void };
```

Поведение: в разборе доска становится интерактивной для стороны, чей ход в показанной позиции. Первый ход вызывает `start` — режим «Свой вариант»: плашка над карточкой, ход за обе стороны по очереди. После каждого хода: `engine.analyse(fen, { nodes: EXPLORE_NODES, multipv: 1, priority: 'screen', signal })`; предыдущий незавершённый запрос отменяется. Пока ответа нет — шкала держит прежнее значение, карточка пишет «Считаю…»; ответ — шкала и зелёная стрелка лучшего хода, карточка: оценка и «Лучший ход: …»; `null` (не из-за отмены) — «Движок не ответил», доска остаётся рабочей. Позиция без ходов движку не отдаётся: карточка пишет «Мат» или «Пат». Кнопки режима заменяют ◀ ▶: «Шаг назад» (при `depth === 1` выходит из режима) и «Вернуться к партии» (к позиции, с которой ушли). График в режиме неактивен. Уход с экрана отменяет запрос.

- [ ] **Step 1: тесты `useExplore.test.ts`** (`tableEngine`): `start` → `active`, `thinking` → после ответа `score` в белой точке зрения (ход чёрных, движок дал `{ cp: 80 }` → `{ cp: -80 }`); второй `move` до ответа отменяет первый запрос (его `signal.aborted`); `back` с глубины 2 возвращает позицию глубины 1; `back` с глубины 1 и `exit` → `active: false`; ответ `null` → `failed: true`, следующий `move` работает; позиция мата → движок не вызван.
- [ ] **Step 2: тесты в `ReviewScreen.test.tsx`:** ход на доске показывает плашку «Свой вариант» и кнопки «Шаг назад», «Вернуться к партии»; «Вернуться к партии» возвращает карточку исходного хода.
- [ ] **Step 3:** FAIL → реализация → PASS.
- [ ] **Step 4:** commit `feat: проба своих ходов в разборе`.

---

### Task 12: «Исправить ошибки»

**Files:**
- Create: `src/screens/gameLessons.ts`, `gameLessons.test.ts`, `src/domain/attempt.ts`, `attempt.test.ts`
- Modify: `src/data/puzzleStore.ts` (`findPuzzle`), `src/screens/lessonFactory.ts`, `src/screens/LessonScreen.tsx`, `src/screens/PuzzlesScreen.tsx`, `src/screens/TaskRunner.tsx`, `src/App.tsx` (маршрут `/games/:gameId/fix`), соответствующие тесты

**Interfaces:**
- Consumes: `getGamePuzzle`, `getGamePuzzles` (1); `toPuzzle`, `isGamePuzzleId` (6).
- Produces:

```ts
// attempt.ts — что записывать о попытке
export function puzzleAttempt(puzzle: Puzzle, source: Source, seen: ReadonlySet<string>):
  { puzzleId: string; themes: ThemeId[]; puzzleRating: number | undefined; rated: boolean };
// gameLessons.ts
export const GAME_NODE_PREFIX = 'game:';
export async function gameLesson(gameId: string): Promise<Lesson>;   // title 'Исправить ошибки', source 'game'
// LessonScreen.tsx
export function RepeatLessonScreen(p: { nodeId: string; exitTo: string }): JSX.Element;   // обобщение WeakSpotsScreen
// LessonScreen получает необязательное exitTo (по умолчанию '/learn'): куда вести по выходу и после итога
```

Правила:
- `puzzleAttempt`: у задачи с `puzzle.game` — `puzzleRating: undefined`, `rated: false` при любом источнике; иначе как сейчас в `LessonRun` (`rated = source !== 'review' && !seen.has(id)`, `puzzleRating = puzzle.rating`). `LessonRun` и `ReviewRun` переходят на эту функцию (`ReviewRun` — с `rated: false`, как было).
- `findPuzzle(id)`: при `isGamePuzzleId(id)` — `getGamePuzzle(id)` и `toPuzzle`, без загрузки файлов кругов; иначе как было.
- `lessonFactory`: `nodeId` с префиксом `game:` → `gameLesson`. Задачи партии по возрастанию `ply`; нет задач → `LessonNotFoundError`.
- Маршрут `/games/:gameId/fix` → `<RepeatLessonScreen nodeId={'game:' + gameId} exitTo={'/games/' + gameId} />`. `WeakSpotsScreen` становится обёрткой над `RepeatLessonScreen` с `nodeId="weak"`, `exitTo="/learn"`.
- `PuzzleTask` в `TaskRunner.tsx` для задачи с `puzzle.game`: рядом с подписью стороны метка «Из твоей партии»; после решения или показа решения под вердиктом — `puzzle.game.phrase` и ссылка «Открыть этот ход в разборе» на `/games/<gameId>/review?ply=<ply>`.
- Урок завершается обычным `completeLesson` (опыт, занятие для серии). Записи `lessons` с `nodeId` на `game:` не влияют на путь.

- [ ] **Step 1: тесты:**
  - `attempt.test.ts`: задача с `game` и источник `'game'` → `{ puzzleRating: undefined, rated: false }`; обычная невиденная в `'lesson'` → `rated: true`, рейтинг задачи; обычная в `'review'` → `rated: false`.
  - `puzzleStore.test.ts`: `findPuzzle('g:x:5')` возвращает задачу из базы с `game.ply === 5` и не делает `fetch`; для неизвестного `g:`-id — `undefined`.
  - `gameLessons.test.ts`: урок из трёх задач в порядке `ply`; партия без задач → `LessonNotFoundError`.
  - `LessonScreen.test.tsx`: урок с источником `'game'` — после ошибки в задаче в `reviews` есть запись с её `g:`-id, `profile.rating` и `ratingHistory` не изменились, опыт вырос; после завершения `days` сегодняшнего дня имеет `lessons: 1`; выход ведёт на `exitTo`.
  - `PuzzlesScreen.test.tsx`: запись повторения с `g:`-id, задача есть в базе → она показана с меткой «Из твоей партии» и не удалена. **(Review Focus 5)** запись повторения с `g:`-id, задачи в базе нет (после `changeNick`) → экран открывается, запись удалена, показано «На сегодня всё повторено».
  - `TaskRunner`: после решения задачи с `game` видны фраза и ссылка с адресом `/games/x/review?ply=5`.
  - `src/domain/path.test.ts`: строка `lessons` с `nodeId: 'game:x'` не меняет результат `buildPath`.
- [ ] **Step 2:** FAIL → реализация → PASS; `npm test`, `npx tsc -b`.
- [ ] **Step 3:** commit `feat: «Исправить ошибки» — задачи из своей партии`.

---

### Task 13: «Частые ошибки»

**Files:**
- Create: `src/analysis/patterns.ts`, `patterns.test.ts`, `src/screens/games/PatternsScreen.tsx`, `PatternsScreen.css`, `PatternsScreen.test.tsx`
- Modify: `src/screens/gameLessons.ts` и тест, `src/screens/lessonFactory.ts`, `src/App.tsx` (маршруты `/games/patterns`, `/games/patterns/train`; первый объявить раньше `/games/:gameId`)

**Interfaces:**
- Consumes: задачи 1, 5, 6, 7, 12; `loadOpenPool`, `openBand`, `openThemesOf` из `src/screens/openThemes.ts`.
- Produces:

```ts
// patterns.ts
export const RANGE_OPTIONS: { choice: RangeChoice; label: string }[];
// 'Последние 10', 'Последние 20', 'Последние 50', 'За неделю', 'За месяц', 'За три месяца', 'За всё время'
/** Только rapid и daily, от новых к старым. Неделя — 7 дней, месяц — 30, три месяца — 90 от now. */
export function gamesInRange(games: GameRecord[], range: RangeChoice, now: number): GameRecord[];
/** Ошибки и грубые ошибки владельца по видам, по убыванию числа; при равенстве — порядок объявления MistakeKind. */
export function countKinds(games: GameRecord[], analyses: GameAnalysis[]): { kind: MistakeKind; count: number }[];
export function tooFew(analysedGames: number, mistakes: number): boolean;   // < FEW_GAMES или < FEW_MISTAKES
/** До трёх самых частых видов, кроме 'other'; если других нет — ['other']. */
export function trainKinds(counts: { kind: MistakeKind; count: number }[]): MistakeKind[];
// gameLessons.ts
export const PATTERN_NODE = 'pattern';
export async function patternLesson(now?: Date): Promise<Lesson>;   // title 'Частые ошибки', source 'pattern'
```

`patternLesson`: промежуток из `getPatternRange()`; партии — `gamesInRange`; виды — `trainKinds(countKinds(...))`. Свои задачи: `GamePuzzle` этих партий с `kind` из выбранных, сначала те, чьих id нет в `getCleanPuzzleIds()`, внутри — от новых партий к старым; не больше `PATTERN_OWN_MAX`. Задачи базы: темы `THEMES_OF_KIND` выбранных видов (без повторов), пул и коридор как в `weakLesson` (`loadOpenPool(circle)`, `openBand(circle)`), `near: profile.rating`, исключая виденные; поровну между темами. Всего `PATTERN_SIZE`: если своих меньше `PATTERN_OWN_MAX`, остаток добирается базой; если тем нет — только свои. Порядок — вперемешку: своя, из базы, своя… Ноль задач → `LessonNotFoundError`. Маршрут `/games/patterns/train` → `<RepeatLessonScreen nodeId="pattern" exitTo="/games/patterns" />`.

Экран `PatternsScreen`: назад к `/games`; переключатель из `RANGE_OPTIONS` (две группы: по числу, по времени), выбор сохраняется `setPatternRange` и передаётся `gamesQueue.setRange(id неразобранных партий промежутка)`; строка «Партий: N, разобрано: M»; при `M < N` — «Разобрано M из N, считаю дальше»; при `tooFew` — «Мало партий, выводы неточные»; список видов: `KIND_TITLE`, число, полоса длиной по доле от наибольшего; кнопка «Тренировать» (прижата к низу; выключена, если нет ни одной разобранной партии). Данные перечитываются при росте `revision`.

- [ ] **Step 1: тесты `patterns.test.ts`:**
  - `gamesInRange`: из 30 рапидов и 10 блицев `{ by: 'count', n: 20 }` → 20 самых новых рапидов; `{ by: 'time', span: 'week' }` → только партии не старше 7 суток от `now`; `daily` входит, `blitz` и `bullet` нет; `'all'` → все rapid и daily.
  - `countKinds`: считает только ходы владельца (`ply % 2` по `userColor`) с mistake или blunder; порядок по убыванию.
  - `tooFew(2, 50)` → true; `tooFew(3, 9)` → true; `tooFew(3, 10)` → false.
  - `trainKinds`: из `pieceEnPrise 9, other 7, missedMate 4, missedCapture 2, missedFork 1` → `['pieceEnPrise','missedMate','missedCapture']`; только `other` → `['other']`.
- [ ] **Step 2: тесты `gameLessons.test.ts`:** 8 своих задач выбранных видов, 3 из них уже решены чисто → в уроке 6 своих, нерешённые первыми; остальные 4 — из базы с темой `hangingPiece` или `mateIn1`/`mateIn2` (тестовый пул из `src/domain/testPool.ts`); своих 2 → 2 своих и 8 из базы; вид без темы (`badTrade`) и 3 своих → урок из 3 задач; ничего нет → `LessonNotFoundError`.
- [ ] **Step 3: тесты `PatternsScreen.test.tsx`:** по умолчанию выбран «Последние 20»; выбор «За месяц» сохраняется и вызывает `gamesQueue.setRange` с id неразобранных партий месяца; показано «Разобрано 2 из 5, считаю дальше»; при двух разобранных партиях — «Мало партий, выводы неточные»; виды в порядке убывания с числами.
- [ ] **Step 4:** FAIL → реализация → PASS; `npm test`, `npx tsc -b`.
- [ ] **Step 5:** commit `feat: «Частые ошибки» — подсчёт по промежутку и урок`.

---

### Task 14: Резервная копия версии 2

**Files:**
- Modify: `src/data/backup.ts`, `src/data/backup.test.ts`, `src/screens/BackupScreen.tsx` (после восстановления — `gamesQueue.refresh()`)

**Interfaces — Produces:** прежние `exportBackup`, `importBackup`; `VERSION = 2`.

Правила: выгрузка включает все таблицы, включая три новые. Чтение принимает версии 1 и 2. Версия 2: проверяются и заменяются все таблицы; ключи новых: `games` — строка `id` и массив `moves`; `analyses` — строка `gameId` и массивы `moves`, `scores`; `gamePuzzles` — строка `id` и массив `moves` длины 2. Версия 1: проверяются и заменяются только таблицы этапа 1; `games`, `analyses`, `gamePuzzles` не трогаются; строки `kv` с ключами `chessUser` и `patternRange`, которые были на устройстве, сохраняются поверх содержимого файла. Любая другая версия — «Файл от другой версии приложения».

- [ ] **Step 1: тесты:** выгрузка и восстановление версии 2 возвращают партии, разборы, задачи из партий и ник; файл версии 1 (собранный в тесте из шести таблиц этапа 1 и `version: 1`) восстанавливается: прогресс заменён, партии и ник на устройстве остались, записи повторения — из файла; файл версии 2 с `games`, где у строки нет `id`, → «Файл повреждён», база не изменилась; версия 3 → «Файл от другой версии приложения»; прежние тесты копии проходят (с поправкой на номер версии).
- [ ] **Step 2:** FAIL → реализация → PASS.
- [ ] **Step 3:** commit `feat: резервная копия с партиями; старые копии читаются`.

---

### Task 15: Подгонка на настоящих партиях и проход по экранам (выполняет ведущий, не исполнитель)

**Files:**
- Create: `src/screens/games/DevStatsScreen.tsx` (маршрут `/dev/analysis`, подключается только при `import.meta.env.DEV`)
- Modify: `src/analysis/config.ts` (по итогам), `docs/superpowers/specs/2026-11-15-chess-com-stage2-design.md` (если числа описания изменились)

- [ ] **Step 1:** `DevStatsScreen`: по всем разобранным партиям — число партий, среднее и наибольшее `tookMs`, доли оценок ходов владельца, число видов ошибок и доля `other`, среднее число задач на партию, число «!» и «!!»; кнопка «Разобрать всё» (ставит все партии через `gamesQueue.setRange`).
- [ ] **Step 2:** на компьютере в dev-сервере ввести ник владельца, загрузить партии, разобрать все. Данные остаются в браузере; в репозиторий ничего из них не копируется.
- [ ] **Step 3:** просмотреть глазами не меньше 15 ошибок владельца из разных партий и не меньше 15 задач: верен ли «правильный ход», подходит ли фраза. Записать находки в рабочую папку `.superpowers/sdd/2026-11-15-chess-com-stage2/calibration.md`.
- [ ] **Step 4:** поправить числа в `CONFIG` и, если нужно, правила видов (с тестом на каждый исправленный случай — позиция с заменённым контекстом, без имён). Цели: доля `other` среди ошибок владельца не выше трети; ни одной задачи с неверным ответом среди просмотренных; «!!» реже одного на три партии.
- [ ] **Step 5:** проход по экранам в браузере (поручается помощнику с малым контекстом): ник → список → сводка → разбор (все кнопки, график, вариант) → проба ходов → «Исправить ошибки» → «Частые ошибки» со сменой промежутка → повторение на вкладке «Задачи» → копия и восстановление. Ширина 390 px: кнопки видны без прокрутки.
- [ ] **Step 6:** `npm test`, `npx tsc -b`, `npm run build` чистые. Commit `chore: подгонка разбора на настоящих партиях`.
- [ ] **Step 7:** сообщить владельцу итоги и замер времени на компьютере; публикация и проверка на iPhone — только после его согласия. На iPhone время разбора видно в сводке партии («Разбор занял N с»); по нему при необходимости меняются `FAST_NODES` и `DEEP_NODES`.
