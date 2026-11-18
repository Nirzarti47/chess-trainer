import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { loadBookPlies } from '../../analysis/openings';
import { categorize, type Category } from '../../analysis/report';
import { formatScore } from '../../analysis/score';
import { getCurrentAnalysis, getGame } from '../../data/gamesRepo';
import type { GameAnalysis, GameRecord, Score } from '../../domain/gameTypes';
import { legalDests } from '../../domain/puzzle';
import { analysisEngine, type AnalysisEngine } from '../../engine/analysisEngine';
import { BigButton } from '../../ui/BigButton';
import { Board, type BoardArrow, type BoardProps } from '../../ui/Board';
import { describeError } from '../lessonErrors';
import { EvalBar } from './EvalBar';
import { GameChart } from './GameChart';
import { RESULT } from './GamesScreen';
import { MoveCard, ruMove } from './MoveCard';
import {
  alternatives, BAD_CATEGORIES, bestArrowVisible, buildPlyViews, chartPoints, moverOf, nextUserMistake, type PlyView,
} from './reviewModel';
import { useExplore, type ExploreState } from './useExplore';
import './ReviewScreen.css';

type Phase =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'dbError'; text: string }
  /** bookPlies — сколько первых полуходов партии теоретические (для видов ходов). */
  | { kind: 'ready'; game: GameRecord; analysis: GameAnalysis; bookPlies: number };

type Engine = Pick<AnalysisEngine, 'analyse'>;

/** Номер позиции из ?ply=N (позиция после хода N), прижатый к допустимым. */
function startIndex(param: string | null, count: number): number {
  const n = Number(param);
  if (param === null || param.trim() === '' || !Number.isFinite(n)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(n) + 1));
}

type Decor = Pick<BoardProps, 'lastMove' | 'lastMoveTone' | 'badge' | 'arrows'>;

const arrow = (uci: string, tone: 'best' | 'alt'): BoardArrow => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), tone });

/** Оформление доски для позиции после хода: подсветка хода, значок, стрелка лучшего хода (если она не из пустого поля). */
function boardDecor(view: PlyView, beforeFen: string | null): Decor {
  const r = view.review;
  if (!r || !view.category) return { lastMove: null, lastMoveTone: 'normal', badge: undefined, arrows: [] };
  const arrows: BoardArrow[] = [];
  const best = r.best[0]?.move;
  if (best && best !== r.move && beforeFen && bestArrowVisible(beforeFen, view.fen, best)) arrows.push(arrow(best, 'best'));
  return {
    lastMove: view.lastMove,
    lastMoveTone: BAD_CATEGORIES.has(view.category) ? 'bad' : 'normal',
    badge: view.lastMove ? { square: view.lastMove[1], category: view.category } : undefined,
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
  const ply = useSearchParams()[0].get('ply');
  /** Номер хода (?ply=) уходит со сводкой, если разбор устарел. */
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
      const analysis = await getCurrentAnalysis(gameId);
      if (!alive) return;
      // Разбора нет или он устарел: сводка сама запустит разбор.
      if (!analysis) navigate(`/games/${gameId}${plyQuery}`, { replace: true });
      else {
        // Книга дебютов грузится один раз за сеанс; при сбое она пустая — теоретических ходов тогда нет.
        const bookPlies = await loadBookPlies(game.moves);
        if (alive) setPhase({ kind: 'ready', game, analysis, bookPlies });
      }
    })().catch((e: unknown) => {
      console.error('Не удалось открыть разбор', e);
      if (alive) setPhase({ kind: 'dbError', text: describeError(e) });
    });
    return () => { alive = false; };
  }, [gameId, attempt, navigate, plyQuery]);

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

  return <Review key={phase.game.id} game={phase.game} analysis={phase.analysis} bookPlies={phase.bookPlies} engine={engine} />;
}

interface Prepared { views: PlyView[]; categories: Category[] }

/** Позиции партии и виды ходов; null — данные испорчены (недопустимый ход, число оценок не сходится с числом ходов,
 *  оценки не читаются). */
function prepare(game: GameRecord, analysis: GameAnalysis, bookPlies: number): Prepared | null {
  if (analysis.scores.length !== game.moves.length + 1) return null;
  try {
    const categories = categorize(analysis, bookPlies);
    return { views: buildPlyViews(game, analysis, categories), categories };
  } catch (e) {
    console.error('Не удалось построить позиции партии', e);
    return null;
  }
}

function Review({ game, analysis, bookPlies, engine }: { game: GameRecord; analysis: GameAnalysis; bookPlies: number; engine: Engine }) {
  const navigate = useNavigate();
  const prepared = useMemo(() => prepare(game, analysis, bookPlies), [game, analysis, bookPlies]);
  if (!prepared) {
    return (
      <section className="review review--message">
        <h1>Не удалось показать разбор этой партии</h1>
        <BigButton variant="surface" onClick={() => navigate(`/games/${game.id}`)}>К партии</BigButton>
      </section>
    );
  }
  return <ReviewBody game={game} analysis={analysis} views={prepared.views} categories={prepared.categories} engine={engine} />;
}

interface ReviewBodyProps { game: GameRecord; analysis: GameAnalysis; views: PlyView[]; categories: Category[]; engine: Engine }

function ReviewBody({ game, analysis, views, categories, engine }: ReviewBodyProps) {
  const [params] = useSearchParams();
  const points = useMemo(() => chartPoints(analysis), [analysis]);
  // Текущая позиция — единственное состояние перемотки; адрес при перемотке не меняется.
  const [index, setIndex] = useState(() => startIndex(params.get('ply'), views.length));
  // Выбранный вариант «Лучше было»: пока он выбран, доска показывает позицию ДО хода.
  const [chosen, setChosen] = useState<number | null>(null);
  // Оценка позиции, с которой начат «Свой вариант», — шкала держит её, пока движок считает.
  const [startScore, setStartScore] = useState<Score | null>(null);
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
  const beforeView = index > 0 ? views[index - 1] : null;
  // Показ варианта: позиция до хода с одной стрелкой.
  const variant = !explore.active && alt !== null && beforeView !== null ? { alt, before: beforeView } : null;
  const nextMistake = nextUserMistake(categories, game.userColor, index);
  const fen = explore.active ? explore.fen : variant ? variant.before.fen : view.fen;
  const dests = useMemo(() => legalDests(fen), [fen]);
  const onMove = (uci: string) => {
    if (explore.active) {
      explore.move(uci);
      return;
    }
    const base = variant ? variant.before : view;
    setStartScore(base.score);
    setChosen(null);
    explore.start(base.fen, uci);
  };
  const best = explore.best?.move;
  let decor: Decor;
  if (explore.active) {
    decor = {
      lastMove: explore.lastMove, lastMoveTone: 'normal', badge: undefined,
      arrows: best ? [arrow(best, 'best')] : [],
    };
  } else if (variant) {
    decor = { lastMove: null, lastMoveTone: 'normal', badge: undefined, arrows: [arrow(variant.alt, 'alt')] };
  } else {
    decor = boardDecor(view, beforeView?.fen ?? null);
  }

  return (
    <section className={explore.active ? 'review review--explore' : 'review'}>
      <header className="review-head">
        <Link to={`/games/${game.id}`} className="review-back">‹ Партии</Link>
        <b className="review-title">Ты — {game.opponent} · {RESULT[game.result]}</b>
      </header>
      <div className="review-board">
        <EvalBar score={explore.active ? explore.score ?? startScore ?? view.score : view.score} bottom={game.userColor} />
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
          beforeFen={beforeView?.fen ?? null}
          alts={alts}
          chosen={chosen}
          onChoose={setChosen}
        />
      )}
      <GameChart points={points} categories={categories} userColor={game.userColor} current={index} onSelect={go} />
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
