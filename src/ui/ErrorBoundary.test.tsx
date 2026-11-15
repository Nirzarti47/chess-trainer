import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

const state = vi.hoisted(() => ({ broken: true }));

function Fragile() {
  if (state.broken) throw new Error('сломалось');
  return <p>Всё хорошо</p>;
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ошибка отрисовки: «Что-то пошло не так», «На главную» ведёт на учёбу и рисует заново', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.location.hash = '#/lesson/c1:fork/0';
    state.broken = true;
    render(<ErrorBoundary><Fragile /></ErrorBoundary>);
    expect(screen.getByText('Что-то пошло не так')).toBeTruthy();

    state.broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'На главную' }));
    expect(window.location.hash).toBe('#/learn');
    expect(screen.getByText('Всё хорошо')).toBeTruthy();
  });
});
