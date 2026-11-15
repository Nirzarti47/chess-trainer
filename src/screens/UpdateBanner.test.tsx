import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateBanner } from './UpdateBanner';

const pwa = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (opts?: { onRegisteredSW?(url: string, r: unknown): void }) => {
    opts?.onRegisteredSW?.('./sw.js', { update: pwa.update });
    return {
    needRefresh: [pwa.needRefresh, () => undefined],
    offlineReady: [false, () => undefined],
    updateServiceWorker: pwa.updateServiceWorker,
    };
  },
}));

describe('UpdateBanner', () => {
  beforeEach(() => {
    pwa.updateServiceWorker.mockClear();
    pwa.update.mockClear();
  });

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

  it('«×» скрывает полосу', async () => {
    pwa.needRefresh = true;
    render(<UpdateBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByText('Доступна новая версия')).toBeNull();
  });

  it('при возвращении в приложение проверяет новую версию', () => {
    pwa.needRefresh = false;
    render(<UpdateBanner />);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
    expect(pwa.update).toHaveBeenCalledTimes(1);
  });
});
