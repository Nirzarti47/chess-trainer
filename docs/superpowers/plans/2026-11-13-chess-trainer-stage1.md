# Шахматный тренажёр, этап 1: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Личное PWA-приложение для iPhone: путь обучения змейкой, уроки из задач, свободные задачи, повторение ошибок, подстройка под слабые темы, серия и прогресс, всё без интернета.

**Architecture:** Одностраничное приложение без сервера. Вся логика (рейтинг, серия, повторение, сборка урока, путь) лежит в чистых функциях `src/domain`, которые не знают про React и базу. Данные хранятся в IndexedDB на устройстве. Задачи заранее отобраны скриптом из базы Lichess и лежат в приложении как статические файлы.

**Tech Stack:** Vite, React, TypeScript, react-router (HashRouter), chessground, chess.js, Dexie, vite-plugin-pwa, Stockfish (однопоточная lite-сборка WASM), Vitest, fake-indexeddb, Python 3.13 (только для скрипта отбора задач).

**Spec:** `docs/superpowers/specs/2026-11-13-chess-trainer-design.md`

## Global Constraints

- Интерфейс и все тексты на русском. Обращение к пользователю на «ты», без глаголов прошедшего времени с родом («ошибся», «решил»).
- После первой загрузки приложение работает без сети. Ничего не подгружается с чужих серверов: шрифт, фигуры, движок, задачи лежат внутри.
- Никаких платных сервисов, аккаунтов, своего сервера.
- Никаких жизней, лимитов, штрафов за ошибки.
- Целевое устройство: iPhone, Safari, iOS 16.4+, приложение на домашнем экране. Проверка вёрстки в размере 375×812.
- Движок только однопоточный (GitHub Pages не даёт заголовки COOP/COEP).
- Сборка с относительными путями (`base: './'`), маршруты через `HashRouter`.
- Код открытый (chessground под GPL-3). Авторы фигур, доски и базы задач перечислены на экране «О приложении».
- Звуков в этапе 1 нет (описание оставляет их на усмотрение строителя).
- Цвета темы: фон `#16222C`, поверхность `#1F303D`, текст `#E4ECEF`, второстепенный текст `#8FA5B2`, акцент `#F0B243`, успех `#63C29A`, «Слабые места» `#5AA9D6`. Шрифт Golos Text. Образцы: `mockups/boards.html`, `mockups/variants.html` (вариант B).
- Коммиты только локальные. `git push` и публикация только после явного согласия владельца на каждую.

## Review Focus

1. **В теме кончились новые задачи.** Нужных задач в коридоре меньше, чем требует урок. Ожидание: урок всё равно собирается полным, недостающее берётся из давно решённых. Тест в задаче 7.
2. **Движок не загрузился или отвечает медленно.** Ожидание: через 2 секунды урок продолжается без показа ответа соперника, с текстом «Не тот ход». Тест в задаче 10.
3. **Файл резервной копии чужой, битый или от другой версии.** Ожидание: понятное сообщение, текущий прогресс не тронут. Тест в задаче 6.
4. **Другой верный ход.** В задаче на мат есть второй мат. Ожидание: любой ход, ставящий мат, засчитывается. Тест в задаче 4.
5. **Урок пересёк полночь или телефон сменил часовой пояс.** Ожидание: урок засчитывается дню, в который он закончен, серия не ломается от смены пояса. Тесты в задачах 3 и 6.

---

## Структура файлов

```
index.html, package.json, vite.config.ts, tsconfig.json, .gitignore
.github/workflows/deploy.yml          сборка и выкладка на GitHub Pages
scripts/build_puzzles.py              отбор задач из базы Lichess
scripts/verify_content.mjs            проверка авторских заданий движком
public/pieces/<set>/<wK…bP>.svg       8 наборов фигур
public/puzzles/c1.json c2.json c3.json  задачи по кругам (результат скрипта)
public/engine/                        файлы Stockfish
src/main.tsx, src/App.tsx             вход, маршруты, вкладки
src/domain/                           чистая логика
  types.ts  dates.ts  rating.ts  xp.ts  srs.ts  streak.ts
  puzzle.ts  themeStats.ts  lessonBuilder.ts  picker.ts  path.ts
src/content/                          учебное содержание как данные
  themes.ts  curriculum.ts  boards.ts  pieceSets.ts
  basics.ts  openings.ts  explanations.ts
src/data/
  db.ts  repo.ts  backup.ts  puzzleStore.ts
src/engine/engine.ts                  обёртка над Stockfish
src/ui/                               общие элементы
  theme.css  Board.tsx  BigButton.tsx  TabBar.tsx  Sheet.tsx  ProgressBar.tsx
src/screens/
  LearnScreen.tsx  LessonScreen.tsx  TaskRunner.tsx  LessonSummary.tsx
  PuzzlesScreen.tsx  ProfileScreen.tsx  AppearanceScreen.tsx
  BackupScreen.tsx  AboutScreen.tsx  FirstLoadScreen.tsx  UpdateBanner.tsx
```

Тесты лежат рядом с кодом: `src/domain/streak.test.ts` и так далее.

## Общие типы (`src/domain/types.ts`)

Создаются в задаче 2, используются всеми.

```ts
export type ThemeId = string;
export type TaskResult = 'clean' | 'mistake' | 'hint';
export type Source = 'lesson' | 'free' | 'review' | 'weak' | 'exam';
export type Circle = 0 | 1 | 2 | 3;

/** Формат Lichess: fen — позиция ДО хода соперника; moves[0] — ход соперника,
 *  moves[1] — первый ход решающего, дальше по очереди. Ходы в UCI. */
export interface Puzzle { id: string; fen: string; moves: string[]; rating: number; themes: ThemeId[] }

export interface ThemeStat { theme: ThemeId; rating: number; solved: number; clean: number }
export interface ReviewItem { puzzleId: string; stage: 0 | 1 | 2 | 3; dueDay: string }   // день: 'YYYY-MM-DD'
export interface DayLog { day: string; lessons: number; freePuzzles: number }
export interface LessonProgress { nodeId: string; lessonIndex: number; clean: number; total: number }
export interface Profile { rating: number; ratedCount: number; xp: number; firstDay: string;
  lastBackupAt: number | null; backupSnoozedAt: number | null; fastTrackDeclined: string[] }
export interface Settings { board: string; pieceSet: string }

export interface ExplainStep { fen: string; text: string; move?: string; arrows?: [string, string][] }
export interface AuthoredTask { fen: string; prompt: string; accept: string[]; explain: string }
export interface ChoiceQuestion { fen?: string; prompt: string; options: string[]; correct: number;
  explain: string; fact?: 'checkmate' | 'stalemate' | 'check' | 'none' }
export type LessonTask =
  | { kind: 'explain'; step: ExplainStep }
  | { kind: 'puzzle'; puzzle: Puzzle }
  | { kind: 'authored'; task: AuthoredTask }
  | { kind: 'choice'; q: ChoiceQuestion };
```

---

### Task 1: Каркас проекта

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `src/main.tsx`, `src/App.tsx`, `src/ui/theme.css`, `src/ui/TabBar.tsx`, `src/ui/BigButton.tsx`, `src/App.test.tsx`

**Interfaces:**
- Produces: маршруты `#/learn`, `#/puzzles`, `#/profile`, `#/lesson/:nodeId/:lessonIndex`, `#/run/:mode` (mode: `free` | `theme-<id>` | `review` | `weak`), `#/profile/appearance`, `#/profile/backup`, `#/profile/about`. CSS-переменные `--bg --surface --text --muted --accent --success --weak` со значениями из Global Constraints. `<BigButton variant="accent|surface|success|weak">`: объёмная кнопка с нижней тенью, как на макете.

- [ ] **Step 1: Владелец ставит Node.js LTS.** Проверка: `node --version` печатает версию 20 или новее. Без этого дальше идти нельзя.
- [ ] **Step 2:** `git init`; `.gitignore` с `node_modules`, `dist`, `data/` (сырая база Lichess), `.superpowers/`.
- [ ] **Step 3:** Создать проект Vite (шаблон react-ts). Поставить зависимости: `react-router-dom chessground chess.js dexie @fontsource/golos-text`; для разработки: `vitest @testing-library/react @testing-library/user-event jsdom fake-indexeddb vite-plugin-pwa`. В `vite.config.ts`: `base: './'`, окружение тестов `jsdom`.
- [ ] **Step 4: Тест `src/App.test.tsx`:** приложение рендерит три вкладки с подписями «Учёба», «Задачи», «Профиль»; нажатие на «Задачи» показывает заголовок экрана задач.
- [ ] **Step 5:** `npx vitest run` — тест падает.
- [ ] **Step 6:** Реализовать `App.tsx` (HashRouter, три экрана-заглушки, `TabBar` внизу; на экранах урока вкладки скрыты), `theme.css`, `BigButton`.
- [ ] **Step 7:** `npx vitest run` — проходит. `npm run build` — без ошибок.
- [ ] **Step 8:** Открыть в браузере в размере 375×812, сверить фон, шрифт и вкладки с макетом.
- [ ] **Step 9: Commit** `chore: каркас приложения`.

### Task 2: Рейтинг, опыт, даты, повторение

**Files:**
- Create: `src/domain/types.ts`, `dates.ts`, `rating.ts`, `xp.ts`, `srs.ts` и тесты к ним

**Interfaces:**
- Produces:
  - `localDay(d: Date): string` — день по местному времени, `'YYYY-MM-DD'`; `addDays(day: string, n: number): string`; `mondayOf(day: string): string`.
  - `START_RATING = 600`; `expectedScore(player: number, puzzle: number): number`; `updateRating(player: number, puzzle: number, solved: boolean, ratedCount: number): number`; `targetPuzzleRating(player: number): number`.
  - `XP = { clean: 10, other: 5, lesson: 20 }`.
  - `INTERVALS = [1, 3, 7, 21]`; `schedule(item: ReviewItem | undefined, puzzleId: string, result: TaskResult, today: string): ReviewItem | null`; `dueItems(items: ReviewItem[], today: string): ReviewItem[]`.

- [ ] **Step 1: Тесты `rating.test.ts`:**

```ts
expect(expectedScore(600, 600)).toBeCloseTo(0.5);
expect(updateRating(600, 600, true, 0)).toBe(620);    // первые 20 задач: K = 40
expect(updateRating(600, 600, false, 0)).toBe(580);
expect(updateRating(600, 600, true, 20)).toBe(608);   // дальше K = 16
expect(updateRating(600, 1000, false, 30)).toBe(599);
expect(updateRating(105, 100, false, 30)).toBeGreaterThanOrEqual(100); // пол 100
expect(targetPuzzleRating(1000)).toBe(880);           // ожидаемый успех 2 из 3
```

- [ ] **Step 2: Тесты `srs.test.ts`:**

```ts
expect(schedule(undefined, 'p1', 'clean', '2026-11-13')).toBeNull();
expect(schedule(undefined, 'p1', 'mistake', '2026-11-13')).toEqual({ puzzleId: 'p1', stage: 0, dueDay: '2026-11-14' });
expect(schedule(undefined, 'p1', 'hint', '2026-11-13')).toEqual({ puzzleId: 'p1', stage: 0, dueDay: '2026-11-14' });
const s0 = { puzzleId: 'p1', stage: 0 as const, dueDay: '2026-11-14' };
expect(schedule(s0, 'p1', 'clean', '2026-11-14')).toEqual({ puzzleId: 'p1', stage: 1, dueDay: '2026-11-17' });
expect(schedule({ ...s0, stage: 1 }, 'p1', 'clean', '2026-11-17')).toEqual({ puzzleId: 'p1', stage: 2, dueDay: '2026-11-24' });
expect(schedule({ ...s0, stage: 2 }, 'p1', 'clean', '2026-11-24')).toEqual({ puzzleId: 'p1', stage: 3, dueDay: '2026-12-15' });
expect(schedule({ ...s0, stage: 3 }, 'p1', 'clean', '2026-12-15')).toBeNull();
expect(schedule({ ...s0, stage: 2 }, 'p1', 'hint', '2026-11-24')).toEqual({ puzzleId: 'p1', stage: 0, dueDay: '2026-11-25' });
```

- [ ] **Step 3: Тесты `dates.test.ts`:** `mondayOf('2026-11-13') === '2026-11-09'`; `mondayOf('2026-11-15') === '2026-11-09'`; `addDays('2026-11-30', 1) === '2026-12-01'`; `localDay(new Date(2026, 10, 13, 23, 59)) === '2026-11-13'`.
- [ ] **Step 4:** Запустить тесты — падают.
- [ ] **Step 5:** Реализовать. `updateRating`: `K = ratedCount < 20 ? 40 : 16`, результат округляется, не ниже 100. `targetPuzzleRating`: `player - 120`.
- [ ] **Step 6:** Тесты проходят.
- [ ] **Step 7: Commit** `feat: рейтинг, опыт и интервалы повторения`.

### Task 3: Серия

**Files:**
- Create: `src/domain/streak.ts`, `src/domain/streak.test.ts`

**Interfaces:**
- Consumes: `addDays`, `mondayOf` из задачи 2.
- Produces:

```ts
export type DayState = 'done' | 'forgiven' | 'missed' | 'today' | 'future' | 'before';
export interface StreakInfo { count: number; skipUsedThisWeek: boolean; week: { day: string; state: DayState }[] }
export function dayCounts(log: DayLog): boolean;   // lessons >= 1 || freePuzzles >= 10
export function computeStreak(activeDays: ReadonlySet<string>, firstDay: string, today: string): StreakInfo;
```

Правило: идём по дням от `firstDay` до `today`. Засчитанный день прибавляет 1. Первый пропуск в неделе (пн–вс) прощается: серия не растёт и не обнуляется. Второй и следующие пропуски в той же неделе обнуляют серию. Сегодняшний день пропуском не считается, пока не закончился. Дни до `firstDay` имеют состояние `before`. `week` — семь дней текущей недели.

- [ ] **Step 1: Тесты.** 9 ноября 2026 — понедельник.

```ts
const days = (...d: number[]) => new Set(d.map(n => `2026-11-${String(n).padStart(2, '0')}`));
// будни подряд, суббота ещё идёт
expect(computeStreak(days(9,10,11,12,13), '2026-11-09', '2026-11-14')).toMatchObject({ count: 5, skipUsedThisWeek: false });
expect(computeStreak(days(9,10,11,12,13), '2026-11-09', '2026-11-14').week[5]).toEqual({ day: '2026-11-14', state: 'today' });
// суббота пропущена и прощена, воскресенье засчитано
expect(computeStreak(days(9,10,11,12,13,15), '2026-11-09', '2026-11-16').count).toBe(6);
// оба выходных пропущены: серия сгорела
expect(computeStreak(days(9,10,11,12,13), '2026-11-09', '2026-11-16').count).toBe(0);
expect(computeStreak(days(9,10,11,12,13,16), '2026-11-09', '2026-11-16').count).toBe(1);
// дни до первого запуска не пропуски
const mid = computeStreak(days(11,12,13), '2026-11-11', '2026-11-13');
expect(mid.count).toBe(3);
expect(mid.week[0].state).toBe('before');
// по одному прощённому пропуску в двух неделях подряд
const two = computeStreak(days(9,11,12,13,14,15,17), '2026-11-09', '2026-11-17');
expect(two.count).toBe(7);
expect(two.skipUsedThisWeek).toBe(true);
expect(two.week[0].state).toBe('forgiven');
// Review Focus 5: дни сравниваются как строки, часовой пояс функции не важен
expect(computeStreak(days(13), '2026-11-13', '2026-11-13').count).toBe(1);
```

- [ ] **Step 2:** Тесты падают.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Тесты проходят.
- [ ] **Step 5: Commit** `feat: серия с одним прощённым пропуском в неделю`.

### Task 4: Решение задачи

**Files:**
- Create: `src/domain/puzzle.ts`, `src/domain/puzzle.test.ts`

**Interfaces:**
- Consumes: `Puzzle`, `TaskResult`; библиотека chess.js.
- Produces:

```ts
export interface PuzzleState { puzzle: Puzzle; fen: string; step: number; mistakes: number;
  hintLevel: 0 | 1 | 2; status: 'playing' | 'solved' | 'revealed'; lastMove: [string, string] | null }
export function startPuzzle(p: Puzzle): PuzzleState;          // делает ход соперника moves[0]; step = 1
export function tryMove(s: PuzzleState, uci: string): { state: PuzzleState; outcome: 'correct' | 'solved' | 'wrong' | 'illegal' };
export function takeHint(s: PuzzleState): { state: PuzzleState; square?: string; move?: string }; // 1-й вызов: поле фигуры, 2-й: ход
export function resultOf(s: PuzzleState): TaskResult;          // hint > mistake > clean
export function sideToMove(s: PuzzleState): 'white' | 'black';
export function legalDests(fen: string): Map<string, string[]>; // для доски
```

Верный ход: совпал с ожидаемым, либо ставит мат. После верного хода сразу делается ответ соперника `moves[step+1]`. Неверный допустимый ход: `mistakes += 1`, позиция не меняется; при `mistakes >= 2` статус `revealed`. Недопустимый ход ошибкой не считается.

- [ ] **Step 1: Тесты.**

```ts
const fork: Puzzle = { id: 'f1', rating: 700, themes: ['fork'],
  fen: '5rk1/p4ppp/1q6/3N4/8/8/5PPP/3R2K1 b - - 0 1', moves: ['b6c6', 'd5e7', 'g8h8', 'e7c6'] };
const mate: Puzzle = { id: 'm1', rating: 500, themes: ['mateIn1'],
  fen: '6k1/p4ppp/8/8/8/8/5PPP/3RQ1K1 b - - 0 1', moves: ['a7a6', 'd1d8'] };

let s = startPuzzle(fork);
expect(sideToMove(s)).toBe('white');
expect(s.lastMove).toEqual(['b6', 'c6']);
let r = tryMove(s, 'd5e7');
expect(r.outcome).toBe('correct');
expect(r.state.lastMove).toEqual(['g8', 'h8']);          // ответ соперника сделан сам
r = tryMove(r.state, 'e7c6');
expect(r.outcome).toBe('solved');
expect(resultOf(r.state)).toBe('clean');

s = startPuzzle(fork);
r = tryMove(s, 'd5f6');                                    // допустимый, но неверный
expect(r.outcome).toBe('wrong');
expect(r.state.fen).toBe(s.fen);
expect(resultOf(r.state)).toBe('mistake');
expect(tryMove(r.state, 'd5b4').state.status).toBe('revealed');
expect(tryMove(s, 'd5d7').outcome).toBe('illegal');
expect(tryMove(s, 'd5d7').state.mistakes).toBe(0);

// Review Focus 4: другой мат тоже засчитывается
expect(tryMove(startPuzzle(mate), 'e1e8').outcome).toBe('solved');
expect(tryMove(startPuzzle(mate), 'd1d8').outcome).toBe('solved');

const h1 = takeHint(startPuzzle(fork));
expect(h1.square).toBe('d5');
const h2 = takeHint(h1.state);
expect(h2.move).toBe('d5e7');
expect(resultOf(h2.state)).toBe('hint');
```

- [ ] **Step 2:** Тесты падают.
- [ ] **Step 3:** Реализовать на chess.js.
- [ ] **Step 4:** Тесты проходят.
- [ ] **Step 5: Commit** `feat: проверка решения задачи`.

### Task 5: База задач

Можно делать параллельно с задачами 2–4, модель Sonnet.

**Files:**
- Create: `scripts/build_puzzles.py`, `src/content/themes.ts`, `src/data/puzzleStore.ts`, `src/data/puzzleStore.test.ts`
- Output: `public/puzzles/c1.json`, `c2.json`, `c3.json`

**Interfaces:**
- Produces:
  - `THEMES: { id: ThemeId; title: string; firstCircle: 1 | 2 | 3 }[]`. Идентификаторы совпадают с метками Lichess:
    - круг 1: `mateIn1` «Мат в один ход», `hangingPiece` «Незащищённая фигура», `fork` «Вилка», `pin` «Связка», `skewer` «Сквозной удар», `discoveredAttack` «Открытое нападение», `mateIn2` «Мат в два хода», `backRankMate` «Мат по последней горизонтали»;
    - круг 2: `attraction` «Завлечение», `deflection` «Отвлечение», `capturingDefender` «Уничтожение защитника», `trappedPiece` «Ловля фигуры», `doubleCheck` «Двойной шах», `smotheredMate` «Спёртый мат», `promotion` «Превращение пешки»;
    - круг 3: `intermezzo` «Промежуточный ход», `sacrifice` «Жертва», `pawnEndgame` «Пешечные окончания», `rookEndgame` «Ладейные окончания».
  - `BANDS: Record<1 | 2 | 3, [number, number]>` = `{1: [400, 900], 2: [900, 1300], 3: [1300, 1700]}`.
  - Формат файла: `[[id, fen, "ход ход …", rating, "тема тема"], …]`.
  - `loadCircle(c: 1 | 2 | 3): Promise<PuzzlePool>`; `interface PuzzlePool { query(q: { theme: ThemeId; min: number; max: number; exclude: ReadonlySet<string>; limit: number; near?: number }): Puzzle[]; byId(id: string): Puzzle | undefined; count(theme: ThemeId): number }`. `query` возвращает ближайшие по рейтингу к `near`, без повторов. Загруженный круг кэшируется в памяти. `findPuzzle(id: string): Promise<Puzzle | undefined>` ищет по всем кругам.

- [ ] **Step 1: Спросить у владельца разрешение на скачивание** `lichess_db_puzzle.csv.zst` с `database.lichess.org` (несколько сотен мегабайт) в папку `data/`. Поставить `pip install zstandard`.
- [ ] **Step 2:** Написать `build_puzzles.py`. Столбцы CSV: `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`. Фильтр: `Popularity >= 85`, `NbPlays >= 500`, `RatingDeviation <= 90`. Для каждого круга и каждой его темы (в круг входят все темы с `firstCircle <= круг`) взять задачи в коридоре круга, равномерно по рейтингу: круг 1 до 4000 на тему, круг 2 до 2300, круг 3 до 1800. Задача пишется в файл один раз, даже если подходит под несколько тем. В поле тем остаются только метки из `THEMES`. В конце скрипт печатает таблицу «круг, тема, сколько задач» и размер файлов.
- [ ] **Step 3:** Запустить. Ожидание: три файла, всего 80–110 тысяч задач, суммарно до 15 МБ. Если по какой-то теме меньше 300 задач, сказать об этом в отчёте.
- [ ] **Step 4: Тест `puzzleStore.test.ts`** на маленьком поддельном файле: `query` уважает `min/max`, `exclude`, `limit`, сортирует по близости к `near`; у задачи `moves` — массив, `themes` — массив.
- [ ] **Step 5:** Реализовать `puzzleStore.ts` (загрузка через `fetch('./puzzles/cN.json')`), тест проходит.
- [ ] **Step 6: Commit** `feat: база задач и доступ к ней` (вместе с тремя файлами задач).

### Task 6: Хранилище и резервная копия

**Files:**
- Create: `src/data/db.ts`, `src/data/repo.ts`, `src/data/backup.ts`, тесты `repo.test.ts`, `backup.test.ts`

**Interfaces:**
- Consumes: задачи 2 и 3; `themeStats.applyAttempt` определяется здесь же в `src/domain/themeStats.ts` (см. ниже).
- Produces (`repo.ts`):

```ts
recordTaskResult(r: { puzzleId?: string; themes: ThemeId[]; puzzleRating?: number;
  result: TaskResult; source: Source; rated: boolean; now: Date }): Promise<void>;
completeLesson(r: { nodeId: string; lessonIndex: number; clean: number; total: number; now: Date }): Promise<void>;
getProfile(): Promise<Profile>;            getSettings(): Promise<Settings>;      saveSettings(s: Settings): Promise<void>;
getThemeStats(): Promise<ThemeStat[]>;     getLessonProgress(): Promise<LessonProgress[]>;
getActiveDays(): Promise<Set<string>>;     getDueReviews(today: string): Promise<ReviewItem[]>;
getSeenPuzzleIds(): Promise<Set<string>>;  getRatingHistory(): Promise<{ at: number; rating: number }[]>;
saveActiveLesson(a: ActiveLesson): Promise<void>; loadActiveLesson(): Promise<ActiveLesson | null>; clearActiveLesson(): Promise<void>;
declineFastTrack(nodeId: string): Promise<void>; markBackupDone(now: Date): Promise<void>; snoozeBackup(now: Date): Promise<void>;
```

  `ActiveLesson = { nodeId: string; lessonIndex: number; tasks: LessonTask[]; cursor: number; results: (TaskResult | null)[]; retry: number[] }`.
- Produces (`themeStats.ts`): `applyAttempt(stat: ThemeStat | undefined, theme: ThemeId, puzzleRating: number, result: TaskResult): ThemeStat` (подсказка считается как нерешённая); `weakestThemes(stats: ThemeStat[], among: ThemeId[], n: number): ThemeId[]` (по возрастанию рейтинга, только темы с `solved >= 5`).
- Produces (`backup.ts`): `exportBackup(): Promise<Blob>` (JSON `{ app: 'chess-trainer', version: 1, exportedAt, tables }`); `importBackup(text: string): Promise<void>`, при ошибке бросает `BackupError` с русским сообщением.

Правила `recordTaskResult`, всё в одной транзакции:
- запись попытки;
- если `rated`: обновить общий рейтинг и рейтинг каждой темы из `themes` (решённой считается только задача с результатом `clean`), `ratedCount += 1`, добавить точку в историю рейтинга. `rated` выставляет вызывающий: первая встреча с задачей и источник не `review`;
- повторение: `schedule(...)`, результат `null` удаляет запись из очереди;
- опыт: `XP.clean` или `XP.other`;
- если источник `free` или `review`: `freePuzzles += 1` в журнале дня `localDay(now)`.

`completeLesson`: записать прогресс урока, `xp += XP.lesson`, `lessons += 1` в журнале дня `localDay(now)`. Начальный профиль: рейтинг 600, `firstDay` — день первого запуска. Настройки по умолчанию: `board: 'night'`, `pieceSet: 'maestro'`.

Идентификаторы для `completeLesson` вне обычных уроков: закрепление — `<id узла>:reinforce`, урок 0; контрольная — `<раздел>:exam`, урок 0; «Слабые места» — `weak`, номер урока равен числу уже пройденных уроков `weak`. Все три засчитывают день для серии, как обычный урок.

- [ ] **Step 1: Тесты `repo.test.ts`** (fake-indexeddb):
  - новый профиль: рейтинг 600, `firstDay` сегодня;
  - `recordTaskResult` clean, rated, задача 600: рейтинг 620, тема `fork` 620, опыт 10, в очереди повторения пусто;
  - то же с `mistake`: рейтинг 580, в очереди задача со сроком «завтра», опыт 5;
  - `rated: false` рейтинг не меняет;
  - десять вызовов с источником `free` делают день засчитанным (`dayCounts`), девять не делают; источник `lesson` счётчик `freePuzzles` не трогает;
  - Review Focus 5: `completeLesson` с `now = new Date(2026, 10, 14, 0, 5)` пишет урок в день `2026-11-14`, даже если урок начат накануне;
  - `saveActiveLesson` → `loadActiveLesson` возвращает то же; после `clearActiveLesson` — `null`.
- [ ] **Step 2: Тесты `backup.test.ts`:**
  - экспорт → очистка базы → импорт возвращает профиль, статистику, очередь, прогресс, журнал дней, настройки;
  - Review Focus 3: `importBackup('не json')`, `importBackup('{"app":"other"}')`, `importBackup('{"app":"chess-trainer","version":99,"tables":{}}')` бросают `BackupError`, а профиль в базе остаётся прежним.
- [ ] **Step 3:** Тесты падают.
- [ ] **Step 4:** Реализовать `db.ts` (Dexie: таблицы `kv`, `attempts`, `themeStats`, `reviews`, `lessons`, `days`, `ratingHistory`), `themeStats.ts`, `repo.ts`, `backup.ts`.
- [ ] **Step 5:** Тесты проходят.
- [ ] **Step 6: Commit** `feat: хранение прогресса и резервная копия`.

### Task 7: Учебный план, сборка урока, подбор задач

**Files:**
- Create: `src/content/curriculum.ts`, `src/domain/lessonBuilder.ts`, `src/domain/picker.ts`, тесты к `lessonBuilder` и `picker`

**Interfaces:**
- Consumes: `PuzzlePool`, `THEMES`, `BANDS`, `targetPuzzleRating`, `weakestThemes`.
- Produces (`curriculum.ts`):

```ts
export interface PathNode { id: string; kind: 'theme' | 'authored' | 'exam'; title: string;
  themeId?: ThemeId; circle: Circle; lessons: number }
export interface Section { id: string; title: string; circle: Circle; nodes: PathNode[] }
export const CURRICULUM: Section[];
```

  Разделы: `basics` «Проверка основ» (круг 0, один узел `authored`, 1 урок); `c1` «Круг 1. Первые удары»: восемь тем круга 1 по 5 уроков, после `fork` узел `authored` «Дебютные принципы» (3 урока), в конце `exam`; `c2` «Круг 2. Тактика глубже»: 15 тем по 5 уроков и `exam`; `c3` «Круг 3. Сложные удары»: 19 тем по 5 уроков и `exam`. В кругах 2 и 3 сначала идут новые темы, потом возвращаются старые. Идентификатор узла: `<раздел>:<тема>`, например `c1:fork`. Авторские узлы: `basics:basics` и `c1:openings`; контрольные: `c1:exam`, `c2:exam`, `c3:exam`.
- Produces (`lessonBuilder.ts`), константы `LESSON_SIZE = 12`, `TAIL = 3`, `EXAM_SIZE = 15`, `WEAK_SIZE = 12`:

```ts
buildThemeLesson(a: { node: PathNode; pool: PuzzlePool; themeRating: number; weakThemes: ThemeId[];
  weakRatings: Record<ThemeId, number>; seen: ReadonlySet<string>; rng: () => number }): Puzzle[];
buildExam(a: { section: Section; pool: PuzzlePool; ratings: Record<ThemeId, number>; seen: ReadonlySet<string>; rng: () => number }): Puzzle[];
buildWeakSpots(a: { due: Puzzle[]; weakThemes: ThemeId[]; ratings: Record<ThemeId, number>;
  pool: PuzzlePool; band: [number, number]; seen: ReadonlySet<string>; rng: () => number }): Puzzle[];
```

  `buildThemeLesson`: 12 задач. Последние 3 из `weakThemes` (тем, пройденных раньше); если слабых тем нет, все 12 из темы узла. Целевой рейтинг задачи: `targetPuzzleRating(themeRating)`, зажатый в коридор круга. Задачи темы идут по возрастанию рейтинга. `buildWeakSpots`: сначала до 6 задач с подошедшим сроком, остальное из двух-трёх слабых тем.
- Produces (`picker.ts`): `nextFreePuzzle(a: { pool: PuzzlePool; band: [number, number]; openThemes: ThemeId[]; stats: ThemeStat[]; overall: number; seen: ReadonlySet<string>; rng: () => number; theme?: ThemeId }): Puzzle`. Если тема не задана: с вероятностью 0,6 одна из трёх слабейших открытых тем, иначе любая открытая. Рейтинг: `targetPuzzleRating(рейтинг темы)` ± 75, в пределах коридора.

- [ ] **Step 1: Тесты `lessonBuilder.test.ts`** на поддельном пуле (по 200 задач на тему с рейтингами 400–900):
  - 12 задач, без повторов, ни одной из `seen`;
  - без слабых тем все 12 имеют тему узла; со слабыми темами последние 3 из них, первые 9 из темы узла;
  - первые 9 идут по неубыванию рейтинга и лежат в коридоре `[400, 900]`;
  - при `themeRating = 600` средний рейтинг первых 9 в пределах 480 ± 100; при `themeRating = 300` задачи не ниже 400;
  - Review Focus 1: в пуле по теме всего 5 новых задач и 20 уже решённых — урок всё равно из 12, без повторов внутри урока;
  - `buildExam`: 15 задач, каждая тема раздела встречается хотя бы раз;
  - `buildWeakSpots`: при 8 задачах со сроком берёт 6 из них и 6 из слабых тем; при 0 — все 12 из слабых тем.
- [ ] **Step 2: Тесты `picker.test.ts`:** заданная тема всегда соблюдается; на 1000 вызовов с фиксированным генератором доля слабых тем между 0,5 и 0,7; задача никогда не из `seen`, пока есть новые.
- [ ] **Step 3:** Тесты падают.
- [ ] **Step 4:** Реализовать.
- [ ] **Step 5:** Тесты проходят.
- [ ] **Step 6: Commit** `feat: учебный план и сборка уроков`.

### Task 8: Путь и подстройка

**Files:**
- Create: `src/domain/path.ts`, `src/domain/path.test.ts`

**Interfaces:**
- Consumes: `CURRICULUM`, `LessonProgress`, `ThemeStat`, `Profile.fastTrackDeclined`.
- Produces:

```ts
export type NodeStatus = 'done' | 'current' | 'locked';
export interface PathItem { node: PathNode; status: NodeStatus; lessonsDone: number; nextLesson: number | null;
  reinforcement: boolean; fastTrackOffer: boolean }
export interface PathView { sections: { section: Section; items: PathItem[] }[];
  weakSpots: { visible: boolean; dueCount: number } }
export function buildPath(progress: LessonProgress[], stats: ThemeStat[], declined: string[], dueCount: number): PathView;
export function cleanShare(nodeId: string, progress: LessonProgress[]): number;
export const REINFORCE_BELOW = 0.70, FAST_TRACK_FROM = 0.90, EXAM_ADVICE_BELOW = 0.60, WEAK_MIN_SOLVED = 20;
```

Правила:
- узел открыт, когда пройден предыдущий; первый узел открыт сразу;
- узел-тема пройден, когда пройдены все его уроки, либо пройден последний урок после принятого ускорения;
- `fastTrackOffer`: пройдены уроки 0 и 1, их общая доля чистых решений не ниже 0,90, уроки дальше не начаты, узла нет в `declined`. При согласии следующий урок — последний (`nextLesson = lessons - 1`);
- закрепление: узел-тема пройден, `cleanShare < 0.70`. Тогда после него в списке идёт элемент с `reinforcement: true` и идентификатором узла `<id>:reinforce`, один урок. Он не блокирует следующий узел. После прохождения исчезает и больше не появляется;
- контрольная пройдена после одного прохождения, каким бы ни был результат;
- `weakSpots.visible`, когда хотя бы у одной темы `solved >= 20`.

- [ ] **Step 1: Тесты:**
  - пустой прогресс: первый узел `current`, остальные `locked`, `weakSpots.visible === false`;
  - пройдены 5 уроков `c1:mateIn1` с долей 0,8: узел `done`, следующий `current`, закрепления нет;
  - то же с долей 0,6: после узла есть элемент закрепления, а следующий узел всё равно `current`; после записи прогресса `c1:mateIn1:reinforce` закрепление пропадает;
  - уроки 0 и 1 с долей 0,92: `fastTrackOffer === true`; тот же случай с узлом в `declined`: `false`; с долей 0,85: `false`;
  - после уроков 0, 1 и 4 (ускорение принято) узел `done`;
  - контрольная с долей 0,3 открывает следующий раздел;
  - тема с `solved: 20` включает `weakSpots.visible`, `dueCount` пробрасывается.
- [ ] **Step 2:** Тесты падают.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Тесты проходят.
- [ ] **Step 5: Commit** `feat: путь обучения с подстройкой`.

### Task 9: Доска и оформление

**Files:**
- Create: `src/ui/Board.tsx`, `src/content/boards.ts`, `src/content/pieceSets.ts`, `public/pieces/**`, `src/screens/AppearanceScreen.tsx`, `src/ui/Board.test.tsx`

**Interfaces:**
- Produces:
  - `BOARDS: { id: string; name: string; light: string; dark: string; hiLight: string; hiDark: string }[]`: `night` «Ночная» `#AEBCCB/#4E657E`, `green` «Зелёная» `#EBECD0/#739552`, `wood` «Дерево» `#F0D9B5/#B58863`, `blue` «Серо-голубая» `#DEE3E6/#8CA2AD`, `lilac` «Сиреневая» `#E4DFF5/#8577C2`, `teal` «Бирюзовая» `#CBD8D1/#4C7C7E`, `graphite` «Графитовая» `#C9CDD2/#5E6670`, `sand` «Песочная» `#EFE6D2/#C2A878`. Цвета подсветки первых шести взять из `mockups/boards.html`, для двух новых подобрать в том же духе.
  - `PIECE_SETS: { id: string; name: string; author: string; license: string }[]`: `maestro` «Изящные», `cburnett` «Классические», `merida` «Турнирные», `cardinal` «Плотные», `staunty` «Мягкие», `california` «Плоские», `fresca` «Свежие», `gioco` «Строгие». Авторы и лицензии из файла `COPYING.md` репозитория lichess-org/lila.
  - `<Board fen orientation dests lastMove highlight? arrows? interactive onMove(uci) />`, где `dests: Map<string, string[]>`. Превращение пешки: всплывающий выбор из четырёх фигур, `onMove` получает UCI с буквой фигуры.

- [ ] **Step 1:** Скачать 8 наборов по 12 SVG из `https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/<set>/<код>.svg` в `public/pieces/`. Проверка: 96 файлов, каждый непустой и начинается с `<svg` или `<?xml`. Если какой-то файл не отдаётся (403), повторить через `raw.githubusercontent.com`.
- [ ] **Step 2: Тест `Board.test.tsx`:** при `interactive={false}` `onMove` не вызывается; смена настроек доски и фигур меняет CSS-переменные и адреса картинок фигур.
- [ ] **Step 3:** Реализовать `Board.tsx` на chessground. Цвет клеток и фигуры задаются стилями, которые пересобираются из настроек. Доска на всю ширину экрана, без координат по краям.
- [ ] **Step 4:** Реализовать `AppearanceScreen`: два списка-плитки, как на макете, и живая доска-предпросмотр. Выбор сохраняется через `saveSettings` сразу.
- [ ] **Step 5:** Проверить в браузере 375×812: перетаскивание и нажатие «фигура, потом клетка» работают, все 8 досок и 8 наборов переключаются, по умолчанию «Ночная» и «Изящные».
- [ ] **Step 6: Commit** `feat: доска и выбор оформления`.

### Task 10: Движок

**Files:**
- Create: `src/engine/engine.ts`, `src/engine/engine.test.ts`, `public/engine/*`

**Interfaces:**
- Produces: `bestReply(fen: string, opts?: { movetimeMs?: number; timeoutMs?: number }): Promise<string | null>` — лучший ход в UCI или `null`. По умолчанию `movetimeMs = 300`, `timeoutMs = 2000`. `warmUp(): Promise<boolean>`. Движок создаётся один раз в Web Worker и переиспользуется. `createEngine(workerFactory)` — для тестов.

- [ ] **Step 1:** Поставить пакет `stockfish`, найти в нём однопоточную lite-сборку (js и wasm), скопировать в `public/engine/` скриптом `npm run copy:engine`. Записать точные имена файлов в `engine.ts`.
- [ ] **Step 2: Тесты** с поддельным воркером:
  - воркер отвечает `bestmove e2e4 ponder e7e5` → `bestReply` возвращает `'e2e4'`;
  - Review Focus 2: воркер молчит → через `timeoutMs` возвращается `null`, следующий вызов работает;
  - воркер падает при создании → `warmUp()` возвращает `false`, `bestReply` возвращает `null` и не бросает;
  - `bestmove (none)` → `null`.
- [ ] **Step 3:** Тесты падают, реализовать, тесты проходят.
- [ ] **Step 4:** Проверить в браузере из консоли: `bestReply` на начальной позиции возвращает допустимый ход быстрее секунды.
- [ ] **Step 5: Commit** `feat: шахматный движок для показа ответа соперника`.

### Task 11: Экран урока

**Files:**
- Create: `src/screens/TaskRunner.tsx`, `LessonScreen.tsx`, `LessonSummary.tsx`, `src/ui/Sheet.tsx`, `ProgressBar.tsx`, `src/screens/LessonScreen.test.tsx`

**Interfaces:**
- Consumes: задачи 4, 6, 9, 10.
- Produces:
  - `<TaskRunner task: LessonTask onDone(result: TaskResult) />` — одно задание любого вида.
  - `<LessonRun tasks source title onFinish(summary: { clean: number; total: number; xp: number }) resumeKey? />` — очередь заданий с возвратом ошибок. Используется уроками, закреплением, контрольной и «Слабыми местами». Вкладка «Задачи» использует `TaskRunner` напрямую.

Поведение `TaskRunner`:
- `puzzle`: подпись «Ход белых» или «Ход чёрных», доска повёрнута стороной решающего. Верно: зелёная плашка «Верно» и кнопка «Дальше». Первая ошибка: текст «Не тот ход. Соперник ответит так», на доске на 1,2 секунды показывается неверный ход и ответ движка стрелкой, затем позиция возвращается. Если `bestReply` вернул `null` или неверный ход закончил партию — только «Не тот ход». Вторая ошибка: кнопка «Показать решение», решение проигрывается по ходам, затем «Дальше». Кнопка «Подсказка»: первое нажатие подсвечивает клетку фигуры, второе показывает ход стрелкой.
- `explain`: текст и доска; если задан `move`, ждёт именно его (другие ходы мягко возвращаются назад), иначе кнопка «Дальше». Результат всегда `clean`, в статистику не идёт.
- `authored`: как `puzzle` в один ход, верен любой ход из `accept`; после ответа показывается `explain`.
- `choice`: вопрос, варианты кнопками, после ответа `explain`.

Поведение `LessonRun`:
- задание с результатом не `clean` добавляется в конец очереди и показывается ещё раз; повторное решение в рейтинг не идёт (`rated: false`);
- `rated` для задачи из базы: её нет в `getSeenPuzzleIds()` и источник не `review`;
- после каждого задания состояние сохраняется (`saveActiveLesson`); при открытии того же урока он продолжается с того же места; после итога очищается;
- полоска прогресса сверху, крестик выхода с подтверждением «Выйти? Урок продолжится с этого места»;
- итог: «Решено с первого раза: N из M», полученный опыт, кнопка «Готово».

- [ ] **Step 1: Тесты** (поддельные задачи из задачи 4, поддельный движок):
  - три задачи решены верно: вызван `completeLesson` с `clean: 3, total: 3`, показан итог;
  - ошибка во второй задаче: она появляется снова после третьей; `recordTaskResult` для неё вызван с `result: 'mistake', rated: true` один раз, для повтора `rated: false`;
  - две ошибки подряд показывают «Показать решение»;
  - закрытие и повторное открытие урока продолжает с того же задания;
  - задание `choice`: верный ответ даёт `clean`, неверный `mistake`, в обоих случаях виден `explain`.
- [ ] **Step 2:** Тесты падают, реализовать, тесты проходят.
- [ ] **Step 3:** Пройти в браузере 375×812 урок из 12 задач с намеренными ошибками и подсказкой; сверить вид с макетом (вариант B, экран задачи).
- [ ] **Step 4: Commit** `feat: экран урока`.

### Task 12: Экран «Учёба»

**Files:**
- Create: `src/screens/LearnScreen.tsx`, `src/screens/LearnScreen.test.tsx`; Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `buildPath`, `buildThemeLesson`, `buildExam`, `buildWeakSpots`, `computeStreak`, `LessonRun`, содержание из задачи 15 (до её готовности — заглушка `getAuthoredLesson(nodeId, lessonIndex): LessonTask[]` и `getExplain(themeId, mode: 'full' | 'reminder'): ExplainStep[]`, обе в `src/content/explanations.ts`).

Поведение:
- сверху: серия (огонёк и число), опыт, рейтинг в задачах;
- путь змейкой, как в `mockups/boards.html`: заголовок раздела, кнопки со смещением, цвета по статусу. На кнопке темы — фигура из выбранного набора;
- нажатие на текущий узел открывает следующий его урок; на пройденный — список его уроков для повторного прохождения; на закрытый — подпись «Сначала пройди предыдущую тему»;
- урок темы: в уроке 0 сначала шаги `getExplain(themeId, 'full')` на первом круге темы или `'reminder'` на следующих; в уроках 1 и дальше — `'reminder'`; затем 12 задач из `buildThemeLesson`;
- при `fastTrackOffer` перед уроком окно: «Тема идёт легко. Пройти сразу последний урок?» с кнопками «Да, к последнему» и «Идти по порядку» (вторая вызывает `declineFastTrack`);
- элемент закрепления: кнопка «Закрепление: <тема>»;
- голубая кнопка «Слабые места» со счётчиком задач со сроком, видна по `weakSpots.visible`;
- после контрольной при доле ниже 0,60 на итоге добавляется строка «Стоит заглянуть в „Слабые места“»;
- экран при открытии прокручен к текущему узлу.

- [ ] **Step 1: Тесты:** новый пользователь видит раздел «Проверка основ» с текущим узлом и не видит «Слабые места»; при прогрессе с `fastTrackOffer` показывается окно, «Идти по порядку» вызывает `declineFastTrack`; закрытый узел не открывает урок.
- [ ] **Step 2:** Тесты падают, реализовать, тесты проходят.
- [ ] **Step 3:** Проверить в браузере 375×812: пройти два урока, увидеть смену статусов, серию 1, рост опыта.
- [ ] **Step 4: Commit** `feat: путь обучения на экране`.

### Task 13: Вкладка «Задачи»

**Files:**
- Create: `src/screens/PuzzlesScreen.tsx`, `src/screens/PuzzlesScreen.test.tsx`

**Interfaces:**
- Consumes: `nextFreePuzzle`, `getDueReviews`, `findPuzzle`, `TaskRunner`, `recordTaskResult`.

Поведение:
- три входа: «Подборка для тебя», «По теме» (список открытых на пути тем с рейтингом по каждой), «Повторение» со счётчиком; при нуле задач со сроком: «Повторять пока нечего. Задачи появятся здесь после ошибок»;
- «Подборка» и «По теме» — бесконечный поток: после каждой задачи сразу следующая, сверху рейтинг и его изменение (+8, −12), выход крестиком без подтверждения;
- открытые темы: темы узлов со статусом `done` или `current`; у нового пользователя — восемь тем круга 1. Коридор берётся по старшему открытому кругу;
- «Повторение»: задачи со сроком по очереди, источник `review`; когда кончились — «На сегодня всё повторено»;
- на экране видно «Сегодня решено: N из 10 для серии», пока день не засчитан.

- [ ] **Step 1: Тесты:** счётчик повторения берётся из `getDueReviews`; в потоке после решения появляется следующая задача и вызывается `recordTaskResult` с источником `free`; в режиме темы все задачи этой темы.
- [ ] **Step 2:** Тесты падают, реализовать, тесты проходят.
- [ ] **Step 3:** Проверить в браузере: решить 10 задач, убедиться, что серия на вкладке «Учёба» стала 1.
- [ ] **Step 4: Commit** `feat: свободные задачи и повторение`.

### Task 14: Профиль

**Files:**
- Create: `src/screens/ProfileScreen.tsx`, `BackupScreen.tsx`, `AboutScreen.tsx`, тест `ProfileScreen.test.tsx`

**Interfaces:**
- Consumes: `repo`, `computeStreak`, `exportBackup`, `importBackup`, `PIECE_SETS`.

Поведение:
- «Прогресс»: серия с полоской недели (семь дней, состояния из `StreakInfo.week`) и строкой «Пропуск на этой неделе: есть» или «использован»; опыт; рейтинг в задачах с графиком по `getRatingHistory` (простая линия SVG); пройдено тем и уроков; решено задач; три сильнейшие и три слабейшие темы с рейтингом;
- пункты «Оформление», «Резервная копия», «О приложении»;
- «Резервная копия»: «Сохранить в файл» (файл `chess-trainer-ГГГГ-ММ-ДД.json`, на iPhone через системное меню «Поделиться», если оно доступно, иначе скачивание) и «Восстановить из файла» с подтверждением «Текущий прогресс будет заменён»; ошибка `BackupError` показывается текстом;
- напоминание: если с последней копии (или с `firstDay`) прошло больше 14 дней и напоминание не откладывали в последние 14 дней — карточка «Давно не было резервной копии» с кнопками «Сохранить» и «Позже» (`snoozeBackup`);
- «О приложении»: авторы и лицензии наборов фигур из `PIECE_SETS`, chessground (GPL-3), chess.js, Stockfish (GPL-3), база задач Lichess (CC0), ссылка на репозиторий с кодом.

- [ ] **Step 1: Тесты:** напоминание показывается на 15-й день и не показывается после «Позже»; после успешного экспорта вызван `markBackupDone`; ошибка импорта выводит сообщение и не меняет данные.
- [ ] **Step 2:** Тесты падают, реализовать, тесты проходят.
- [ ] **Step 3:** Проверить в браузере: сохранить копию, решить задачу, восстановить, убедиться, что прогресс откатился.
- [ ] **Step 4: Commit** `feat: профиль, прогресс и резервная копия`.

### Task 15: Содержание: основы, круг 1, дебютные принципы

Тексты пишет Claude (Fable). Можно делать параллельно с задачами 9–14.

**Files:**
- Create: `src/content/basics.ts`, `openings.ts`, `explanations.ts`, `src/content/content.test.ts`, `scripts/verify_content.mjs`

**Interfaces:**
- Produces: `getAuthoredLesson(nodeId: string, lessonIndex: number): LessonTask[]`; `getExplain(themeId: ThemeId, mode: 'full' | 'reminder'): ExplainStep[]` (`full`: 2–3 шага, `reminder`: 1 шаг).

Объём:
- «Проверка основ», один урок: шах, мат и пат (4 вопроса `choice` с `fact`), рокировка (2 шага и 2 вопроса: когда можно и когда нельзя), взятие на проходе (1 шаг и 1 задание), ценность фигур (3 вопроса на выгодный размен);
- объяснения для восьми тем круга 1: по 2–3 шага `full` и 1 шаг `reminder`;
- «Дебютные принципы», три урока (центр, развитие фигур, рокировка): в каждом 3 шага объяснения и 8 авторских заданий.

Требования к тексту: шаг объяснения до двух коротких предложений; в каждом шаге, где это возможно, человек делает ход сам; без шахматного жаргона без пояснения при первом употреблении.

- [ ] **Step 1: Тесты `content.test.ts`,** проверяют всё содержание разом:
  - каждый `fen` загружается в chess.js без ошибки;
  - каждый `move` в шагах и каждый ход в `accept` допустим в своей позиции;
  - у каждого вопроса с `fact` позиция соответствует факту: `checkmate` → `isCheckmate()`, `stalemate` → `isStalemate()`, `check` → шах без мата, `none` → ни шаха, ни пата;
  - `correct` в пределах `options`; `explain` непустой;
  - для каждого узла `authored` и каждой темы круга 1 содержание существует; `reminder` состоит ровно из одного шага;
  - в текстах нет слов из списка запрещённых форм: «ошибся», «решил», «сделал», «нашёл».
- [ ] **Step 2:** Тесты падают. Написать содержание. Тесты проходят.
- [ ] **Step 3:** Написать `scripts/verify_content.mjs`: для каждого авторского задания запускает Stockfish (глубина 14) и проверяет, что оценка каждого хода из `accept` не хуже лучшего хода более чем на 0,5 пешки. Запустить: `node scripts/verify_content.mjs`, ожидание — «все задания подтверждены». Расхождения исправить в содержании.
- [ ] **Step 4:** Отдать тексты независимому проверяющему (Opus): шахматная правильность формулировок, понятность новичку. Исправить замечания.
- [ ] **Step 5: Commit** `feat: содержание основ и первого круга`.

### Task 16: Работа без сети, первая загрузка, обновления, выкладка

**Files:**
- Create: `src/screens/FirstLoadScreen.tsx`, `src/screens/UpdateBanner.tsx`, `public/icons/*`, `.github/workflows/deploy.yml`; Modify: `vite.config.ts`, `src/main.tsx`, `index.html`

Поведение:
- `vite-plugin-pwa`: `registerType: 'prompt'`; манифест: название «Шахматный тренажёр», короткое «Шахматы», `display: 'standalone'`, цвета `#16222C`, иконки 192, 512 и `apple-touch-icon` 180; в предзагрузку входят оболочка приложения, шрифт, фигуры, движок и три файла задач (поднять предел размера файла до 20 МБ);
- `FirstLoadScreen`: при первом запуске, пока сервис-воркер не сообщил о готовности, показывает «Загружаю задачи и доску. Это один раз, лучше по Wi-Fi» и полоску. Когда всё сохранено: «Готово. Дальше интернет не нужен». Если сети нет и загрузка не завершена: «Нужен интернет для первой загрузки» и кнопка «Повторить»;
- подсказка установки: если приложение открыто в Safari не с домашнего экрана, один раз показать «Нажми „Поделиться“, затем „На экран Домой“»;
- при старте вызвать `navigator.storage.persist()`, результат не показывать;
- `UpdateBanner`: когда найдена новая версия, полоса «Доступна новая версия» с кнопкой «Обновить»;
- `deploy.yml`: на push в `main` — `npm ci`, `npx vitest run`, `npm run build`, выкладка `dist` на GitHub Pages.

- [ ] **Step 1:** Реализовать всё перечисленное.
- [ ] **Step 2:** `npm run build && npx vite preview`. В браузере: загрузить страницу, дождаться «Готово», включить режим без сети в инструментах разработчика, перезагрузить. Ожидание: приложение открывается, урок и свободные задачи работают, движок отвечает.
- [ ] **Step 3:** Проверить, что в сетевом журнале при работе нет запросов к чужим доменам.
- [ ] **Step 4: Commit** `feat: работа без сети и выкладка`.
- [ ] **Step 5: Публикация, только с согласия владельца.** Владелец создаёт на GitHub пустой публичный репозиторий и входит в аккаунт на компьютере. После его «да»: `git push`, включить Pages (источник GitHub Actions), дождаться сборки, прислать ссылку.

### Task 17: Содержание кругов 2 и 3

**Files:**
- Modify: `src/content/explanations.ts`, `src/content/content.test.ts`

- [ ] **Step 1:** Расширить тест из задачи 15: объяснения `full` и `reminder` есть для всех 19 тем.
- [ ] **Step 2:** Тест падает. Написать объяснения для 11 тем кругов 2 и 3. Тест проходит.
- [ ] **Step 3:** Независимый проверяющий читает тексты, замечания исправить.
- [ ] **Step 4:** В браузере открыть через временную правку прогресса по одному уроку из круга 2 и круга 3, убедиться, что задачи подбираются в коридорах 900–1300 и 1300–1700.
- [ ] **Step 5: Commit** `feat: содержание второго и третьего кругов`. Публикация — снова только с согласия владельца.

### Task 18: Итоговая проверка

- [ ] **Step 1:** `npx vitest run` — все тесты проходят. `npm run build` — без ошибок и предупреждений о типах.
- [ ] **Step 2:** Полный проход в браузере 375×812 с чистой базой: первая загрузка, «Проверка основ», первый урок темы с ошибкой и подсказкой, выход посреди урока и возврат, 10 свободных задач, повторение (сдвинуть дату устройства на день вперёд), смена доски и фигур, копия и восстановление.
- [ ] **Step 3:** Проверить серию сдвигом даты: пропуск одного дня не обнуляет, второго в ту же неделю — обнуляет.
- [ ] **Step 4:** Сверить с описанием по разделам 2, 4, 9–13: каждый пункт либо показан в работе, либо назван как несделанный.
- [ ] **Step 5:** Независимый проверяющий читает весь код ветки.
- [ ] **Step 6:** Владелец проверяет на iPhone: открыть ссылку, добавить на домашний экран, дождаться загрузки, включить авиарежим, пройти урок.
