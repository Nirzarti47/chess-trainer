import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { KIND_ADVICE, KIND_TITLE } from '../../analysis/phrases';
import { getCurrentAnalysis, getGame, getGamePuzzles } from '../../data/gamesRepo';
import type { GameAnalysis, GameRecord, MistakeKind } from '../../domain/gameTypes';
import { gamesQueue, useGamesState } from '../../games/gamesStore';
import { BigButton } from '../../ui/BigButton';
import { ProgressBar } from '../../ui/ProgressBar';
import { describeError } from '../lessonErrors';
import { formatDate, RESULT } from './GamesScreen';
import './GameSummaryScreen.css';

type Phase =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'dbError'; text: string }
  | { kind: 'running'; game: GameRecord }
  | { kind: 'failed'; game: GameRecord }
  | { kind: 'ready'; game: GameRecord; analysis: GameAnalysis; hasPuzzles: boolean };

/** «1 раз», «2 раза», «5 раз». */
function times(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  return last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? `${n} раза` : `${n} раз`;
}

/** Один-два самых частых вида ошибок владельца (кроме «other»); при равенстве — по первой встрече. */
function topKinds(game: GameRecord, analysis: GameAnalysis): Array<[MistakeKind, number]> {
  const ownerParity = game.userColor === 'white' ? 0 : 1;
  const counts = new Map<MistakeKind, number>();
  for (const m of analysis.moves) {
    if (m.ply % 2 !== ownerParity || !m.kind || m.kind === 'other') continue;
    counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  }
  // Сортировка устойчивая: Map хранит порядок первой встречи.
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2);
}

/** Сводка одной партии: числа по ходам, совет и переходы к разбору и задачам. */
export function GameSummaryScreen() {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
  const state = useGamesState();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setPhase({ kind: 'loading' });
      const game = await getGame(gameId);
      if (!alive) return;
      if (!game) {
        setPhase({ kind: 'notFound' });
        return;
      }
      let analysis = await getCurrentAnalysis(gameId);
      if (!analysis) {
        if (!alive) return;
        setPhase({ kind: 'running', game });
        analysis = (await gamesQueue.open(gameId)) ?? undefined;
        if (!alive) return;
        if (!analysis) {
          setPhase({ kind: 'failed', game });
          return;
        }
      }
      const hasPuzzles = (await getGamePuzzles(gameId)).length > 0;
      if (alive) setPhase({ kind: 'ready', game, analysis, hasPuzzles });
    })().catch((e: unknown) => {
      console.error('Не удалось открыть партию', e);
      if (alive) setPhase({ kind: 'dbError', text: describeError(e) });
    });
    return () => { alive = false; };
  }, [gameId, attempt]);

  if (phase.kind === 'loading') return <section className="summary" aria-busy="true" />;

  if (phase.kind === 'notFound') {
    return (
      <section className="summary">
        <h1>Партия не найдена</h1>
        <BigButton variant="surface" onClick={() => navigate('/games')}>К партиям</BigButton>
      </section>
    );
  }

  if (phase.kind === 'dbError') {
    return (
      <section className="summary">
        <h1>Не удалось открыть партию</h1>
        <p className="summary-note">{phase.text}</p>
        <BigButton variant="surface" onClick={() => setAttempt((n) => n + 1)}>Повторить</BigButton>
      </section>
    );
  }

  const { game } = phase;
  const header = (
    <header className="summary-head">
      <Link to="/games" className="summary-back" aria-label="Назад к партиям">‹</Link>
      <div>
        <h1>Ты — {game.opponent}</h1>
        <p className="summary-note">{RESULT[game.result]} · {formatDate(game.endTime)}</p>
      </div>
    </header>
  );

  if (phase.kind === 'running') {
    const { running } = state.queue;
    return (
      <section className="summary">
        {header}
        <ProgressBar value={running && running.total > 0 ? running.done / running.total : 0} label="Разбираю партию…" />
        <p className="summary-note" role="status">Разбираю партию…</p>
      </section>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <section className="summary">
        {header}
        <h2>Не удалось разобрать партию</h2>
        {state.queue.lastError && <p className="summary-note">{state.queue.lastError}</p>}
        <BigButton variant="surface" onClick={() => setAttempt((n) => n + 1)}>Повторить</BigButton>
      </section>
    );
  }

  const { analysis, hasPuzzles } = phase;
  const mine = analysis[game.userColor];
  const theirs = analysis[game.userColor === 'white' ? 'black' : 'white'];
  const rows: Array<[string, number, number]> = [];
  if (mine.brilliant || theirs.brilliant) rows.push(['Блестящие', mine.brilliant, theirs.brilliant]);
  if (mine.great || theirs.great) rows.push(['Сильные', mine.great, theirs.great]);
  rows.push(
    ['Лучшие', mine.grades.best, theirs.grades.best],
    ['Хорошие', mine.grades.good, theirs.grades.good],
    ['Неточности', mine.grades.inaccuracy, theirs.grades.inaccuracy],
    ['Ошибки', mine.grades.mistake, theirs.grades.mistake],
    ['Грубые ошибки', mine.grades.blunder, theirs.grades.blunder],
  );
  const advice = topKinds(game, analysis);

  return (
    <section className="summary">
      {header}
      <table className="summary-table">
        <thead>
          <tr><th scope="col" /><th scope="col">Ты</th><th scope="col">{game.opponent}</th></tr>
        </thead>
        <tbody>
          {rows.map(([title, a, b]) => (
            <tr key={title}><th scope="row">{title}</th><td>{a}</td><td>{b}</td></tr>
          ))}
          <tr><th scope="row">Точность</th><td>{Math.round(mine.accuracy)}%</td><td>{Math.round(theirs.accuracy)}%</td></tr>
        </tbody>
      </table>
      {advice.length > 0 && (
        <div className="summary-advice">
          <h2>Совет</h2>
          <ul>
            {advice.map(([kind, n]) => (
              <li key={kind}>{`${times(n)}: ${KIND_TITLE[kind]}. ${KIND_ADVICE[kind]}`}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="summary-took">Разбор занял {Math.round(analysis.tookMs / 1000)} с</p>
      <div className="summary-actions">
        <BigButton onClick={() => navigate(`/games/${game.id}/review`)}>Смотреть разбор</BigButton>
        {hasPuzzles && (
          <BigButton variant="surface" onClick={() => navigate(`/games/${game.id}/fix`)}>Исправить ошибки</BigButton>
        )}
      </div>
    </section>
  );
}
