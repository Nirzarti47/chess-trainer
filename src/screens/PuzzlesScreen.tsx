import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { THEMES } from '../content/themes';
import { findPuzzle, type PuzzlePool } from '../data/puzzleStore';
import {
  deleteReviews, getDay, getDueReviews, getLessonProgress, getProfile, getSeenPuzzleIds, getThemeStats, recordTaskResult,
} from '../data/repo';
import { bestReply as engineBestReply, warmUp as engineWarmUp } from '../engine/engine';
import { localDay } from '../domain/dates';
import { buildPath } from '../domain/path';
import { nextFreePuzzle } from '../domain/picker';
import { START_RATING } from '../domain/rating';
import { dayCounts, FREE_PUZZLES_PER_DAY } from '../domain/streak';
import type { DayLog, Puzzle, ThemeId, ThemeStat, TaskResult } from '../domain/types';
import { BigButton } from '../ui/BigButton';
import { ProgressBar } from '../ui/ProgressBar';
import { loadOpenPool, openBand, openThemesOf } from './openThemes';
import { TaskRunner, type BestReply } from './TaskRunner';
import './LessonScreen.css';
import './PuzzlesScreen.css';

const FREE_TITLE = 'Подборка для тебя';
const REVIEW_TITLE = 'Повторение';

const themeTitle = (id: ThemeId) => THEMES.find((t) => t.id === id)?.title ?? id;
const today = () => localDay(new Date());

/** Открытые темы и коридор, а заодно всё, что нужно экранам вкладки. */
async function loadOpen() {
  const [profile, stats, progress, due, day] = await Promise.all([
    getProfile(), getThemeStats(), getLessonProgress(), getDueReviews(today()), getDay(today()),
  ]);
  const open = openThemesOf(buildPath(progress, stats, profile.fastTrackDeclined, due.length));
  return { ...open, profile, stats, dueCount: due.length, day };
}

function DayLine({ day }: { day: DayLog }) {
  return (
    <span className="puzzles-day">
      {dayCounts(day) ? 'День засчитан' : `Сегодня решено: ${day.freePuzzles} из ${FREE_PUZZLES_PER_DAY} для серии`}
    </span>
  );
}

/** Форма слова по числу: [1, 2–4, 5–20]. */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

interface HubData { themes: ThemeId[]; stats: ThemeStat[]; dueCount: number; day: DayLog }

/** Вкладка «Задачи»: подборка, повторение и задачи по открытым темам. Лимитов нет. */
export function PuzzlesScreen() {
  const navigate = useNavigate();
  const [data, setData] = useState<HubData | null>(null);
  const [failed, setFailed] = useState(false);

  // Данные читаются заново при каждом показе экрана и при возвращении в приложение.
  useEffect(() => {
    let alive = true;
    const load = () => loadOpen().then(
      (d) => { if (alive) setData(d); },
      (e: unknown) => {
        console.error('Не удалось загрузить задачи', e);
        if (alive) setFailed(true);
      },
    );
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const rating = (id: ThemeId) => data?.stats.find((s) => s.theme === id)?.rating ?? START_RATING;

  return (
    <section className="puzzles">
      <h1>Задачи</h1>
      {failed && !data && <p className="puzzles-note">Не удалось загрузить задачи</p>}
      {data && (
        <>
          <DayLine day={data.day} />

          <button type="button" className="puzzles-entry puzzles-entry--free" onClick={() => navigate('/run/free')}>
            <span className="puzzles-entry-dot" aria-hidden="true">★</span>
            <span className="puzzles-entry-label">
              <b>{FREE_TITLE}</b>
              <small>Задачи по открытым темам под твой рейтинг</small>
            </span>
          </button>

          {data.dueCount > 0 ? (
            <button type="button" className="puzzles-entry puzzles-entry--review"
              onClick={() => navigate('/run/review')}>
              <span className="puzzles-entry-dot" aria-hidden="true">↻</span>
              <span className="puzzles-entry-label">
                <b>{REVIEW_TITLE}</b>
                <small>
                  {data.dueCount} {plural(data.dueCount, ['задача ждёт', 'задачи ждут', 'задач ждут'])}
                </small>
              </span>
            </button>
          ) : (
            <div className="puzzles-entry puzzles-entry--empty">
              <span className="puzzles-entry-dot" aria-hidden="true">↻</span>
              <span className="puzzles-entry-label">
                <b>{REVIEW_TITLE}</b>
                <small>Повторять пока нечего. Задачи появятся здесь после ошибок</small>
              </span>
            </div>
          )}

          <h2>По теме</h2>
          <ul className="puzzles-themes">
            {data.themes.map((id) => (
              <li key={id}>
                <button type="button" onClick={() => navigate(`/run/theme-${id}`)}>
                  <span>{themeTitle(id)}</span> <span className="puzzles-rating">{rating(id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Message({ text, onBack }: { text: string; onBack(): void }) {
  return (
    <section className="lesson lesson-message">
      <h1>{text}</h1>
      <BigButton onClick={onBack}>К задачам</BigButton>
    </section>
  );
}

const Loading = () => <section className="lesson lesson-message" aria-busy="true" />;

function CloseButton({ onClick }: { onClick(): void }) {
  return <button type="button" className="lesson-close" aria-label="Выйти" onClick={onClick}>✕</button>;
}

const signed = (d: number) => (d < 0 ? `−${-d}` : `+${d}`);

interface StreamCtx { pool: PuzzlePool; band: [number, number]; themes: ThemeId[]; seen: Set<string> }

type StreamPhase =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'closed' }
  | { kind: 'run'; puzzle: Puzzle; rated: boolean; rating: number; delta: number | null; day: DayLog; shown: number };

/** Бесконечный поток: подборка по открытым темам или задачи одной темы. После каждой задачи — сразу следующая. */
function PuzzleStream({ theme, onExit, bestReply }: { theme?: ThemeId; onExit(): void; bestReply: BestReply }) {
  const [phase, setPhase] = useState<StreamPhase>({ kind: 'loading' });
  const ctx = useRef<StreamCtx | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);

  /** Следующая задача по свежей статистике; показанные в этой сессии тоже считаются виденными. */
  function nextPhase(c: StreamCtx, stats: ThemeStat[], rating: number, day: DayLog, delta: number | null,
    shown: number): StreamPhase {
    const puzzle = nextFreePuzzle({ pool: c.pool, band: c.band, openThemes: c.themes, stats, overall: rating,
      seen: c.seen, rng: Math.random, theme });
    const rated = !c.seen.has(puzzle.id);
    c.seen.add(puzzle.id);
    return { kind: 'run', puzzle, rated, rating, delta, day, shown };
  }

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    (async (): Promise<StreamPhase> => {
      const open = await loadOpen();
      if (theme !== undefined && !open.themes.includes(theme)) return { kind: 'closed' };
      const [pool, seen] = await Promise.all([loadOpenPool(open.circle), getSeenPuzzleIds()]);
      if (!alive) return { kind: 'loading' };
      const c: StreamCtx = { pool, band: openBand(open.circle), themes: open.themes, seen: new Set(seen) };
      ctx.current = c;
      return nextPhase(c, open.stats, open.profile.rating, open.day, null, 0);
    })().then(
      (p) => { if (alive) setPhase(p); },
      (e: unknown) => {
        console.error('Не удалось подобрать задачу', e);
        if (alive) setPhase({ kind: 'failed' });
      },
    );
    return () => {
      alive = false;
      mounted.current = false;
    };
    // Тема задаётся при монтировании: другой режим монтирует поток заново (key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDone(result: TaskResult) {
    if (phase.kind !== 'run' || busy.current) return;
    busy.current = true;
    const { puzzle, rated, rating, shown } = phase;
    try {
      await recordTaskResult({ puzzleId: puzzle.id, themes: puzzle.themes, puzzleRating: puzzle.rating, result,
        source: 'free', rated, now: new Date() });
    } catch (e: unknown) {
      console.error('Не удалось записать задачу', e);
    }
    let next: StreamPhase;
    try {
      const [stats, profile, day] = await Promise.all([getThemeStats(), getProfile(), getDay(today())]);
      next = nextPhase(ctx.current!, stats, profile.rating, day, rated ? profile.rating - rating : null, shown + 1);
    } catch (e: unknown) {
      console.error('Не удалось подобрать задачу', e);
      next = { kind: 'failed' };
    }
    busy.current = false;
    if (mounted.current) setPhase(next);
  }

  switch (phase.kind) {
    case 'loading':
      return <Loading />;
    case 'failed':
      return <Message text="Не удалось загрузить задачи" onBack={onExit} />;
    case 'closed':
      return <Message text="Эта тема пока закрыта" onBack={onExit} />;
    case 'run':
      return (
        <section className="lesson">
          <div className="lesson-top">
            <CloseButton onClick={onExit} />
            <DayLine day={phase.day} />
            {phase.delta !== null && phase.delta !== 0 && (
              <span className={`stream-delta stream-delta--${phase.delta < 0 ? 'down' : 'up'}`}>
                {signed(phase.delta)}
              </span>
            )}
            <span className="stream-rating" aria-label="Рейтинг в задачах">{phase.rating}</span>
          </div>
          <TaskRunner key={phase.shown} task={{ kind: 'puzzle', puzzle: phase.puzzle }}
            title={theme !== undefined ? themeTitle(theme) : FREE_TITLE} onDone={(r) => void handleDone(r)}
            bestReply={bestReply} />
        </section>
      );
  }
}

/** Задачи со сроком повторения по очереди, без рейтинга. Ошибка переносит задачу на потом, а не в эту сессию. */
function ReviewRun({ onExit, bestReply }: { onExit(): void; bestReply: BestReply }) {
  const [queue, setQueue] = useState<Puzzle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    getDueReviews(today())
      .then(async (due) => {
        const found = await Promise.all(due.map((r) => findPuzzle(r.puzzleId)));
        // Задачи нет в базе (база пересобрана): запись повторения больше не нужна.
        await deleteReviews(due.filter((_, i) => found[i] === undefined).map((r) => r.puzzleId));
        return found.filter((p): p is Puzzle => p !== undefined);
      })
      .then(
        (found) => { if (alive) setQueue(found); },
        (e: unknown) => {
          console.error('Не удалось загрузить повторение', e);
          if (alive) setFailed(true);
        },
      );
    return () => {
      alive = false;
    };
  }, []);

  async function handleDone(puzzle: Puzzle, result: TaskResult) {
    if (busy.current) return;
    busy.current = true;
    try {
      await recordTaskResult({ puzzleId: puzzle.id, themes: puzzle.themes, puzzleRating: puzzle.rating, result,
        source: 'review', rated: false, now: new Date() });
    } catch (e: unknown) {
      console.error('Не удалось записать задачу', e);
    }
    busy.current = false;
    setCursor((c) => c + 1);
  }

  if (failed) return <Message text="Не удалось загрузить задачи" onBack={onExit} />;
  if (!queue) return <Loading />;
  if (cursor >= queue.length) return <Message text="На сегодня всё повторено" onBack={onExit} />;

  const puzzle = queue[cursor];
  return (
    <section className="lesson">
      <div className="lesson-top">
        <CloseButton onClick={onExit} />
        <ProgressBar value={cursor / queue.length} label="Повторено задач" />
        <span className="lesson-count">{cursor + 1} из {queue.length}</span>
      </div>
      <TaskRunner key={cursor} task={{ kind: 'puzzle', puzzle }} title={REVIEW_TITLE}
        onDone={(r) => void handleDone(puzzle, r)} bestReply={bestReply} />
    </section>
  );
}

const THEME_PREFIX = 'theme-';

/** Маршрут `#/run/:mode` для режимов вкладки «Задачи»: free, theme-<id>, review. Выход крестиком без подтверждения. */
export function PuzzleRunScreen({ mode: modeProp, bestReply = engineBestReply, warmUp = engineWarmUp }: {
  mode?: string; bestReply?: BestReply; warmUp?: () => Promise<boolean>;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const mode = modeProp ?? params.mode ?? '';

  useEffect(() => {
    // Холодный запуск движка дольше его таймаута: прогреваем заранее, чтобы первая ошибка показала ответ.
    warmUp().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toPuzzles = () => navigate('/puzzles');
  if (mode === 'review') return <ReviewRun key={mode} onExit={toPuzzles} bestReply={bestReply} />;
  if (mode === 'free') return <PuzzleStream key={mode} onExit={toPuzzles} bestReply={bestReply} />;
  if (mode.startsWith(THEME_PREFIX)) {
    return <PuzzleStream key={mode} theme={mode.slice(THEME_PREFIX.length)} onExit={toPuzzles} bestReply={bestReply} />;
  }
  return <Navigate to="/puzzles" replace />;
}
