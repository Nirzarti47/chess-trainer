import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawBrushes, DrawShape } from 'chessground/draw';
import type { Color, Key } from 'chessground/types';
import type { Grade, Mark } from '../domain/gameTypes';
import 'chessground/assets/chessground.base.css';
import { pieceUrl } from '../content/pieceSets';
import { useSettings } from './settings';
import './board.css';

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  /** Допустимые ходы: поле фигуры → поля назначения (см. legalDests). */
  dests: Map<string, string[]>;
  lastMove: [string, string] | null;
  /** Клетки-подсказки. */
  highlight?: string[];
  /** Пара полей — жёлтая стрелка-подсказка; в разборе: 'best' — зелёная, 'alt' — голубая. */
  arrows?: BoardArrow[];
  /** 'bad' — сыгранный ход подсвечен красноватым (ошибка в разборе). */
  lastMoveTone?: 'normal' | 'bad';
  /** Значок оценки хода в углу поля. */
  badge?: { square: string; text: string; tone: Grade | Mark };
  interactive: boolean;
  /** Ход пользователя в UCI; при превращении с буквой фигуры: 'e7e8q'. */
  onMove(uci: string): void;
}

export type BoardArrow = [string, string] | { from: string; to: string; tone: 'best' | 'alt' };

interface PendingPromotion {
  orig: string;
  dest: string;
  color: Color;
}

const PROMOTION_CHOICES = [
  { letter: 'q', code: 'Q', label: 'Ферзь' },
  { letter: 'r', code: 'R', label: 'Ладья' },
  { letter: 'b', code: 'B', label: 'Слон' },
  { letter: 'n', code: 'N', label: 'Конь' },
] as const;

function turnOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function isDarkSquare(square: string): boolean {
  return (square.charCodeAt(0) - 97 + Number(square[1])) % 2 === 1;
}

function squareClasses(lastMove: [string, string] | null, highlight: string[], bad = false): Map<Key, string> {
  const classes = new Map<Key, string>();
  const add = (square: string, cls: string) => {
    const prev = classes.get(square as Key);
    classes.set(square as Key, prev ? `${prev} ${cls}` : cls);
  };
  for (const sq of lastMove ?? []) add(sq, bad ? 'hi-bad' : isDarkSquare(sq) ? 'hi-dark' : 'hi-light');
  for (const sq of highlight) add(sq, 'hint');
  return classes;
}

function toShape(a: BoardArrow): DrawShape {
  return Array.isArray(a)
    ? { orig: a[0] as Key, dest: a[1] as Key, brush: 'hint' }
    : { orig: a.from as Key, dest: a.to as Key, brush: a.tone };
}

/** Левый верхний угол поля в процентах доски с учётом поворота. */
function squarePosition(square: string, orientation: 'white' | 'black') {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return { left: `${col * 12.5}%`, top: `${row * 12.5}%` };
}

/** Шахматная доска на chessground. Позицию задаёт только fen: ход пользователя уходит в onMove,
 *  а если родитель не сменил fen (неверный ход), доска возвращает прежнюю позицию. */
export function Board({
  fen, orientation, dests, lastMove, highlight = [], arrows = [], lastMoveTone = 'normal', badge, interactive, onMove,
}: BoardProps) {
  const { settings } = useSettings();
  const elRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);
  // Увеличивается после каждого хода пользователя, чтобы заново выставить позицию из fen.
  const [moveCount, setMoveCount] = useState(0);

  // Актуальные свойства для первой конфигурации chessground (читаются при создании доски).
  const propsRef = useRef({ fen, orientation, dests, lastMove, highlight, arrows, lastMoveTone, interactive });

  useLayoutEffect(() => {
    onMoveRef.current = onMove;
    propsRef.current = { fen, orientation, dests, lastMove, highlight, arrows, lastMoveTone, interactive };
  });

  const finishMove = useCallback((uci: string) => {
    onMoveRef.current(uci);
    setMoveCount((n) => n + 1);
  }, []);

  useEffect(() => {
    // Начальную позицию отдаём конструктору: иначе первый set() анимировал бы фигуры из стартовой расстановки.
    const init = propsRef.current;
    const turn = turnOf(init.fen);
    const api = Chessground(elRef.current!, {
      fen: init.fen,
      orientation: init.orientation,
      turnColor: turn,
      coordinates: true,
      highlight: {
        lastMove: false, check: false, custom: squareClasses(init.lastMove, init.highlight, init.lastMoveTone === 'bad'),
      },
      movable: {
        color: init.interactive ? turn : undefined,
        dests: init.interactive ? (init.dests as Map<Key, Key[]>) : new Map(),
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const piece = apiRef.current?.state.pieces.get(dest);
            if (piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) {
              setPromotion({ orig, dest, color: piece.color });
            } else {
              finishMove(orig + dest);
            }
          },
        },
      },
      premovable: { enabled: false },
      drawable: {
        enabled: false,
        visible: true,
        // chessground сливает эту кисть со своими стандартными, поэтому остальные указывать не нужно.
        brushes: {
          hint: { key: 'hint', color: '#F0B243', opacity: 0.85, lineWidth: 10 },
          best: { key: 'best', color: '#63C29A', opacity: 0.9, lineWidth: 10 },
          alt: { key: 'alt', color: '#5AA9D6', opacity: 0.9, lineWidth: 10 },
        } as unknown as DrawBrushes,
        autoShapes: init.arrows.map(toShape),
      },
    });
    apiRef.current = api;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, [finishMove]);

  // Ключи-строки, чтобы новые массивы с тем же содержимым не перерисовывали доску посреди хода.
  const destsKey = Array.from(dests, ([from, to]) => from + to.join('')).join(',');
  const lastMoveKey = lastMove?.join('') ?? '';
  const highlightKey = highlight.join(',');
  const arrowsKey = arrows.map((a) => (Array.isArray(a) ? a.join('') : a.from + a.to + a.tone)).join(',');

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const turn = turnOf(fen);
    api.set({
      fen,
      orientation,
      turnColor: turn,
      movable: {
        color: interactive ? turn : undefined,
        dests: interactive ? (dests as Map<Key, Key[]>) : new Map(),
      },
      highlight: { custom: squareClasses(lastMove, highlight, lastMoveTone === 'bad') },
    });
    api.setAutoShapes(arrows.map(toShape));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, destsKey, lastMoveKey, lastMoveTone, highlightKey, arrowsKey, interactive, moveCount]);

  const choose = (letter: string) => {
    if (!promotion) return;
    setPromotion(null);
    finishMove(promotion.orig + promotion.dest + letter);
  };

  const cancelPromotion = () => {
    setPromotion(null);
    setMoveCount((n) => n + 1);
  };

  return (
    <div className="board">
      <div ref={elRef} className="board-cg" />
      {badge && (
        <div className="board-layer">
          <span
            className={`board-badge board-badge--${badge.tone}`}
            data-square={badge.square}
            style={squarePosition(badge.square, orientation)}
          >
            {badge.text}
          </span>
        </div>
      )}
      {promotion && (
        <div className="board-promotion">
          <button type="button" className="board-promotion-backdrop" aria-label="Отмена" onClick={cancelPromotion} />
          <div className="board-promotion-choices">
            {PROMOTION_CHOICES.map((c) => (
              <button key={c.letter} type="button" aria-label={c.label} onClick={() => choose(c.letter)}>
                <img alt="" src={pieceUrl(settings.pieceSet, promotion.color[0] + c.code)} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
