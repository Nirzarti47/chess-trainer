import { Link } from 'react-router-dom';
import { PIECE_SETS } from '../content/pieceSets';
import './ProfileScreen.css';

/** Адрес репозитория с кодом приложения. Пока репозитория нет, ссылка не показывается. */
export const REPO_URL = '';

const CREDITS: { what: string; name: string; license: string }[] = [
  { what: 'Доска', name: 'chessground', license: 'GPL-3.0' },
  { what: 'Правила', name: 'chess.js', license: 'BSD-2-Clause' },
  { what: 'Движок', name: 'Stockfish', license: 'GPL-3.0' },
  { what: 'Задачи', name: 'база задач Lichess', license: 'CC0' },
  { what: 'Шрифт', name: 'Golos Text', license: 'SIL Open Font License' },
];

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
