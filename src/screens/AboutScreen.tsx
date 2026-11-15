import { Link } from 'react-router-dom';
import { PIECE_SETS } from '../content/pieceSets';
import './ProfileScreen.css';

/** Адрес репозитория с кодом приложения. Пока репозитория нет, ссылка не показывается. */
export const REPO_URL = 'https://github.com/Nirzarti47/chess-trainer';

const CREDITS: { what: string; name: string; license: string }[] = [
  { what: 'Доска', name: 'chessground', license: 'GPL-3.0' },
  { what: 'Правила', name: 'chess.js', license: 'BSD-2-Clause' },
  { what: 'Движок', name: 'Stockfish', license: 'GPL-3.0' },
  { what: 'Задачи', name: 'база задач Lichess', license: 'CC0' },
  { what: 'Шрифт', name: 'Golos Text', license: 'SIL Open Font License' },
];

/** Короткий номер коммита, из которого собрана выкладка; при сборке на компьютере — dev. */
const BUILD_COMMIT = (import.meta.env.VITE_BUILD_COMMIT as string | undefined)?.slice(0, 7) || 'dev';

/** «15.11.2026, 14:20» по часам устройства. */
function formatBuildTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Экран «О приложении»: что это и чьи работы в нём использованы. */
export function AboutScreen() {
  return (
    <section className="profile">
      <header className="sub-head">
        <Link to="/profile" className="sub-back" aria-label="Назад в профиль">‹</Link>
        <h1>О приложении</h1>
      </header>

      <p className="profile-text profile-pad">
        Тренажёр шахматной тактики: уроки по темам, задачи и повторение трудных мест. Работает без сети,
        прогресс хранится на этом устройстве.
      </p>

      <p className="profile-text profile-pad">
        Версия от {formatBuildTime(__BUILD_TIME__)} (сборка {BUILD_COMMIT})
      </p>

      <h2>Фигуры</h2>
      <ul className="profile-credits">
        {PIECE_SETS.map((p) => (
          <li key={p.id}><b>{p.name}</b><span>{p.author}, {p.license}</span></li>
        ))}
      </ul>

      <h2>Что ещё внутри</h2>
      <ul className="profile-credits">
        {CREDITS.map((c) => (
          <li key={c.name}><b>{c.what}</b><span>{c.name}, {c.license}</span></li>
        ))}
      </ul>

      <p className="profile-text profile-pad">Код приложения открыт под лицензией GPL-3.0</p>
      {REPO_URL && (
        <p className="profile-pad">
          <a className="profile-link" href={REPO_URL} target="_blank" rel="noreferrer">Код в репозитории</a>
        </p>
      )}
    </section>
  );
}
