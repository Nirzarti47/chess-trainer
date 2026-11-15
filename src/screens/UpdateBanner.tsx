/// <reference types="vite-plugin-pwa/react" />
import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './offline.css';

/**
 * Регистрирует сервис-воркер и, когда готова новая версия, показывает полосу «Доступна новая версия».
 * «Обновить» включает новый сервис-воркер и перезагружает страницу; прогресс в IndexedDB не трогается.
 * iPhone подолгу держит приложение в фоне, поэтому новая версия проверяется и при возвращении в приложение.
 */
export function UpdateBanner() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [hidden, setHidden] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      registration.current = r;
    },
  });

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      registration.current?.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  if (!needRefresh || hidden) return null;
  return (
    <div className="top-note" role="status">
      <p>Доступна новая версия</p>
      <button type="button" className="top-note-action" onClick={() => void updateServiceWorker(true)}>
        Обновить
      </button>
      {/* Скрыть до следующего запуска: полоса закрывает верх экрана урока. */}
      <button type="button" className="top-note-close" aria-label="Закрыть" onClick={() => setHidden(true)}>
        ×
      </button>
    </div>
  );
}
