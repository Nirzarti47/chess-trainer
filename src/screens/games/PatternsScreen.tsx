import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CONFIG } from '../../analysis/config';
import { countKinds, gamesInRange, RANGE_OPTIONS, tooFew } from '../../analysis/patterns';
import { KIND_TITLE } from '../../analysis/phrases';
import { getAnalyses, getGames, getPatternRange, setPatternRange } from '../../data/gamesRepo';
import type { GameAnalysis, GameRecord, RangeChoice } from '../../domain/gameTypes';
import { gamesQueue, useGamesState } from '../../games/gamesStore';
import { BigButton } from '../../ui/BigButton';
import { describeError } from '../lessonErrors';
import './PatternsScreen.css';

type Data = { games: GameRecord[]; analyses: GameAnalysis[] };

const sameRange = (a: RangeChoice, b: RangeChoice) => JSON.stringify(a) === JSON.stringify(b);

const GROUPS: { label: string; by: RangeChoice['by'] }[] = [
  { label: 'По числу партий', by: 'count' },
  { label: 'По времени', by: 'time' },
];

/** «Частые ошибки»: виды ошибок владельца за выбранный промежуток и тренировка на самые частые. */
export function PatternsScreen() {
  const navigate = useNavigate();
  const { revision } = useGamesState();
  const [range, setRange] = useState<RangeChoice | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Партии и разборы перечитываются, когда растёт revision.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [r, games, analyses] = await Promise.all([getPatternRange(), getGames(), getAnalyses()]);
      if (!alive) return;
      setRange((prev) => prev ?? r);
      setData({ games, analyses });
      setFailed(null);
    })().catch((e: unknown) => {
      console.error('Не удалось прочитать партии', e);
      if (alive) setFailed(describeError(e));
    });
    return () => { alive = false; };
  }, [revision, attempt]);

  const view = useMemo(() => {
    if (!range || !data) return null;
    const games = gamesInRange(data.games, range, Date.now());
    const current = new Set(data.analyses.filter((a) => a.rulesVersion === CONFIG.RULES_VERSION).map((a) => a.gameId));
    const pending = games.filter((g) => !current.has(g.id)).map((g) => g.id);
    // «Другое» всегда последней строкой, сколько бы его ни было
    const all = countKinds(games, data.analyses);
    const counts = [...all.filter((c) => c.kind !== 'other'), ...all.filter((c) => c.kind === 'other')];
    return { total: games.length, analysed: games.length - pending.length, pending, counts,
      mistakes: counts.reduce((s, c) => s + c.count, 0) };
  }, [range, data]);

  // Очередь сначала разбирает партии выбранного промежутка, от новых к старым.
  const pendingKey = view?.pending.join(',');
  useEffect(() => {
    if (pendingKey !== undefined) gamesQueue.setRange(pendingKey ? pendingKey.split(',') : []);
  }, [pendingKey]);

  function choose(r: RangeChoice) {
    setRange(r);
    setPatternRange(r).catch((e: unknown) => console.error('Не удалось сохранить промежуток', e));
  }

  const header = (
    <header className="patterns-head">
      <Link to="/games" className="patterns-back" aria-label="Назад к партиям">‹</Link>
      <h1>Частые ошибки</h1>
    </header>
  );

  if (failed) {
    return (
      <section className="patterns">
        {header}
        <h2>Не удалось посчитать ошибки</h2>
        <p className="patterns-note">{failed}</p>
        <BigButton variant="surface" onClick={() => setAttempt((n) => n + 1)}>Повторить</BigButton>
      </section>
    );
  }
  if (!range || !view) return <section className="patterns" aria-busy="true">{header}</section>;

  const top = Math.max(0, ...view.counts.map((c) => c.count));
  return (
    <section className="patterns">
      {header}
      {GROUPS.map((g) => (
        <div key={g.by} className="patterns-group" role="group" aria-labelledby={`patterns-${g.by}`}>
          <h2 id={`patterns-${g.by}`}>{g.label}</h2>
          <div className="patterns-options">
            {RANGE_OPTIONS.filter((o) => o.choice.by === g.by).map((o) => (
              <button key={o.label} type="button" className="patterns-option"
                aria-pressed={sameRange(o.choice, range)} onClick={() => choose(o.choice)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="patterns-status">
        <p role="status">Партий: {view.total}, разобрано: {view.analysed}{view.analysed < view.total && ' — считаю дальше'}</p>
        {view.total > 0 && tooFew(view.analysed, view.mistakes) && <p>Мало партий, выводы неточные</p>}
      </div>

      {view.total === 0 && <p className="patterns-empty">За этот промежуток партий нет</p>}
      {view.total > 0 && view.analysed > 0 && view.counts.length === 0 && (
        <p className="patterns-empty">Ошибок не найдено</p>
      )}
      {view.counts.length > 0 && (
        <ul className="patterns-list" aria-label="Виды ошибок">
          {view.counts.map(({ kind, count }) => (
            <li key={kind}>
              <span className="patterns-kind">{KIND_TITLE[kind]}</span>
              <b>{count}</b>
              <span className="patterns-bar" aria-hidden="true">
                <i style={{ width: `${(count / top) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="patterns-actions">
        <BigButton disabled={view.analysed === 0} onClick={() => navigate('/games/patterns/train')}>Тренировать</BigButton>
      </div>
    </section>
  );
}
