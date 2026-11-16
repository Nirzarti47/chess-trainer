import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CONFIG } from '../../analysis/config';
import { getAnalyses, getChessUser, getGames } from '../../data/gamesRepo';
import type { ChessUser, GameAnalysis, GameRecord, TimeClass } from '../../domain/gameTypes';
import { syncNow, useGamesState } from '../../games/gamesStore';
import { BigButton } from '../../ui/BigButton';
import { NickForm } from './NickForm';
import './GamesScreen.css';

const RESULT: Record<GameRecord['result'], string> = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' };
const KIND: Record<TimeClass, string> = { rapid: 'Рапид', blitz: 'Блиц', bullet: 'Пуля', daily: 'По переписке' };

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Ошибки владельца (ошибка и грубая ошибка); null — разбора нет или он старой версии. */
function mistakeCount(game: GameRecord, a: GameAnalysis | undefined): number | null {
  if (!a || a.rulesVersion !== CONFIG.RULES_VERSION) return null;
  const { grades } = a[game.userColor];
  return grades.mistake + grades.blunder;
}

function GameRow({ game, mistakes }: { game: GameRecord; mistakes: number | null }) {
  const navigate = useNavigate();
  const side = game.userColor === 'white' ? 'Белые' : 'Чёрные';
  return (
    <li>
      <button type="button" className="games-row" onClick={() => navigate('/games/' + game.id)}>
        <span className={`games-color games-color--${game.userColor}`} role="img" aria-label={side} />
        <span className="games-row-main">
          <b>{game.opponent} <span className="games-rating">{game.opponentRating}</span></b>
          <span className="games-row-sub">
            {formatDate(game.endTime)} · {KIND[game.timeClass]}
          </span>
        </span>
        <span className="games-row-side">
          <span className={`games-result games-result--${game.result}`}>{RESULT[game.result]}</span>
          {mistakes !== null && <span className="games-row-sub">Ошибок: {mistakes}</span>}
        </span>
      </button>
    </li>
  );
}

export interface GamesScreenProps {
  fetchPlayer?: (nick: string) => Promise<void>;
  sync?: () => Promise<void>;
}

/** Вкладка «Партии»: подключение ника, состояние загрузки и разбора, список партий. */
export function GamesScreen({ fetchPlayer, sync = syncNow }: GamesScreenProps) {
  const state = useGamesState();
  const [user, setUser] = useState<ChessUser | null | undefined>(undefined);
  const [games, setGames] = useState<GameRecord[] | null>(null);
  const [analyses, setAnalyses] = useState<Map<string, GameAnalysis>>(new Map());
  const [failed, setFailed] = useState<string | null>(null);

  // Список перечитывается из базы, когда растёт revision.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [u, g, a] = await Promise.all([getChessUser(), getGames(), getAnalyses()]);
      if (!alive) return;
      setUser(u);
      setGames([...g].sort((x, y) => y.endTime - x.endTime));
      setAnalyses(new Map(a.map((x) => [x.gameId, x])));
      setFailed(null);
    })().catch((e: unknown) => {
      console.error('Не удалось прочитать партии', e);
      if (alive) setFailed('Не удалось открыть список партий');
    });
    return () => { alive = false; };
  }, [state.revision]);

  async function reloadUser() {
    try {
      setUser(await getChessUser());
    } catch (e: unknown) {
      // Экран остаётся в прежнем состоянии.
      console.error('Не удалось прочитать ник', e);
    }
  }

  if (failed) {
    return (
      <section className="games"><h1>Партии</h1><p className="games-note">{failed}</p></section>
    );
  }
  if (user === undefined) return <section className="games" aria-busy="true" />;

  if (!user) {
    return (
      <section className="games">
        <h1>Партии</h1>
        <p className="games-note">Подключи Chess.com, и я найду ошибки в твоих партиях и сделаю из них задачи.</p>
        <NickForm fetchPlayer={fetchPlayer} sync={sync} onSaved={() => void reloadUser()} />
      </section>
    );
  }

  const loading = state.sync === 'loading';
  const { queue } = state;
  let status: string;
  if (loading) {
    status = state.syncProgress
      ? `Загружаю партии: ${state.syncProgress.done} из ${state.syncProgress.total}` : 'Загружаю партии…';
  } else if (state.sync === 'offline') status = 'Нет сети, список не обновлён';
  else if (state.sync === 'error') status = state.syncError ?? 'Не удалось загрузить партии';
  else if (queue.running) status = 'Идёт разбор…';
  else status = `Разобрано ${queue.analysed} из ${queue.total}`;

  return (
    <section className="games">
      <h1>Партии</h1>
      <Link to="/games/patterns" className="games-patterns">
        Частые ошибки<span aria-hidden="true">›</span>
      </Link>
      <div className="games-status">
        <p role="status">{status}</p>
        {state.sync === 'error' && <BigButton variant="surface" onClick={() => void sync()}>Повторить</BigButton>}
      </div>
      <BigButton variant="surface" disabled={loading} onClick={() => void sync()}>Обновить</BigButton>
      {games && games.length === 0 && !loading && <p className="games-note">Партий пока нет</p>}
      {games && games.length > 0 && (
        <ul className="games-list" aria-label="Партии">
          {games.map((g) => <GameRow key={g.id} game={g} mistakes={mistakeCount(g, analyses.get(g.id))} />)}
        </ul>
      )}
    </section>
  );
}
 
