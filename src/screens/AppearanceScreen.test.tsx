import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Settings } from '../domain/types';
import { SettingsProvider } from '../ui/settings';
import { AppearanceScreen } from './AppearanceScreen';

const repo = vi.hoisted(() => ({
  getSettings: vi.fn(async (): Promise<Settings> => ({ board: 'night', pieceSet: 'maestro' })),
  saveSettings: vi.fn(async (_s: Settings) => {}),
}));
vi.mock('../data/repo', () => repo);

function renderScreen() {
  render(
    <SettingsProvider>
      <MemoryRouter>
        <AppearanceScreen />
      </MemoryRouter>
    </SettingsProvider>,
  );
}

describe('AppearanceScreen', () => {
  beforeEach(() => repo.saveSettings.mockClear());

  it('показывает 8 досок и 8 наборов, по умолчанию выбраны «Ночная» и «Изящные»', async () => {
    renderScreen();
    await waitFor(() => expect(repo.getSettings).toHaveBeenCalled());
    const pressed = screen.getAllByRole('button', { pressed: true }).map((b) => b.textContent);
    expect(pressed).toEqual(['Ночная', 'Изящные']);
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(14);
  });

  it('выбор плитки сразу сохраняется и отмечается', async () => {
    renderScreen();
    await waitFor(() => expect(repo.getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Песочная' }));
    expect(repo.saveSettings).toHaveBeenLastCalledWith({ board: 'sand', pieceSet: 'maestro' });
    fireEvent.click(screen.getByRole('button', { name: 'Строгие' }));
    expect(repo.saveSettings).toHaveBeenLastCalledWith({ board: 'sand', pieceSet: 'gioco' });
    expect(screen.getByRole('button', { name: 'Песочная' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Строгие' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ночная' }).getAttribute('aria-pressed')).toBe('false');
  });
});
