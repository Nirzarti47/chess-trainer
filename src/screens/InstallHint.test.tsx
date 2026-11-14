import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { INSTALL_HINT_KEY, InstallHint } from './InstallHint';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';
const HINT = 'Нажми „Поделиться“, затем „На экран Домой“';

function setBrowser(userAgent: string, standalone: boolean | undefined) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent });
  Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => standalone });
}

describe('InstallHint', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'userAgent');
    Reflect.deleteProperty(navigator, 'standalone');
  });

  it('в Safari на iPhone показывается один раз и закрывается', async () => {
    setBrowser(IPHONE_UA, false);
    const { unmount } = render(<InstallHint />);
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe('1');
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByText(HINT)).toBeNull();
    unmount();

    render(<InstallHint />);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('с домашнего экрана и в других браузерах не показывается', () => {
    setBrowser(IPHONE_UA, true);
    const { unmount } = render(<InstallHint />);
    expect(screen.queryByText(HINT)).toBeNull();
    unmount();

    setBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', undefined);
    render(<InstallHint />);
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
