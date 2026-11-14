import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  clearActiveLesson, completeLesson, getLessonProgress, getSeenPuzzleIds, loadActiveLesson, recordTaskResult,
  saveActiveLesson, type ActiveLesson,
} from '../data/repo';
import { bestReply as engineBestReply, warmUp as engineWarmUp } from '../engine/engine';
import { EXAM_ADVICE_BELOW } from '../domain/path';
import type { LessonTask, Source, TaskResult } from '../domain/types';
import { XP } from '../domain/xp';
import { BigButton } from '../ui/BigButton';
import { ProgressBar } from '../ui/ProgressBar';
import { Sheet } from '../ui/Sheet';
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
  const xp = p.results.reduce<number>((sum, r) => sum + (r === null ? 0 : r === 'clean' ? XP.clean : XP.other), XP.lesson);
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
      if (task.kind === 'puzzle') {
        const { puzzle } = task;
        const rated = first && source !== 'review' && !(await seen).has(puzzle.id);
        await recordTaskResult({ puzzleId: puzzle.id, themes: puzzle.themes, puzzleRating: puzzle.rating,
          result, source, rated, now });
      } else if (recorded !== null) {
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
  | { kind: 'missing' }
  /** route — адрес урока, для которого загружен этот ход (`${nodeId}/${lessonIndex}`). */
  | { kind: 'run'; route: string; lesson: Lesson; resume: RunProgress }
  | { kind: 'summary'; summary: LessonSummaryData; advice: boolean };

function canResume(a: SavedLesson | null, nodeId: string, lessonIndex: number): a is SavedLesson & Lesson {
  return !!a && a.nodeId === nodeId && a.lessonIndex === lessonIndex && a.title !== undefined
    && a.source !== undefined && a.tasks.length > 0 && a.cursor < a.tasks.length + a.retry.length;
}

/** Экран урока: берёт задания у фабрики (или продолжает сохранённый урок), ведёт их и показывает итог. */
export function LessonScreen({ nodeId: nodeIdProp, lessonIndex: lessonIndexProp, factory = realLessonFactory,
  bestReply = engineBestReply, warmUp = engineWarmUp }: {
  nodeId?: string; lessonIndex?: number; factory?: LessonFactory; bestReply?: BestReply;
  warmUp?: () => Promise<boolean>;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const nodeId = nodeIdProp ?? params.nodeId ?? '';
  const lessonIndex = lessonIndexProp ?? Number(params.lessonIndex);
  const route = `${nodeId}/${lessonIndex}`;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

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
      if (!nodeId || !Number.isInteger(lessonIndex)) throw new Error('Неверный адрес урока');
      const saved = (await loadActiveLesson().catch(() => null)) as SavedLesson | null;
      if (canResume(saved, nodeId, lessonIndex)) {
        const { title, source, tasks, cursor, results, retry } = saved;
        return { lesson: { title, source, tasks }, resume: { cursor, results, retry } };
      }
      const lesson = await factory(nodeId, lessonIndex);
      if (lesson.tasks.length === 0) throw new Error('В уроке нет заданий');
      return { lesson, resume: FRESH };
    })().then(
      ({ lesson, resume }) => { if (alive) setPhase({ kind: 'run', route, lesson, resume }); },
      () => { if (alive) setPhase({ kind: 'missing' }); },
    );
    return () => {
      alive = false;
    };
  }, [nodeId, lessonIndex, route, factory]);

  const toLearn = () => navigate('/learn');

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
          <h1>Урок не найден</h1>
          <BigButton onClick={toLearn}>К урокам</BigButton>
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
          onExit={toLearn}
          bestReply={bestReply}
        />
      );
    case 'summary':
      return <LessonSummary {...shown.summary} advice={shown.advice} onDone={toLearn} />;
  }
}

/** «Слабые места»: каждый запуск — новый урок узла weak с номером по числу уже пройденных. */
export function WeakSpotsScreen() {
  const [lessonIndex, setLessonIndex] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getLessonProgress()
      .then((rows) => rows.filter((r) => r.nodeId === 'weak').length)
      .catch(() => 0)
      .then((count) => { if (alive) setLessonIndex(count); });
    return () => {
      alive = false;
    };
  }, []);

  if (lessonIndex === null) return <section className="lesson lesson-message" aria-busy="true" />;
  return <LessonScreen nodeId="weak" lessonIndex={lessonIndex} />;
}
