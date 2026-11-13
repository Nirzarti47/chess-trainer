import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BOARDS } from '../content/boards';
import { PIECE_SETS, pieceUrl } from '../content/pieceSets';
import { Board } from '../ui/Board';
import { useSettings } from '../ui/settings';
import './AppearanceScreen.css';

// Позиция из макета mockups/boards.html: чёрные только что вывели слона на c5.
const PREVIEW_FEN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5';
const PREVIEW_LAST_MOVE: [string, string] = ['f8', 'c5'];
const TILE_PIECES = ['wK', 'wN', 'bQ', 'bP'];

/** Экран «Оформление»: выбор цвета доски и набора фигур с живым предпросмотром. */
export function AppearanceScreen() {
  const { settings, setSettings } = useSettings();
  const noDests = useMemo(() => new Map<string, string[]>(), []);

  return (
    <section className="appearance">
      <header className="appearance-head">
        <Link to="/profile" className="appearance-back" aria-label="Назад в профиль">
          ‹
        </Link>
        <h1>Оформление</h1>
      </header>

      <div className="appearance-preview">
        <Board
          fen={PREVIEW_FEN}
          orientation="white"
          dests={noDests}
          lastMove={PREVIEW_LAST_MOVE}
          interactive={false}
          onMove={() => {}}
        />
      </div>

      <h2>Цвет доски</h2>
      <div className="appearance-grid">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            className="appearance-opt"
            aria-pressed={settings.board === b.id}
            onClick={() => setSettings({ ...settings, board: b.id })}
          >
            <span className="appearance-swatch" aria-hidden="true">
              <i style={{ background: b.light }} />
              <i style={{ background: b.dark }} />
              <i style={{ background: b.hiLight }} />
              <i style={{ background: b.dark }} />
            </span>
            <b>{b.name}</b>
          </button>
        ))}
      </div>

      <h2>Фигуры</h2>
      <div className="appearance-grid">
        {PIECE_SETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="appearance-opt"
            aria-pressed={settings.pieceSet === p.id}
            onClick={() => setSettings({ ...settings, pieceSet: p.id })}
          >
            <span className="appearance-pieces" aria-hidden="true">
              {TILE_PIECES.map((code) => (
                <img key={code} alt="" src={pieceUrl(p.id, code)} />
              ))}
            </span>
            <b>{p.name}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
