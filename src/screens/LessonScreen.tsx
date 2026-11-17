import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  clearActiveLesson, completeLesson, getLessonProgress, getSeenPuzzleIds, loadActiveLesson, recordTaskResult,
  saveActiveLesson, type ActiveLesson,
} from '../data/repo';
import { findPuzzle } from '../data/puzzleStore';
import { bestReply as engineBestReply, warmUp as engineWarmUp } from '../engine/engine';
import { puzzleAttempt } from '../domain/attempt';
import { EXAM_ADVICE_BELOW } from '../domain/path';
import type { LessonTask, Source, TaskResult } from '../domain/types';
import { XP } from '../domain/xp';
import { BigButton } from '../ui/BigButton';
import { ProgressBar } from '../ui/ProgressBar';
import { Sheet } from '../ui/Sheet';
import { GAME_NODE_PREFIX } from './gameLessons';
import { describeError, LessonNotFoundError } from './lessonErrors';
import { lessonFactory as realLessonFactory } from './lessonFactory';
import { LessonSummary, type LessonSummaryData } from './LessonSummary';
import { TaskRunner, type BestReply } from './TaskRunner';
import './LessonScreen.css';

export interface Lesson { title: string; source: Source; tasks: LessonTask[] }
export type LessonFactory = (nodeId: string, lessonIndex: number) => Promise<Lesson>;

/** Ход урока: позиции очереди — сначала все задания по порядку, потом возвраты (индексы в retry).
 *  results[i] — итог показа на позиции i; null у объяснений. */
export interface RunProgress { cursor: number; results: (TaskResult | null)[]; retry: number[] }

/** Сохранённый урок: к полям ActiveLesson добавлены название и источник, чтобы продолжить без фабрики. */
type SavedLesson = ActiveLesson & Partial<Pick<Lesson, 'title' | 'source'>>;

const FRESH: RunProgress = { cursor: 0, results: [], retry: [] };

function summarize(tasks: LessonTask[], p: RunProgress): LessonSummaryData {
  const total = tasks.filter((t) => t.kind !== 'explain').length;
  const clean = p.results.slice(0, tasks.length).filter((r) => r === 'clean').length;
  // Опыт — только за первые показы: возврат задачи в конце урока не записывается.
  const xp = p.results.slice(0, tasks.length).reduce<number>((sum, r) => sum + (r === null ? 0 : r === 'clean' ? XP.clean : XP.other), XP.lesson);
  return { clean, total, xp };
}

/** Очередь заданий урока: задания с результатом не clean показываются ещё раз в конце (один раз). */
export function LessonRun({ tasks, source, title, onFinish, onExit, resumeKey, resume = FRESH,
  bestReply = engineBestReply }: {
  tasks: LessonTask[]; source: Source; title: string;
  onFinish(summary: LessonSummaryData): void; onExit(): void;
  /** Если задан, ход урока сохраняется после каждого задания. */
  resumeKey?: { nodeId: string; lessonIndex: number };
  resume?: RunProgress; bestReply?: BestReply;
}) {
  const [progress, setProgress] = useState<RunProgress>(resume);
  const [confirmExit, setConfirmExit] = useState(false);
  // Виденные задачи читаются один раз при начале урока.
  const [seen] = useState(() => getSeenPuzzleIds().catch(() => new Set<string>()));
  const writes = useRef<Promise<void>>(Promise.resolve());

  const n = tasks.length;
  const length = n + progress.retry.length;
  const { cursor } = progress;

  function persist(p: RunProgress) {
    if (!resumeKey) return Promise.resolve();
    const saved: SavedLesson = { ...resumeKey, tasks, ...p, title, source };
    return saveActiveLesson(saved);
  }

  function queue(job: () => Promise<void>) {
    writes.current = writes.current.then(job).catch((e: unknown) => console.error('Не удалось сохранить урок', e));
    return writes.current;
  }

  useEffect(() => {
    void queue(() => persist(progress));
    // Только при открытии: дальше сохраняет handleDone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone(result: TaskResult) {
    const index = cursor < n ? cursor : progress.retry[cursor - n];
    const task = tasks[index];
    const first = cursor < n;
    const recorded = task.kind === 'explain' ? null : result;
    const next: RunProgress = {
      cursor: cursor + 1,
      results: [...progress.results, recorded],
      retry: first && recorded !== null && recorded !== 'clean' ? [...progress.retry, index] : progress.retry,
    };
    setProgress(next);

    const now = new Date();
    void queue(async () => {
      // Возврат задачи в конце урока — часть урока, а не повторение: не двигает интервал и не даёт опыт.
      if (first && task.kind === 'puzzle') {
        await recordTaskResult({ ...puzzleAttempt(task.puzzle, source, await seen), result, source, now });
      } else if (first && recorded !== null) {
        await recordTaskResult({ themes: [], result, source, rated: false, now });
      }
      await persist(next);
    });

    if (next.cursor >= n + next.retry.length) {
      void writes.current.then(() => onFinish(summarize(tasks, next)));
    }
  }

  if (cursor >= length) return null;
  const index = cursor < n ? cursor : progress.retry[cursor - n];

  return (
    <section className="lesson">
      <div className="lesson-top">
        <button type="button" className="lesson-close" aria-label="Выйти из урока" onClick={() => setConfirmExit(true)}>
          ✕
        </button>
        <ProgressBar value={cursor / length} label="Пройдено заданий" />
        <span className="lesson-count">{cursor + 1} из {length}</span>
      </div>
      <TaskRunner key={cursor} task={tasks[index]} title={title} onDone={handleDone} bestReply={bestReply} />
      {confirmExit && (
        <Sheet label="Выход из урока" onClose={() => setConfirmExit(false)}>
          <p className="sheet-text">Выйти? Урок продолжится с этого места</p>
          <div className="sheet-actions">
            <BigButton variant="surface" onClick={() => setConfirmExit(false)}>Остаться</BigButton>
            <BigButton onClick={onExit}>Выйти</BigButton>
          </div>
        </Sheet>
      )}
    </section>
  );
}

type Phase =
  | { kind: 'loading' }
  /** title — что показать вместо «Урок не найден» (например, у партии нет задач). */
  | { kind: 'missing'; title: string }
  /** Урок есть, но открыть его не вышло; detail — текст сбоя для диагностики. */
  | { kind: 'failed'; detail: string }
  /** route — адрес урока, для которого загружен этот ход (`${nodeId}/${lessonIndex}`). */
  | { kind: 'run'; route: string; lesson: Lesson; resume: RunProgress }
  | { kind: 'summary'; summary: LessonSummaryData; advice: boolean };

function canResume(a: SavedLesson | null, nodeId: string, lessonIndex: number): a is SavedLesson & Lesson {
  return !!a && a.nodeId === nodeId && a.lessonIndex === lessonIndex && a.title !== undefined
    && a.source !== undefined && a.tasks.length > 0 && a.cursor < a.tasks.length + a.retry.length;
}

/** Задачи урока из партии живут в базе и пропадают при новом разборе или смене ника.
 *  Такой урок продолжается, только если все его задачи ещё есть; остальные уроки — как прежде. */
async function tasksStillExist(a: SavedLesson): Promise<boolean> {
  if (!a.nodeId.startsWith(GAME_NODE_PREFIX)) return true;
  const ids = a.tasks.flatMap((t) => (t.kind === 'puzzle' ? [t.puzzle.id] : []));
  const found = await Promise.all(ids.map((id) => findPuzzle(id)));
  return found.every((p) => p !== undefined);
}

/** Экран урока: берёт задания у фабрики (или продолжает сохранённый урок), ведёт их и показывает итог.
 *  exitTo — куда вести по выходу из урока и после итога. */
export function LessonScreen({ nodeId: nodeIdProp, lessonIndex: lessonIndexProp, exitTo = '/learn',
  factory = realLessonFactory, bestReply = engineBestReply, warmUp = engineWarmUp }: {
  nodeId?: string; lessonIndex?: number; exitTo?: string; factory?: LessonFactory; bestReply?: BestReply;
  warmUp?: () => Promise<boolean>;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const nodeId = nodeIdProp ?? params.nodeId ?? '';
  const lessonIndex = lessonIndexProp ?? Number(params.lessonIndex);
  const route = `${nodeId}/${lessonIndex}`;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Растёт по кнопке «Повторить»: загрузка урока запускается заново.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Холодный запуск движка дольше его таймаута: прогреваем заранее, чтобы первая ошибка показала ответ.
    warmUp().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    // Новый адрес — новый урок: прежний не остаётся на экране, пока грузится следующий.
    setPhase({ kind: 'loading' });
    (async () => {
      if (!nodeId || !Number.isInteger(lessonIndex)) throw new LessonNotFoundError('Неверный адрес урока');
      const saved = (await loadActiveLesson().catch(() => null)) as SavedLesson | null;
      if (canResume(saved, nodeId, lessonIndex)) {
        if (await tasksStillExist(saved)) {
          const { title, source, tasks, cursor, results, retry } = saved;
          return { lesson: { title, source, tasks }, resume: { cursor, results, retry } };
        }
        // Сохранённый набор устарел: отбрасываем его, урок собирается заново.
        await clearActiveLesson().catch(() => {});
      }
      const lesson = await factory(nodeId, lessonIndex);
      if (lesson.tasks.length === 0) throw new LessonNotFoundError('В уроке нет заданий');
      return { lesson, resume: FRESH };
    })().then(
      ({ lesson, resume }) => { if (alive) setPhase({ kind: 'run', route, lesson, resume }); },
      (e: unknown) => {
        if (!alive) return;
        setPhase(e instanceof LessonNotFoundError
          ? { kind: 'missing', title: e.screenText ?? 'Урок не найден' }
          : { kind: 'failed', detail: describeError(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [nodeId, lessonIndex, route, factory, attempt]);

  const toExit = () => navigate(exitTo);
  const backLabel = exitTo === '/learn' ? 'К урокам' : 'Назад';

  function finish(summary: LessonSummaryData) {
    const advice = nodeId.endsWith(':exam') && summary.total > 0 && summary.clean / summary.total < EXAM_ADVICE_BELOW;
    setPhase({ kind: 'summary', summary, advice });
    completeLesson({ nodeId, lessonIndex, clean: summary.clean, total: summary.total, now: new Date() })
      .then(clearActiveLesson)
      .catch((e: unknown) => console.error('Не удалось записать урок', e));
  }

  // Сразу после смены адреса phase ещё держит прежний урок: показывать его под новым адресом нельзя,
  // иначе LessonRun сохранит его задания с ключом нового урока.
  const shown: Phase = phase.kind === 'run' && phase.route !== route ? { kind: 'loading' } : phase;

  switch (shown.kind) {
    case 'loading':
      return <section className="lesson lesson-message" aria-busy="true" />;
    case 'missing':
      return (
        <section className="lesson lesson-message">
          <h1>{shown.title}</h1>
          <BigButton onClick={toExit}>{backLabel}</BigButton>
        </section>
      );
    case 'failed':
      return (
        <section className="lesson lesson-message">
          <h1>Не удалось открыть урок</h1>
          <p className="lesson-error-detail">{shown.detail}</p>
          <BigButton onClick={() => setAttempt((n) => n + 1)}>Повторить</BigButton>
          <BigButton variant="surface" onClick={toExit}>{backLabel}</BigButton>
        </section>
      );
    case 'run':
      return (
        <LessonRun
          key={shown.route}
          tasks={shown.lesson.tasks}
          source={shown.lesson.source}
          title={shown.lesson.title}
          resume={shown.resume}
          resumeKey={{ nodeId, lessonIndex }}
          onFinish={finish}
          onExit={toExit}
          bestReply={bestReply}
        />
      );
    case 'summary':
      return <LessonSummary {...shown.summary} advice={shown.advice} onDone={toExit} />;
  }
}

/** Урок, который проходят много раз («Слабые места», «Исправить ошибки»): каждый запуск — новый урок узла
 *  с номером по числу уже пройденных. */
export function RepeatLessonScreen({ nodeId, exitTo }: { nodeId: string; exitTo: string }) {
  const [lessonIndex, setLessonIndex] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLessonIndex(null);
    getLessonProgress()
      .then((rows) => rows.filter((r) => r.nodeId === nodeId).length)
      .catch(() => 0)
      .then((count) => { if (alive) setLessonIndex(count); });
    return () => {
      alive = false;
    };
  }, [nodeId]);

  if (lessonIndex === null) return <section className="lesson lesson-message" aria-busy="true" />;
  return <LessonScreen nodeId={nodeId} lessonIndex={lessonIndex} exitTo={exitTo} />;
}

/** «Слабые места». */
export function WeakSpotsScreen() {
  return <RepeatLessonScreen nodeId="weak" exitTo="/learn" />;
}
