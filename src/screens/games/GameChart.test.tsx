import { fireEvent, render, screen } from '@testing-library/react';
import type { MoveReview, Side } from '../../domain/gameTypes';
import { GameChart } from './GameChart';

const review = (ply: number, over: Partial<MoveReview> = {}): MoveReview =>
  ({ ply, move: 'e2e4', loss: 0, grade: 'good', best: [], deep: false, ...over });

const points = Array.from({ length: 9 }, () => 0.5);
const WIDTH = 400;

function chart(reviews: MoveReview[], userColor: Side = 'white', onSelect = vi.fn(), current = 3) {
  const view = render(<GameChart points={points} reviews={reviews} userColor={userColor} current={current} onSelect={onSelect} />);
  return { ...view, onSelect };
}
const dots = () => Array.from(document.querySelectorAll<HTMLElement>('.game-chart-dot'));

describe('GameChart: точки', () => {
  it('только на ходах владельца и только для заметных оценок', () => {
    chart([
      review(0, { grade: 'mistake' }), // ход владельца: точка
      review(1, { grade: 'blunder' }), // ход соперника: точки нет
      review(2, { grade: 'good', mark: 'great' }), // владелец, отметка: точка
      review(4, { grade: 'good' }), // владелец, обычный ход: точки нет
      review(6, { grade: 'best', mark: 'brilliant' }), // владелец: точка
      review(3, { grade: 'inaccuracy' }), // соперник и не заметная
    ]);
    expect(dots().map((d) => d.style.left)).toEqual(['12.5%', '37.5%', '87.5%']);
  });

  it('владелец чёрными — точки на его ходах', () => {
    chart([review(0, { grade: 'blunder' }), review(1, { grade: 'blunder' }), review(5, { grade: 'mistake' })], 'black');
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
