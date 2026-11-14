/// <reference types="vite-plugin-pwa/react" />
import { useRegisterSW } from 'virtual:pwa-register/react';
import './offline.css';

/**
 * Регистрирует сервис-воркер и, когда готова новая версия, показывает полосу «Доступна новая версия».
 * «Обновить» включает новый сервис-воркер и перезагружает страницу; прогресс в IndexedDB не трогается.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div className="top-note" role="status">
      <p>Доступна новая версия</p>
      <button type="button" className="top-note-action" onClick={() => void updateServiceWorker(true)}>
        Обновить
      </button>
    </div>
  );
}
