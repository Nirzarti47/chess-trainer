import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatScore } from '../../analysis/score';
import { getCurrentAnalysis, getGame } from '../../data/gamesRepo';
import type { GameAnalysis, GameRecord } from '../../domain/gameTypes';
import { legalDests } from '../../domain/puzzle';
import { analysisEngine, type AnalysisEngine } from '../../engine/analysisEngine';
import { BigButton } from '../../ui/BigButton';
import { Board, type BoardArrow, type BoardProps } from '../../ui/Board';
import { describeError } from '../lessonErrors';
import { EvalBar } from './EvalBar';
import { GameChart } from './GameChart';
import { RESULT } from './GamesScreen';
import { MoveCard, ruMove } from './MoveCard';
import { alternatives, badgeText, buildPlyViews, chartPoints, moverOf, nextUserMistake, type PlyView } from './reviewModel';
import { useExplore, type ExploreState } from './useExplore';
import './ReviewScreen.css';

type Phase =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'dbError'; text: string }
  | { kind: 'ready'; game: GameRecord; analysis: GameAnalysis };

type Engine = Pick<AnalysisEngine, 'analyse'>;

/** Номер позиции из ?ply=N (позиция после хода N), прижатый к допустимым. */
function startIndex(param: string | null, count: number): number {
  const n = Number(param);
  if (param === null || param.trim() === '' || !Number.isFinite(n)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(n) + 1));
}

/** Оформление доски для позиции разбора: подсветка хода, значок, стрелки лучшего хода и выбранного варианта. */
function boardDecor(view: PlyView, alt: string | null): Pick<BoardProps, 'lastMove' | 'lastMoveTone' | 'badge' | 'arrows'> {
  const r = view.review;
  if (!r) return { lastMove: null, lastMoveTone: 'normal', badge: undefined, arrows: [] };
  const arrow = (uci: string, tone: 'best' | 'alt'): BoardArrow => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), tone });
  const arrows: BoardArrow[] = [];
  if (alt) arrows.push(arrow(alt, 'alt'));
  const best = r.best[0]?.move;
  if (best && best !== r.move && best !== alt) arrows.push(arrow(best, 'best'));
  const text = badgeText(r);
  return {
    lastMove: view.lastMove,
    lastMoveTone: r.grade === 'mistake' || r.grade === 'blunder' ? 'bad' : 'normal',
    badge: text && view.lastMove ? { square: view.lastMove[1], text, tone: r.mark ?? r.grade } : undefined,
    arrows,
  };
}

/** Карточка «Свой вариант»: оценка движка для позиции варианта и его лучший ход. */
function ExploreCard({ explore }: { explore: ExploreState }) {
  const { score, best } = explore;
  let body: ReactNode;
  if (explore.thinking) body = <p className="explore-card-note">Считаю…</p>;
  else if (explore.failed) body = <p className="explore-card-note">Движок не ответил</p>;
  else if (score && 'over' in score) body = <p className="explore-card-end">{score.over === 'draw' ? 'Пат' : 'Мат'}</p>;
  else {
    body = (
      <>
        {score && <p className="explore-card-score">{formatScore(score)}</p>}
        {best && <p>Лучший ход: {ruMove(explore.fen, best.move)}</p>}
      </>
    );
  }
  return (
    <div className="move-card explore-card" data-testid="explore-card">
      <p className="move-card-head">
        <span className="move-card-grade explore-card-tag">Свой вариант</span>
      </p>
      {body}
    </div>
  );
}

/** Разбор партии: доска со шкалой, карточка хода, график и переходы по ходам; можно пробовать свои ходы. */
export function ReviewScreen({ engine = analysisEngine }: { engine?: Engine }) {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
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
      const analysis = await getCurrentAnalysis(gameId);
      if (!alive) return;
      // Разбора нет или он устарел: сводка сама запустит разбор.
      if (!analysis) navigate('/games/' + gameId, { replace: true });
      else setPhase({ kind: 'ready', game, analysis });
    })().catch((e: unknown) => {
      console.error('Не удалось открыть разбор', e);
      if (alive) setPhase({ kind: 'dbError', text: describeError(e) });
    });
    return () => { alive = false; };
  }, [gameId, attempt, navigate]);

  if (phase.kind === 'loading') return <section className="review" aria-busy="true" />;

  if (phase.kind === 'notFound') {
    return (
      <section className="review review--message">
        <h1>Партия не найдена</h1>
        <BigButton variant="surface" onClick={() => navigate('/games')}>К партиям</BigButton>
      </section>
    );
  }

  if (phase.kind === 'dbError') {
    return (
      <section className="review review--message">
        <h1>Не удалось открыть разбор</h1>
        <p className="review-note">{phase.text}</p>
        <BigButton variant="surface" onClick={() => setAttempt((n) => n + 1)}>Повторить</BigButton>
      </section>
    );
  }

  return <Review key={phase.game.id} game={phase.game} analysis={phase.analysis} engine={engine} />;
}

function Review({ game, analysis, engine }: { game: GameRecord; analysis: GameAnalysis; engine: Engine }) {
  const [params] = useSearchParams();
  const views = useMemo(() => buildPlyViews(game, analysis), [game, analysis]);
  const points = useMemo(() => chartPoints(analysis), [analysis]);
  // Текущая позиция — единственное состояние перемотки; адрес при перемотке не меняется.
  const [index, setIndex] = useState(() => startIndex(params.get('ply'), views.length));
  const [chosen, setChosen] = useState<number | null>(null);
  // «Свой вариант»: пока он открыт, позиция и карточка партии не меняются.
  const explore = useExplore(engine);

  const go = (i: number) => {
    if (explore.active) return;
    setIndex(i);
    setChosen(null);
  };

  const view = views[index];
  const alts = view.review ? alternatives(view.review, moverOf(view.review.ply)) : [];
  const alt = chosen !== null ? alts[chosen]?.move ?? null : null;
  const nextMistake = nextUserMistake(analysis, game.userColor, index);
  const fen = explore.active ? explore.fen : view.fen;
  const dests = useMemo(() => legalDests(fen), [fen]);
  const onMove = (uci: string) => {
    if (explore.active) explore.move(uci);
    else explore.start(view.fen, uci);
  };
  const best = explore.best?.move;
  const decor: Pick<BoardProps, 'lastMove' | 'lastMoveTone' | 'badge' | 'arrows'> = explore.active
    ? {
      lastMove: explore.lastMove, lastMoveTone: 'normal', badge: undefined,
      arrows: best ? [{ from: best.slice(0, 2), to: best.slice(2, 4), tone: 'best' }] : [],
    }
    : boardDecor(view, alt);

  return (
    <section className={explore.active ? 'review review--explore' : 'review'}>
      <header className="review-head">
        <Link to={`/games/${game.id}`} className="review-back">‹ Партии</Link>
        <b className="review-title">Ты — {game.opponent} · {RESULT[game.result]}</b>
      </header>
      <div className="review-board">
        <EvalBar score={explore.score ?? view.score} bottom={game.userColor} />
        <div className="review-board-main">
          <Board
            fen={fen}
            orientation={game.userColor}
            dests={dests}
            interactive={dests.size > 0}
            autoQueen
            onMove={onMove}
            {...decor}
          />
        </div>
      </div>
      {explore.active ? (
        <ExploreCard explore={explore} />
      ) : (
        <MoveCard
          view={view}
          beforeFen={index > 0 ? views[index - 1].fen : null}
          alts={alts}
          chosen={chosen}
          onChoose={setChosen}
        />
      )}
      <GameChart points={points} reviews={analysis.moves} userColor={game.userColor} current={index} onSelect={go} />
      {explore.active ? (
        <div className="review-actions">
          <BigButton variant="surface" onClick={explore.back}>Шаг назад</BigButton>
          <BigButton className="review-main" onClick={explore.exit}>Вернуться к партии</BigButton>
        </div>
      ) : (
        <div className="review-actions">
          <BigButton variant="surface" aria-label="Предыдущий ход" disabled={index === 0} onClick={() => go(index - 1)}>◀</BigButton>
          <BigButton className="review-main" disabled={nextMistake === null} onClick={() => nextMistake !== null && go(nextMistake)}>
            Следующая ошибка
          </BigButton>
          <BigButton
            variant="surface"
            aria-label="Следующий ход"
            disabled={index === views.length - 1}
            onClick={() => go(index + 1)}
          >
            ▶
          </BigButton>
        </div>
      )}
    </section>
  );
}
