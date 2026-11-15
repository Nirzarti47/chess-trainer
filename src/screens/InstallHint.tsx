import { useEffect, useState } from 'react';
import './offline.css';

/** Отметка в localStorage: подсказку уже показывали. */
export const INSTALL_HINT_KEY = 'install-hint-shown';

/** Safari на iPhone или iPad, открытый не с домашнего экрана. */
export function isIosBrowserTab(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return /iPhone|iPad|iPod/.test(nav.userAgent) && nav.standalone === false;
}

function alreadyShown(): boolean {
  try {
    return Boolean(localStorage.getItem(INSTALL_HINT_KEY));
  } catch {
    return true;
  }
}

/** Один раз подсказывает, как поставить приложение на домашний экран. Ничего не загораживает. */
export function InstallHint() {
  const [visible, setVisible] = useState(() => isIosBrowserTab() && !alreadyShown());

  useEffect(() => {
    if (!visible) return;
    try {
      localStorage.setItem(INSTALL_HINT_KEY, '1');
    } catch {
      // не запомнили — покажем ещё раз, это не мешает
    }
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="top-note" role="status">
      <p>Нажми „Поделиться“, затем „На экран Домой“</p>
      <button type="button" className="top-note-close" aria-label="Закрыть" onClick={() => setVisible(false)}>
        ×
      </button>
    </div>
  );
}
