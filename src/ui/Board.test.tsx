import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Settings } from '../domain/types';
import { legalDests } from '../domain/puzzle';
import { Board } from './Board';
import { SettingsProvider, useSettings } from './settings';

// jsdom не создаёт «доверенных» событий, а chessground по умолчанию принимает только их.
// Обёртка над настоящим chessground включает trustAllEvents и выключает анимацию
// (в jsdom часы requestAnimationFrame расходятся с performance.now, и анимация «улетает»).
// Остальное поведение не меняется.
const cg = vi.hoisted(() => ({ animation: false, apis: [] as Array<{ getFen(): string; state: { animation: { current?: unknown } } }> }));
vi.mock('chessground', async (importOriginal) => {
  const real = await importOriginal<typeof import('chessground')>();
  return {
    ...real,
    Chessground: (el: HTMLElement, config: Parameters<typeof real.Chessground>[1]) => {
      const api = real.Chessground(el, { ...config, trustAllEvents: true, animation: { enabled: cg.animation } });
      cg.apis.push(api);
      return api;
    },
  };
});

const repo = vi.hoisted(() => ({
  getSettings: vi.fn(async (): Promise<Settings> => ({ board: 'night', pieceSet: 'maestro' })),
  saveSettings: vi.fn(async (_s: Settings) => {}),
}));
vi.mock('../data/repo', () => repo);

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SIZE = 400;

beforeEach(() => {
  // jsdom не считает раскладку: доска «размером» 400×400 в левом верхнем углу.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: SIZE, height: SIZE, right: SIZE, bottom: SIZE, toJSON: () => ({}),
  } as DOMRect);
  repo.getSettings.mockClear();
  repo.saveSettings.mockClear();
});

afterEach(() => {
  cg.animation = false;
  cg.apis.length = 0;
  vi.restoreAllMocks();
});

/** Центр клетки при ориентации «белые снизу». */
function center(square: string) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return { clientX: file * (SIZE / 8) + SIZE / 16, clientY: (8 - rank) * (SIZE / 8) + SIZE / 16 };
}

/** chessground сообщает о ходе через setTimeout, поэтому после касаний ждём. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

function tap(square: string) {
  const board = document.querySelector('cg-board')!;
  act(() => {
    fireEvent.mouseDown(board, center(square));
    fireEvent.mouseUp(document, center(square));
  });
}

/** Клетки, на которых стоят фигуры (по сдвигу, который ставит chessground). Фигуры в движении не считаются. */
function pieceSquares(name: string): string[] {
  const step = SIZE / 8;
  return Array.from(document.querySelectorAll<HTMLElement>(`cg-board piece.${name.replace(' ', '.')}`))
    .filter((el) => !el.classList.contains('ghost') && !el.classList.contains('anim'))
    .flatMap((el) => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
      if (!m || Number(m[1]) % step !== 0 || Number(m[2]) % step !== 0) return [];
      return ['abcdefgh'[Number(m[1]) / step] + (8 - Number(m[2]) / step)];
    });
}

describe('Board: ходы', () => {
  it('ход «фигура, потом клетка» передаётся в onMove в UCI без буквы превращения', async () => {
    const onMove = vi.fn();
    render(<Board fen={START} orientation="white" dests={legalDests(START)} lastMove={null} interactive onMove={onMove} />);
    tap('e2');
    tap('e4');
    await settle();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('e2e4');
  });

  it('ход только на клетку из dests', async () => {
    const onMove = vi.fn();
    render(<Board fen={START} orientation="white" dests={legalDests(START)} lastMove={null} interactive onMove={onMove} />);
    tap('e2');
    tap('e5');
    await settle();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('при interactive={false} onMove не вызывается', async () => {
    const onMove = vi.fn();
    render(<Board fen={START} orientation="white" dests={legalDests(START)} lastMove={null} interactive={false} onMove={onMove} />);
    tap('e2');
    tap('e4');
    await settle();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('если родитель не меняет fen, фигура возвращается на место', async () => {
    const onMove = vi.fn();
    render(<Board fen={START} orientation="white" dests={legalDests(START)} lastMove={null} interactive onMove={onMove} />);
    tap('e2');
    tap('e4');
    await settle();
    expect(onMove).toHaveBeenCalledWith('e2e4');
    await waitFor(() => {
      const pawns = pieceSquares('white pawn');
      expect(pawns).toContain('e2');
      expect(pawns).not.toContain('e4');
    });
  });

  it('превращение: выбор фигуры добавляет букву к ходу', async () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    const onMove = vi.fn();
    render(<Board fen={fen} orientation="white" dests={legalDests(fen)} lastMove={null} interactive onMove={onMove} />);
    tap('a7');
    tap('a8');
    await settle();
    expect(onMove).not.toHaveBeenCalled();
    const knight = await screen.findByRole('button', { name: 'Конь' });
    expect(knight.querySelector('img')!.getAttribute('src')).toBe('./pieces/maestro/wN.svg');
    fireEvent.click(screen.getByRole('button', { name: 'Ферзь' }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('a7a8q');
    expect(screen.queryByRole('button', { name: 'Ферзь' })).toBeNull();
  });

  it('превращение: отказ от выбора отменяет ход', async () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    const onMove = vi.fn();
    render(<Board fen={fen} orientation="white" dests={legalDests(fen)} lastMove={null} interactive onMove={onMove} />);
    tap('a7');
    tap('a8');
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));
    await settle();
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Ферзь' })).toBeNull();
    await waitFor(() => expect(pieceSquares('white pawn')).toEqual(['a7']));
  });
});

describe('Board: первая отрисовка', () => {
  const MID = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4';
  const position = (fen: string) => fen.split(' ')[0];

  it('при монтировании позиция сразу заданная, без анимации из начальной расстановки', () => {
    cg.animation = true; // здесь анимацию не отключаем
    render(<Board fen={MID} orientation="black" dests={new Map()} lastMove={null} interactive={false} onMove={() => {}} />);
    const api = cg.apis[0];
    expect(position(api.getFen())).toBe(position(MID));
    expect(api.state.animation.current).toBeUndefined();
  });

  it('последующая смена fen по-прежнему анимируется', () => {
    cg.animation = true;
    const { rerender } = render(
      <Board fen={START} orientation="white" dests={new Map()} lastMove={null} interactive={false} onMove={() => {}} />,
    );
    expect(cg.apis[0].state.animation.current).toBeUndefined();
    rerender(<Board fen={MID} orientation="white" dests={new Map()} lastMove={null} interactive={false} onMove={() => {}} />);
    expect(position(cg.apis[0].getFen())).toBe(position(MID));
    expect(cg.apis[0].state.animation.current).toBeDefined();
  });
});

describe('Board: оформление', () => {
  function Switcher() {
    const { setSettings } = useSettings();
    return <button onClick={() => setSettings({ board: 'green', pieceSet: 'cburnett' })}>сменить</button>;
  }

  it('смена настроек доски и фигур меняет CSS-переменные и адреса картинок фигур', async () => {
    render(
      <SettingsProvider>
        <Switcher />
        <Board fen={START} orientation="white" dests={new Map()} lastMove={null} interactive={false} onMove={() => {}} />
      </SettingsProvider>,
    );
    await waitFor(() => expect(repo.getSettings).toHaveBeenCalled());
    const style = () => document.querySelector('style[data-board-theme]')!.textContent!;
    const boardEl = document.querySelector('cg-board')!;

    expect(style()).toContain('--board-light: #AEBCCB');
    expect(style()).toContain('--board-dark: #4E657E');
    expect(style()).toContain('url("./pieces/maestro/wN.svg")');
    expect(boardEl.closest('.board')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'сменить' }));

    expect(style()).toContain('--board-light: #EBECD0');
    expect(style()).toContain('--board-dark: #739552');
    expect(style()).toContain('url("./pieces/cburnett/wN.svg")');
    expect(style()).not.toContain('/maestro/');
    // та же доска, без перемонтирования
    expect(document.querySelector('cg-board')).toBe(boardEl);
    expect(repo.saveSettings).toHaveBeenCalledWith({ board: 'green', pieceSet: 'cburnett' });
  });
});
