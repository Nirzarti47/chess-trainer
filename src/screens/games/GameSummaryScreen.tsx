import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { loadBookPlies } from '../../analysis/openings';
import { CATEGORY_TITLE, KIND_ADVICE, KIND_TITLE } from '../../analysis/phrases';
import { CATEGORY_ORDER, reportOf, type GameReport } from '../../analysis/report';
import { getCurrentAnalysis, getGame, getGamePuzzles } from '../../data/gamesRepo';
import type { GameAnalysis, GameRecord, MistakeKind } from '../../domain/gameTypes';
import { gamesQueue, useGamesState } from '../../games/gamesStore';
import { BigButton } from '../../ui/BigButton';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { ProgressBar } from '../../ui/ProgressBar';
import { describeError } from '../lessonErrors';
import { formatDate, RESULT } from './GamesScreen';
import './GameSummaryScreen.css';

type Phase =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'dbError'; text: string }
  | { kind: 'running'; game: GameRecord }
  /** text — сбой разбора, запомненный в момент ответа open. */
  | { kind: 'failed'; game: GameRecord; text: string }
  | { kind: 'ready'; game: GameRecord; analysis: GameAnalysis; report: GameReport; puzzleCount: number };

/** Когда очередь не назвала причину сбоя. */
const FAILED_FALLBACK = 'Попробуй ещё раз чуть позже';

/** Точность с одним знаком после запятой; у стороны без ходов — «—». */
const formatAccuracy = (a: number | null): string => (a === null ? '—' : a.toFixed(1));

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
  // Пришли из задачи через устаревший разбор: номер хода (?ply=) ведём дальше в разбор.
  const ply = useSearchParams()[0].get('ply');
  const plyQuery = ply === null ? '' : `?ply=${encodeURIComponent(ply)}`;

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
          // lastError у очереди общий: берём его сейчас, позже он может смениться из-за другой партии.
          setPhase({ kind: 'failed', game, text: gamesQueue.status().lastError || FAILED_FALLBACK });
          return;
        }
      }
      const puzzleCount = (await getGamePuzzles(gameId)).length;
      // Книга дебютов грузится один раз за сеанс; при сбое она пустая — теоретических ходов тогда нет.
      const report = reportOf(analysis, await loadBookPlies(game.moves));
      if (alive) setPhase({ kind: 'ready', game, analysis, report, puzzleCount });
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
        <BigButton variant="surface" onClick={() => navigate('/games')}>К партиям</BigButton>
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
    // Очередь может считать другую партию: её прогресс здесь не показываем.
    const { running } = state.queue;
    const mine = running?.gameId === game.id ? running : null;
    return (
      <section className="summary">
        {header}
        <ProgressBar value={mine && mine.total > 0 ? mine.done / mine.total : 0} label="Ход разбора" />
        <p className="summary-note" role="status">Разбираю партию…</p>
      </section>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <section className="summary">
        {header}
        <h2>Не удалось разобрать партию</h2>
        <p className="summary-note">{phase.text}</p>
        <BigButton variant="surface" onClick={() => setAttempt((n) => n + 1)}>Повторить</BigButton>
      </section>
    );
  }

  const { analysis, report, puzzleCount } = phase;
  const ownerIsWhite = game.userColor === 'white';
  const names = ownerIsWhite ? ['Ты', game.opponent] : [game.opponent, 'Ты'];
  const ownerSide = report[game.userColor];
  const advice = topKinds(game, analysis);
  const hasMistakes = ownerSide.counts.mistake + ownerSide.counts.miss + ownerSide.counts.blunder > 0;

  return (
    <section className="summary">
      {header}
      <div className="summary-names">
        {names.map((n, i) => <span key={i} className="summary-name">{n}</span>)}
      </div>
      <div className="summary-accuracy-row">
        <span className="summary-row-title">Точность</span>
        <span className="summary-accuracy summary-accuracy--white">{formatAccuracy(report.white.accuracy)}</span>
        <span className="summary-accuracy summary-accuracy--black">{formatAccuracy(report.black.accuracy)}</span>
      </div>
      <ul className="summary-rows">
        {CATEGORY_ORDER.map((c) => (
          <li key={c} className="summary-row" style={{ '--row-color': `var(--cat-${c})` } as CSSProperties}>
            <span className="summary-row-title">{CATEGORY_TITLE[c]}</span>
            <span className="summary-row-num">{report.white.counts[c]}</span>
            <CategoryIcon category={c} size={30} />
            <span className="summary-row-num">{report.black.counts[c]}</span>
          </li>
        ))}
      </ul>
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
      {puzzleCount === 0 && hasMistakes && (
        <p className="summary-took">Задач из этой партии нет: ни в одной ошибке не нашлось одного ясно лучшего хода</p>
      )}
      <div className="summary-actions">
        <BigButton onClick={() => navigate(`/games/${game.id}/review${plyQuery}`)}>Смотреть разбор</BigButton>
        {puzzleCount > 0 && (
          <BigButton variant="surface" onClick={() => navigate(`/games/${game.id}/fix`)}>
            {`Исправить ошибки (${puzzleCount})`}
          </BigButton>
        )}
      </div>
    </section>
  );
}
