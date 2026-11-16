import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('показывает четыре вкладки', () => {
    render(<App />);
    const nav = screen.getByRole('navigation');
    expect(nav.textContent).toContain('Учёба');
    expect(nav.textContent).toContain('Задачи');
    expect(nav.textContent).toContain('Партии');
    expect(nav.textContent).toContain('Профиль');
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('вкладка «Учёба» показывает путь обучения', async () => {
    render(<App />);
    expect(window.location.hash).toBe('#/learn');
    expect(await screen.findByRole('heading', { name: 'Круг 1. Первые удары' })).toBeTruthy();
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

  it('на экране разбора партии вкладки скрыты, на сводке — видны', () => {
    window.location.hash = '#/games/g1/review';
    const { unmount } = render(<App />);
    expect(screen.queryByRole('navigation')).toBeNull();
    unmount();
    window.location.hash = '#/games/g1';
    render(<App />);
    expect(screen.getByRole('navigation')).toBeTruthy();
  });

  it('/games/patterns — экран «Частые ошибки», а не сводка партии; на тренировке вкладки скрыты', async () => {
    window.location.hash = '#/games/patterns';
    const { unmount } = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Частые ошибки' })).toBeTruthy();
    expect(screen.queryByText('Партия не найдена')).toBeNull();
    expect(screen.getByRole('navigation')).toBeTruthy();
    unmount();
    window.location.hash = '#/games/patterns/train';
    render(<App />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
