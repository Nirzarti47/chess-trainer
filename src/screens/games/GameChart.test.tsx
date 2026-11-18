import { fireEvent, render, screen } from '@testing-library/react';
import type { Category } from '../../analysis/report';
import type { Side } from '../../domain/gameTypes';
import { GameChart } from './GameChart';

const points = Array.from({ length: 9 }, () => 0.5);
const WIDTH = 400;

function chart(categories: Category[], userColor: Side = 'white', onSelect = vi.fn(), current = 3) {
  const view = render(<GameChart points={points} categories={categories} userColor={userColor} current={current} onSelect={onSelect} />);
  return { ...view, onSelect };
}
const dots = () => Array.from(document.querySelectorAll<HTMLElement>('.game-chart-dot'));

describe('GameChart: точки', () => {
  it('только на ходах владельца и только для заметных видов', () => {
    chart([
      'mistake', // ход 0, владелец: точка
      'blunder', // ход 1, соперник: точки нет
      'great', // ход 2, владелец: точка
      'miss', // ход 3, соперник
      'excellent', // ход 4, владелец, обычный ход: точки нет
      'good', // ход 5
      'brilliant', // ход 6, владелец: точка
      'blunder', // ход 7, соперник
    ]);
    expect(dots().map((d) => d.style.left)).toEqual(['12.5%', '37.5%', '87.5%']);
  });

  it('упущенная возможность владельца — точка цветом вида, отличный ход — без точки', () => {
    chart(['miss', 'good', 'excellent']);
    expect(dots().map((d) => [d.style.left, d.style.background])).toEqual([['12.5%', 'var(--cat-miss)']]);
  });

  it('владелец чёрными — точки на его ходах', () => {
    chart(['blunder', 'blunder', 'good', 'good', 'good', 'mistake'], 'black');
    expect(dots().map((d) => d.style.left)).toEqual(['25%', '75%']);
  });
});

describe('GameChart: нажатие', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: WIDTH, height: 100, right: WIDTH, bottom: 100, toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => vi.restoreAllMocks());

  const press = (clientX: number) => fireEvent.pointerDown(screen.getByRole('slider'), { clientX, pointerId: 1 });

  it('середина выбирает позицию 4 из 9', () => {
    const { onSelect } = chart([]);
    press(WIDTH / 2);
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('левый край — 0, правый — последняя позиция', () => {
    const { onSelect } = chart([]);
    press(0);
    expect(onSelect).toHaveBeenLastCalledWith(0);
    press(WIDTH);
    expect(onSelect).toHaveBeenLastCalledWith(8);
  });
});
