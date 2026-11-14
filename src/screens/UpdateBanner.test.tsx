import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateBanner } from './UpdateBanner';

const pwa = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn(() => Promise.resolve()),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [pwa.needRefresh, () => undefined],
    offlineReady: [false, () => undefined],
    updateServiceWorker: pwa.updateServiceWorker,
  }),
}));

describe('UpdateBanner', () => {
  beforeEach(() => pwa.updateServiceWorker.mockClear());

  it('ничего не показывает, пока новой версии нет', () => {
    pwa.needRefresh = false;
    const { container } = render(<UpdateBanner />);
    expect(container.textContent).toBe('');
  });

  it('когда новая версия ждёт, «Обновить» включает её', async () => {
    pwa.needRefresh = true;
    render(<UpdateBanner />);
    expect(screen.getByText('Доступна новая версия')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(pwa.updateServiceWorker).toHaveBeenCalledWith(true);
  });
});
