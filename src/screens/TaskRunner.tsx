import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Chess } from 'chess.js';
import { bestReply as engineBestReply } from '../engine/engine';
import { legalDests, resultOf, sideToMove, startPuzzle, takeHint, tryMove } from '../domain/puzzle';
import type { AuthoredTask, ChoiceQuestion, ExplainStep, LessonTask, Puzzle, TaskResult } from '../domain/types';
import { BigButton } from '../ui/BigButton';
import { Board } from '../ui/Board';
import './LessonScreen.css';

export type BestReply = (fen: string) => Promise<string | null>;

/** Сколько показывать неверный ход и ответ соперника. */
const WRONG_SHOW_MS = 1200;
/** Пауза между своим ходом и ответом соперника. */
const REPLY_DELAY_MS = 400;
/** Пауза между ходами показанного решения. */
const SOLUTION_STEP_MS = 800;

const NO_DESTS = new Map<string, string[]>();

type Side = 'white' | 'black';
type Square2 = [string, string];

const squares = (uci: string): Square2 => [uci.slice(0, 2), uci.slice(2, 4)];
const turnOfFen = (fen: string): Side => (fen.split(' ')[1] === 'b' ? 'black' : 'white');
const sideCaption = (side: Side) => (side === 'white' ? 'Ход белых' : 'Ход чёрных');

/** Позиция после хода в UCI; ход заранее проверен как допустимый. */
function playOn(fen: string, uci: string): { fen: string; over: boolean } {
  const chess = new Chess(fen);
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { fen: chess.fen(), over: chess.isGameOver() };
}

/** Отложенные действия, которые отменяются, когда задание уходит с экрана. */
function useLater() {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const alive = useRef(true);
  useEffect(() => {
    const pending = timers.current;
    alive.current = true;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);
  return { later, alive };
}

function Frame({ heading, caption, board, body, actions }: {
  heading: string; caption?: string; board?: ReactNode; body?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="task">
      <header className="task-head">
        <h1>{heading}</h1>
        {caption && <span>{caption}</span>}
      </header>
      {board && <div className="task-board">{board}</div>}
      <div className="task-body">{body}</div>
      <div className="task-actions">{actions}</div>
    </div>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: string }) {
  return <p className={`task-verdict ${ok ? 'task-verdict--ok' : 'task-verdict--bad'}`}>{children}</p>;
}

function NextButton({ onClick }: { onClick(): void }) {
  return <BigButton className="task-main" onClick={onClick}>Дальше</BigButton>;
}

interface View { fen: string; lastMove: Square2 | null; arrows?: Square2[] }

function PuzzleTask({ puzzle, title, onDone, bestReply }: {
  puzzle: Puzzle; title: string; onDone(r: TaskResult): void; bestReply: BestReply;
}) {
  const [state, setState] = useState(() => startPuzzle(puzzle));
  const [orientation] = useState(() => sideToMove(startPuzzle(puzzle)));
  /** Временная картинка поверх позиции задачи: неверный ход, промежуточный ход, решение. */
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<'wrong' | 'wrongReply' | null>(null);
  const [hint, setHint] = useState<{ square?: string; move?: string }>({});
  const [replay, setReplay] = useState<'none' | 'playing' | 'done'>('none');
  const { later, alive } = useLater();

  const interactive = state.status === 'playing' && !busy && !view;
  const fen = view?.fen ?? state.fen;

  async function onMove(uci: string) {
    if (!interactive) return;
    const { state: next, outcome } = tryMove(state, uci);
    if (outcome === 'illegal') return;
    setHint({});
    setState(next);
    if (outcome === 'solved') {
      setFeedback(null);
      return;
    }
    if (outcome === 'correct') {
      setFeedback(null);
      setView({ fen: playOn(state.fen, uci).fen, lastMove: squares(uci) });
      later(() => setView(null), REPLY_DELAY_MS);
      return;
    }
    // Неверный ход: показываем его и, если движок успел, ответ соперника.
    const after = playOn(state.fen, uci);
    const shown: View = { fen: after.fen, lastMove: squares(uci) };
    setFeedback('wrong');
    setBusy(true);
    setView(shown);
    let reply: string | null = null;
    if (!after.over) {
      try {
        reply = await bestReply(after.fen);
      } catch {
        reply = null;
      }
    }
    if (!alive.current) return;
    if (!reply) {
      setView(null);
      setBusy(false);
      return;
    }
    setView({ ...shown, arrows: [squares(reply)] });
    setFeedback('wrongReply');
    later(() => {
      setView(null);
      setBusy(false);
      setFeedback('wrong');
    }, WRONG_SHOW_MS);
  }

  function onHint() {
    const r = takeHint(state);
    setState(r.state);
    if (r.square) setHint({ square: r.square });
    if (r.move) setHint({ move: r.move });
  }

  function showSolution() {
    const frames: View[] = [];
    let at = state.fen;
    for (const m of puzzle.moves.slice(state.step)) {
      at = playOn(at, m).fen;
      frames.push({ fen: at, lastMove: squares(m) });
    }
    setFeedback(null);
    setReplay('playing');
    frames.forEach((f, i) => later(() => setView(f), i * SOLUTION_STEP_MS));
    later(() => setReplay('done'), Math.max(frames.length - 1, 0) * SOLUTION_STEP_MS);
  }

  const done = state.status === 'solved' || replay === 'done';
  let actions: ReactNode = null;
  if (done) actions = <NextButton onClick={() => onDone(resultOf(state))} />;
  else if (state.status === 'revealed' && !busy && replay === 'none') {
    actions = <BigButton className="task-main" onClick={showSolution}>Показать решение</BigButton>;
  } else if (state.status === 'playing') {
    actions = <BigButton variant="surface" disabled={!interactive} onClick={onHint}>Подсказка</BigButton>;
  }

  return (
    <Frame
      heading={title}
      caption={sideCaption(orientation)}
      board={
        <Board
          fen={fen}
          orientation={orientation}
          dests={interactive ? legalDests(fen) : NO_DESTS}
          lastMove={view ? view.lastMove : state.lastMove}
          highlight={hint.square ? [hint.square] : []}
          arrows={view?.arrows ?? (hint.move ? [squares(hint.move)] : [])}
          interactive={interactive}
          onMove={onMove}
        />
      }
      body={
        <>
          {state.status === 'solved' && <Verdict ok>Верно</Verdict>}
          {feedback === 'wrong' && <Verdict ok={false}>Не тот ход</Verdict>}
          {feedback === 'wrongReply' && <Verdict ok={false}>Не тот ход. Соперник ответит так</Verdict>}
        </>
      }
      actions={actions}
    />
  );
}

function ExplainTask({ step, title, onDone }: { step: ExplainStep; title: string; onDone(r: TaskResult): void }) {
  const [played, setPlayed] = useState<string | null>(null);
  /** После неверной попытки нужный ход показан стрелкой, и его можно сыграть кнопкой. */
  const [missed, setMissed] = useState(false);
  const fen = played ? playOn(step.fen, played).fen : step.fen;
  const interactive = step.move !== undefined && played === null;
  const expected = interactive && missed ? [squares(step.move!)] : null;

  function onMove(uci: string) {
    if (!interactive) return;
    // Другой ход не меняет fen, и доска сама возвращает фигуру.
    if (uci === step.move) setPlayed(uci);
    else setMissed(true);
  }

  let actions: ReactNode = <NextButton onClick={() => onDone('clean')} />;
  if (interactive) {
    actions = missed
      ? <BigButton className="task-main" onClick={() => setPlayed(step.move!)}>Показать ход</BigButton>
      : null;
  }

  return (
    <Frame
      heading={title}
      caption={step.move ? sideCaption(turnOfFen(step.fen)) : undefined}
      board={
        <Board
          fen={fen}
          orientation={turnOfFen(step.fen)}
          dests={interactive ? legalDests(fen) : NO_DESTS}
          lastMove={played ? squares(played) : null}
          arrows={played ? [] : expected ?? step.arrows ?? []}
          interactive={interactive}
          onMove={onMove}
        />
      }
      body={
        <>
          <p className="task-text">{step.text}</p>
          {expected && <Verdict ok={false}>Не тот ход. Нужный ход показан стрелкой</Verdict>}
        </>
      }
      actions={actions}
    />
  );
}

function AuthoredTaskView({ task, onDone }: { task: AuthoredTask; onDone(r: TaskResult): void }) {
  const [answer, setAnswer] = useState<{ uci: string; ok: boolean } | null>(null);
  const side = turnOfFen(task.fen);
  const interactive = answer === null;
  const fen = answer?.ok ? playOn(task.fen, answer.uci).fen : task.fen;

  return (
    <Frame
      heading={task.prompt}
      caption={sideCaption(side)}
      board={
        <Board
          fen={fen}
          orientation={side}
          dests={interactive ? legalDests(fen) : NO_DESTS}
          lastMove={answer?.ok ? squares(answer.uci) : null}
          // После неверного ответа стрелка показывает верный ход.
          arrows={answer && !answer.ok && task.accept[0] ? [squares(task.accept[0])] : []}
          interactive={interactive}
          onMove={(uci) => { if (interactive) setAnswer({ uci, ok: task.accept.includes(uci) }); }}
        />
      }
      body={answer && (
        <>
          <Verdict ok={answer.ok}>{answer.ok ? 'Верно' : 'Не тот ход'}</Verdict>
          <p className="task-text">{task.explain}</p>
        </>
      )}
      actions={answer && <NextButton onClick={() => onDone(answer.ok ? 'clean' : 'mistake')} />}
    />
  );
}

function ChoiceTask({ q, onDone }: { q: ChoiceQuestion; onDone(r: TaskResult): void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const ok = picked === q.correct;

  return (
    <Frame
      heading={q.prompt}
      board={q.fen && (
        <Board fen={q.fen} orientation={turnOfFen(q.fen)} dests={NO_DESTS} lastMove={null} interactive={false}
          onMove={() => {}} />
      )}
      body={
        <>
          <div className="task-options">
            {q.options.map((option, i) => (
              <BigButton
                key={i}
                variant={picked !== null && i === q.correct ? 'success' : 'surface'}
                className={picked === i && !ok ? 'task-option--wrong' : undefined}
                aria-pressed={picked === i}
                disabled={picked !== null}
                onClick={() => setPicked(i)}
              >
                {option}
              </BigButton>
            ))}
          </div>
          {picked !== null && (
            <>
              <Verdict ok={ok}>{ok ? 'Верно' : 'Неверно'}</Verdict>
              <p className="task-text">{q.explain}</p>
            </>
          )}
        </>
      }
      actions={picked !== null && <NextButton onClick={() => onDone(ok ? 'clean' : 'mistake')} />}
    />
  );
}

/** Одно задание любого вида. Для нового задания монтируй заново (key). */
export function TaskRunner({ task, onDone, title = '', bestReply = engineBestReply }: {
  task: LessonTask; onDone(result: TaskResult): void; title?: string; bestReply?: BestReply;
}) {
  switch (task.kind) {
    case 'puzzle':
      return <PuzzleTask puzzle={task.puzzle} title={title} onDone={onDone} bestReply={bestReply} />;
    case 'explain':
      return <ExplainTask step={task.step} title={title} onDone={onDone} />;
    case 'authored':
      return <AuthoredTaskView task={task.task} onDone={onDone} />;
    case 'choice':
      return <ChoiceTask q={task.q} onDone={onDone} />;
  }
}
