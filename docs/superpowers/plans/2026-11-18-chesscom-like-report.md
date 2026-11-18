# Отчёт о партии «как на Chess.com» — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** десять видов оценки хода, точность по способу Lichess и сводка/разбор с теми же значками и цветами, что «Отчёт о партии» Chess.com.

**Architecture:** виды ходов и точность — чистые функции от сохранённого разбора (`GameAnalysis`), считаются при показе; повторного разбора и смены `RULES_VERSION` нет. Теоретические ходы — по сжатому списку позиций из открытого списка дебютов Lichess (файл данных в `public/`, грузится один раз). Значки — свой SVG-компонент в `src/ui/`.

**Tech Stack:** Vite, React 19, TypeScript, Vitest + jsdom + fake-indexeddb, chess.js, chessground 9, Dexie 4, vite-plugin-pwa.

**Spec:** `docs/superpowers/specs/2026-11-18-chesscom-like-report-design.md`

## Global Constraints

- Всё бесплатно; новых npm-зависимостей нет.
- Работает без сети (файл дебютов — в `public/`, попадает в предзагрузку PWA по `globPatterns` с `json`).
- IndexedDB без курсоров: только `toArray`, `get`, `bulkGet` и фильтр в коде.
- Числа-пороги разбора — только в `src/analysis/config.ts`.
- Тексты интерфейса — по-русски, на «ты», без форм прошедшего времени с родом о владельце.
- В репозитории нет настоящих партий и чужих ников (в тестах — `Owner_Test`, `rival_one`, `rival_two`).
- Сохранённые разборы и `SideSummary` в них не меняются и не удаляются; `RULES_VERSION` не поднимается.
- `src/engine/engine.ts` и его тесты не меняются.
- Картинки Chess.com не копируются: значки рисуются свои.
- Публикация на телефон (push в `main`) — только с согласия владельца; работа идёт в ветке `chesscom-report`.

## Review Focus

1. Старый разбор (версии 2, сохранён до этой доработки) — сводка и разбор открываются, сумма строк каждой стороны = числу её ходов. → тест в задаче 1 (`categorize` на разборе без знаков и с `deep: false`).
2. Сторона с одним ходом или без ходов — точность не `NaN`: без ходов показывается «—». → тест в задаче 2.
3. Мат и конец партии в оценках (`{mate}`, `{over}`) — точность считается без `NaN`. → тест в задаче 2.
4. Файл дебютов не загрузился (первый запуск без сети, сбой) — сводка всё равно показывается, теоретических ходов 0. → тест в задаче 4.
5. Владелец играет чёрными — его числа в правом столбце (столбцы по цвету), имя «Ты» над правым столбцом. → тест в задаче 4.

---

### Task 1: Десять видов оценки хода

**Files:**
- Create: `src/analysis/report.ts`, `src/analysis/report.test.ts`
- Modify: `src/analysis/config.ts` (новые числа), `src/analysis/phrases.ts` (`CATEGORY_TITLE`)

**Interfaces:**
- Consumes: `GameAnalysis`, `MoveReview`, `Side`, `Score` из `src/domain/gameTypes.ts`; `expected` из `src/analysis/score.ts`; `CONFIG`.
- Produces:

```ts
// report.ts
export type Category = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';
/** Порядок строк сводки, как у Chess.com. */
export const CATEGORY_ORDER: readonly Category[] =
  ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
/** Вид каждого хода: результат[i] — для a.moves[i]. bookPlies — сколько первых полуходов партии теоретические. */
export function categorize(a: GameAnalysis, bookPlies: number): Category[];
export interface SideReport { counts: Record<Category, number>; accuracy: number | null }
export interface GameReport { categories: Category[]; white: SideReport; black: SideReport }
/** Задача 1 заполняет accuracy через временную заглушку null; задача 2 подставляет gameAccuracy. */
export function reportOf(a: GameAnalysis, bookPlies: number): GameReport;
// config.ts — добавить
EXCELLENT_MAX: 0.02, MISS_SHARE: 0.5, MISS_SLACK: 0.05,
// phrases.ts — добавить
export const CATEGORY_TITLE: Record<Category, string>;
// brilliant 'Блестящий ход', great 'Замечательный', best 'Лучший', excellent 'Отлично', good 'Хорошо',
// book 'Теоретический ход', inaccuracy 'Неточность', mistake 'Ошибка', miss 'Упущенная возможность', blunder 'Зевок'
```

Правила `categorize` — сверху вниз, первое подходящее (описание, 6.2): `i < bookPlies` → `book`; `mark === 'brilliant'` → `brilliant`; `mark === 'great'` → `great`; `grade === 'best'` → `best`; `loss < EXCELLENT_MAX` → `excellent`; `loss < GOOD_MAX` → `good`; `loss < INACCURACY_MAX` → `inaccuracy`; упущенная возможность → `miss`; `loss < MISTAKE_MAX` → `mistake`; иначе `blunder`.

Упущенная возможность (ход `i`, ходит `mover`, `prev = a.moves[i-1]`): `i ≥ 1`, `prev.loss ≥ INACCURACY_MAX`, `m.loss ≥ INACCURACY_MAX`, `m.loss ≥ MISS_SHARE * prev.loss`, `expected(a.scores[i+1], mover) ≥ expected(a.scores[i-1], mover) - MISS_SLACK`.

- [ ] **Step 1: тесты `report.test.ts`** (разбор собирается руками: `moves` с нужными `loss`/`grade`/`mark`, `scores` длиной `moves.length + 1`):
  - каждый из десяти видов получается на своём ходе (по одному тесту на правило, значения: `loss` 0.01 → `excellent`, 0.03 → `good`, 0.07 → `inaccuracy`, 0.15 → `mistake`, 0.3 → `blunder`; `grade: 'best'` с `mark: 'great'` → `great`; `mark: 'brilliant'` → `brilliant`; `bookPlies: 2` → первые два хода `book` даже при `grade: 'blunder'`);
  - упущенная возможность: соперник подарил 0.3 (`scores`: до его хода `{cp:0}`, после — `{cp:+300}` в пользу ходящего), ход теряет 0.2 и возвращает к `{cp:0}` → `miss`; тот же ход, но после него `{cp:-300}` (ниже, чем до подарка, больше чем на 0.05) → `blunder`; потеря хода 0.12 при подарке 0.3 (меньше половины) → `mistake`; предыдущий ход соперника — неточность 0.07 → не `miss`;
  - `reportOf`: счёт по сторонам (чётные `ply` — белые), сумма `counts` каждой стороны = числу её ходов; разбор, где у ходов нет `mark` и `deep: false` (Review Focus 1), — сумма тоже сходится;
  - `CATEGORY_TITLE` — десять строк из брифа.
- [ ] **Step 2:** `npx vitest run src/analysis/report.test.ts` — падает (модуля нет).
- [ ] **Step 3:** реализация `report.ts`, числа в `config.ts`, `CATEGORY_TITLE` в `phrases.ts`; `accuracy: null` до задачи 2.
- [ ] **Step 4:** тесты проходят; `npm test`, `npx tsc -b` чисто.
- [ ] **Step 5:** commit `feat: десять видов оценки хода`.

---

### Task 2: Точность по способу Lichess

**Files:**
- Create: `src/analysis/accuracy.ts`, `src/analysis/accuracy.test.ts`
- Modify: `src/analysis/config.ts`, `src/analysis/report.ts` (`reportOf` берёт `gameAccuracy`)

**Interfaces:**
- Consumes: `Score`, `Side`; `expected`.
- Produces:

```ts
// accuracy.ts
/** Точность хода по изменению вероятности выигрыша ходящего (0..100). */
export function moveAccuracyWin(winBefore: number, winAfter: number): number;
/** Точность стороны за партию; null, если у стороны нет ходов. scores — как в GameAnalysis (белая точка зрения). */
export function gameAccuracy(scores: Score[], side: Side): number | null;
// config.ts — добавить (до подгонки — как у Lichess)
ACC_WINDOW_MIN: 2, ACC_WINDOW_MAX: 8, ACC_WEIGHT_MIN: 0.5, ACC_WEIGHT_MAX: 12, ACC_LOSS_SCALE: 1,
```

Алгоритм (Lichess, открытый; сигнатура его не определяет):
- вероятность выигрыша белых в позиции `win[i] = 100 * expected(scores[i], 'white')`;
- точность хода стороны: `before`, `after` — вероятность выигрыша ходящего до и после; если `after >= before` → 100, иначе `103.1668100711649 * exp(-0.04354415386753951 * ACC_LOSS_SCALE * (before - after)) - 3.166924740191411 + 1`, в пределах 0..100;
- окно `w = clamp(floor(число_ходов_партии / 10), ACC_WINDOW_MIN, ACC_WINDOW_MAX)`; окна — `w − 2` копий первых `w` значений `win`, затем все скользящие окна длины `w` по `win`; вес окна — стандартное отклонение его значений в пределах `ACC_WEIGHT_MIN..ACC_WEIGHT_MAX`; ход `i` получает вес окна `i`;
- точность стороны = (взвешенное среднее её ходов + гармоническое среднее её ходов) / 2; в гармоническом среднем точность хода берётся не меньше 1 (иначе один ход с нулём обнуляет всё).

- [ ] **Step 1: тесты `accuracy.test.ts`:**
  - `moveAccuracyWin(50, 50)` → 100; `moveAccuracyWin(60, 70)` → 100; `moveAccuracyWin(70, 20)` меньше 15;
  - партия без потерь (все `scores` `{cp: 20}`) → обе стороны 100;
  - партия, где у белых одна грубая ошибка (`{cp:30}` → `{cp:-500}`) среди восьми ровных ходов: `gameAccuracy` белых меньше простого среднего точностей их ходов не меньше чем на 5 пунктов, а у чёрных ≥ 90;
  - `{mate: 3}`, `{mate: -2}`, `{over: 'white'}`, `{over: 'draw'}` в `scores` — результат число, не `NaN` (Review Focus 3);
  - партия из одного полухода: у белых число, у чёрных `null` (Review Focus 2);
  - `reportOf` теперь заполняет `accuracy` числом.
- [ ] **Step 2:** `npx vitest run src/analysis/accuracy.test.ts` — падает.
- [ ] **Step 3:** реализация; `reportOf` вызывает `gameAccuracy(a.scores, side)`.
- [ ] **Step 4:** тесты проходят; `npm test`, `npx tsc -b` чисто.
- [ ] **Step 5:** commit `feat: точность партии по способу Lichess`.

---

### Task 3: Список дебютов

**Files:**
- Create: `scripts/build_openings.mjs`, `public/openings.json`, `src/analysis/openings.ts`, `src/analysis/openings.test.ts`
- Modify: `package.json` (скрипт `build:openings`)

**Interfaces:**
- Consumes: chess.js.
- Produces:

```ts
// openings.ts
export interface OpeningBook { has(key: string): boolean }
/** Ключ позиции: первые три поля FEN — расстановка, очередь хода, рокировки. */
export function positionKey(fen: string): string;
/** Сколько первых полуходов партии (UCI с начальной позиции) подряд ведут в позиции из книги. */
export function bookLength(moves: string[], book: OpeningBook): number;
/** Книга из файла public/openings.json; грузится один раз и запоминается; при сбое — пустая книга (без исключения). */
export function loadOpeningBook(): Promise<OpeningBook>;
/** Книга из набора ключей — для тестов и для loadOpeningBook. */
export function bookFromKeys(keys: Iterable<string>): OpeningBook;
```

Источник: `https://github.com/lichess-org/chess-openings` (CC0), файлы `a.tsv`…`e.tsv` (столбцы `eco`, `name`, `pgn`). Скрипт скачивает их (Node `fetch`), проходит каждую запись `pgn` с начальной позиции и собирает ключи ВСЕХ позиций после каждого полухода, уникальные; пишет `public/openings.json` в компактном виде (выбор строителя: например, отсортированный массив 32-битных хешей ключей; тогда `bookFromKeys` хеширует так же). Цель по размеру — не больше 100 КБ. В шапке файла данных или рядом в `scripts/` — источник и лицензия. Проверка позиции идёт по ключу, поэтому перестановки ходов тоже считаются.

`bookLength`: идти по ходам партии с начальной позиции; полуход `i` теоретический, если позиция после него есть в книге; на первом нетеоретическом остановиться (дальше теоретических нет, даже если позиция вернулась в книгу).

- [ ] **Step 1: тесты `openings.test.ts`** (книга — `bookFromKeys` из позиций, собранных в тесте по ходам `e2e4 e7e5 g1f3 b8c6 f1c4`):
  - `positionKey` отбрасывает счётчики и поле взятия на проходе;
  - `bookLength(['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6'], book)` → 5;
  - перестановка: книга из линий `g1f3 b8c6 e2e4` и `e2e4 e7e5 g1f3 b8c6`; партия `['g1f3','b8c6','e2e4','e7e5']` → 4 (позиция после 4-го полухода совпадает по ключу с позицией второй линии);
  - первый ход вне книги: `['d2d4','d7d5']` при той же книге → 0;
  - выход и возврат: книга содержит позиции после 1-го и 3-го полухода, но не после 2-го → 1;
  - пустая книга → 0;
  - `public/openings.json` загружается через `bookFromKeys`/разбор файла (чтение файла с диска в тесте) и содержит позицию после `1. e4 e5 2. Nf3 Nc6 3. Bc4` (итальянская партия) и после `1. d4 d5 2. c4` (ферзевый гамбит);
  - `loadOpeningBook` при сбое `fetch` возвращает книгу, где `has` всегда `false`, и не бросает.
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3:** скрипт; запустить `npm run build:openings` (нужна сеть, только `raw.githubusercontent.com/lichess-org/chess-openings/...`); `public/openings.json`; `openings.ts`.
- [ ] **Step 4:** тесты проходят; размер файла в отчёте; `npm test`, `npx tsc -b`, `npm run build` чисто (файл попал в `dist/`).
- [ ] **Step 5:** commit `feat: список дебютов Lichess для теоретических ходов`.

---

### Task 4: Значки и сводка партии как у Chess.com

**Files:**
- Create: `src/ui/CategoryIcon.tsx`, `src/ui/CategoryIcon.test.tsx`
- Modify: `src/ui/theme.css` (переменные `--cat-<вид>`), `src/screens/games/GameSummaryScreen.tsx`, `GameSummaryScreen.css`, `GameSummaryScreen.test.tsx`

**Interfaces:**
- Consumes: `Category`, `CATEGORY_ORDER`, `reportOf` (1, 2); `CATEGORY_TITLE` (1); `loadOpeningBook`, `bookLength` (3).
- Produces:

```ts
// CategoryIcon.tsx — кружок цвета вида (var(--cat-<вид>)) с белым знаком внутри; size в px
export function CategoryIcon(p: { category: Category; size?: number }): JSX.Element;   // role="img", aria-label = CATEGORY_TITLE
```

Цвета (описание, 6.5; оттенки можно подправить по скриншоту): `--cat-brilliant #26C2A3`, `--cat-great #5C8BB0`, `--cat-best #81B64C`, `--cat-excellent #96BC4B`, `--cat-good #96AF8B`, `--cat-book #A88865`, `--cat-inaccuracy #F7C045`, `--cat-mistake #FFA459`, `--cat-miss #FF7769`, `--cat-blunder #FA412D`. Знаки: «!!», «!», звезда, палец вверх, галочка, раскрытая книжка, «?!», «?», крестик, «??».

Сводка (описание, 6.5): фон экрана сводки `#302E2B`, строки на `#262421`; шапка как сейчас; имена над столбцами («Ты» и ник соперника), столбцы по цвету — белые слева; строка «Точность»: плашка белых — белая с тёмным числом, плашка чёрных — `#403D39` со светлым числом; число с одним знаком после запятой (`64.8`), без ходов — «—»; черта; десять строк по `CATEGORY_ORDER` всегда (название, число белых, значок 28–32 px, число чёрных; числа цветом значка, нули — тоже); ниже «Совет», «Разбор занял N с», строка про задачи — как сейчас, в цветах сводки; кнопки прижаты к низу: «Смотреть разбор» — зелёная `#81B64C` с нижней кромкой `#45753C`, белый текст; «Исправить ошибки (N)» — вторичная, тёмная. Пока книга грузится, сводка показывается после загрузки (книга грузится один раз за сеанс). Старые строки «Лучшие/Хорошие/…» и показ `SideSummary` убрать.

- [ ] **Step 1: тесты:**
  - `CategoryIcon`: для каждого из десяти видов — элемент с `aria-label` из `CATEGORY_TITLE` и цветом `var(--cat-<вид>)`;
  - сводка: десять строк в порядке `CATEGORY_ORDER`, в том числе с нулями; числа по столбцам совпадают с `reportOf`;
  - владелец чёрными: «Ты» над правым столбцом, его числа справа (Review Focus 5);
  - точность `64.83` показана как `64.8`; сторона без ходов — «—»;
  - книга не загрузилась (`loadOpeningBook` вернул пустую книгу или подменённый `fetch` упал) — сводка показана, «Теоретический ход» 0 (Review Focus 4);
  - прежние тесты сводки (полоса разбора, сбой, «Партия не найдена», кнопки, совет) проходят — строки старой таблицы в них заменить на новые.
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3:** реализация.
- [ ] **Step 4:** тесты проходят; `npm test`, `npx tsc -b` чисто.
- [ ] **Step 5:** commit `feat: сводка партии как «Отчёт о партии» Chess.com`.

---

### Task 5: Те же значки и названия в разборе

**Files:**
- Modify: `src/ui/Board.tsx`, `src/ui/board.css`, `src/ui/Board.test.tsx`, `src/screens/games/reviewModel.ts` (+test), `MoveCard.tsx`, `GameChart.tsx` (+test), `ReviewScreen.tsx`, `ReviewScreen.test.tsx`

**Interfaces:**
- Consumes: `Category`, `categorize` (1); `bookLength`, `loadOpeningBook` (3); `CategoryIcon` (4); `CATEGORY_TITLE` (1).
- Produces:

```ts
// Board.tsx — свойство badge меняется (других потребителей badge нет — проверить поиском)
badge?: { square: string; category: Category };   // рисует CategoryIcon в углу поля
// reviewModel.ts
// PlyView получает поле category: Category | null (null в позиции 0); badgeText удаляется
export function buildPlyViews(game: GameRecord, a: GameAnalysis, categories: Category[]): PlyView[];
```

- Значок на доске — у каждого хода, все десять видов (описание, 6.6), включая ход соперника.
- Плашка в карточке хода: значок + `CATEGORY_TITLE`, фон — `var(--cat-<вид>)`.
- Точки графика: ходы владельца с видами `mistake`, `miss`, `blunder`, `great`, `brilliant` — цветом вида.
- Подсветка «плохого» хода (`lastMoveTone: 'bad'`): `mistake`, `miss`, `blunder`.
- «Следующая ошибка»: ходы владельца с видами `mistake`, `miss`, `blunder`.
- Старые `GRADE_TITLE`, `MARK_TITLE`, `--grade-*` удалить, если больше нигде не используются (проверить поиском); иначе оставить.
- Экран разбора грузит книгу (`loadOpeningBook`) вместе с разбором; при сбое — книга пустая.

- [ ] **Step 1: тесты:**
  - `Board`: `badge` с `category: 'excellent'` рисует значок с `aria-label` «Отлично» на нужном поле (обе ориентации); прежние тесты доски без `badge` не меняются;
  - `buildPlyViews`: `views[0].category === null`, `views[i].category === categories[i-1]`;
  - разбор: на ходе с видом `miss` плашка «Упущенная возможность», на доске значок того же вида; на ходе соперника `blunder` — «Зевок»; «Следующая ошибка» останавливается на `miss` владельца;
  - `GameChart`: точка на `miss` владельца есть, на `excellent` — нет.
- [ ] **Step 2:** тесты падают.
- [ ] **Step 3:** реализация.
- [ ] **Step 4:** тесты проходят; `npm test`, `npx tsc -b` чисто.
- [ ] **Step 5:** commit `feat: значки и названия десяти видов в разборе`.

---

### Task 6: Подгонка точности и проход в браузере (выполняет ведущий)

**Files:**
- Modify: `src/analysis/config.ts` (числа точности и, при необходимости, `MISS_*`), описание (раздел 6.3 — итог подгонки).

- [ ] **Step 1:** собрать приложение в отдельную папку (как на этапе 2), открыть во встроенном браузере, ввести ник владельца, разобрать партии, у которых Chess.com отдаёт `accuracies` (39 партий; запросы к Chess.com — только по нику). Данные остаются в браузере.
- [ ] **Step 2:** скриптом в браузере посчитать нашу точность по этим партиям и сравнить с числами Chess.com: средняя разница; доля совпадений «кто точнее» среди партий, где у Chess.com стороны отличаются на 3 пункта и больше.
- [ ] **Step 3:** порядок остановки из описания (6.3): Lichess как есть → один множитель `ACC_LOSS_SCALE` → лучший найденный вариант с честным итогом. Цель: средняя разница ≤ 5, совпадение «кто точнее» ≥ 90 %.
- [ ] **Step 4:** для партии со скриншота владельца сравнить счёт десяти видов с Chess.com (записать в отчёт; правила не подгонять под одну партию).
- [ ] **Step 5:** проход в браузере на 390×844: сводка рядом со скриншотом владельца, кнопки видны без прокрутки, значки в разборе на доске и в карточке, ход соперника, график.
- [ ] **Step 6:** `npm test`, `npx tsc -b`, `npm run build` чисто; commit `chore: подгонка точности под Chess.com`.
