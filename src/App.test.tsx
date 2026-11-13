import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('показывает три вкладки', () => {
    render(<App />);
    const nav = screen.getByRole('navigation');
    expect(nav.textContent).toContain('Учёба');
    expect(nav.textContent).toContain('Задачи');
    expect(nav.textContent).toContain('Профиль');
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('открывает экран задач по нажатию на вкладку', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('heading', { name: 'Задачи' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Задачи' }));
    expect(screen.getByRole('heading', { name: 'Задачи' })).toBeTruthy();
    expect(window.location.hash).toBe('#/puzzles');
  });

  it('на экране урока вкладки скрыты', () => {
    window.location.hash = '#/lesson/fork/0';
    render(<App />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
