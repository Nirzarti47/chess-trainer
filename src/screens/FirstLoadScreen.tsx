import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BigButton } from '../ui/BigButton';
import { ProgressBar } from '../ui/ProgressBar';
import './offline.css';

/** Отметка в localStorage: всё нужное для работы без сети уже сохранено. */
export const OFFLINE_READY_KEY = 'offline-ready';

/** Файлы, без которых приложение без сети не работает: задачи и движок. */
export const REQUIRED_FILES = [
  './puzzles/c1.json',
  './puzzles/c2.json',
  './puzzles/c3.json',
  './engine/stockfish-19-lite-single.js',
  './engine/stockfish-19-lite-single.wasm',
];

const POLL_MS = 300;
const DONE_PAUSE_MS = 1200;
/** Кэши, в которые Workbox складывает предзагрузку. */
const PRECACHE_PREFIX = 'workbox-precache';

type Phase = 'loading' | 'offline' | 'done' | 'app';

function readFlag(): boolean {
  try {
    return localStorage.getItem(OFFLINE_READY_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFlag() {
  try {
    localStorage.setItem(OFFLINE_READY_KEY, '1');
  } catch {
    // без localStorage экран просто покажется снова при следующем запуске
  }
}

/** Сервис-воркер управляет страницей и все обязательные файлы лежат в Cache Storage. */
export async function isOfflineReady(): Promise<boolean> {
  const sw = navigator.serviceWorker;
  if (!sw.controller) return false;
  const registration = await sw.getRegistration();
  if (!registration?.active || typeof caches === 'undefined') return false;
  // Workbox хранит файлы без хэша в имени с параметром __WB_REVISION__, поэтому ignoreSearch.
  const found = await Promise.all(REQUIRED_FILES.map((file) => caches.match(file, { ignoreSearch: true })));
  return found.every(Boolean);
}

/** Число записей предзагрузки в манифесте, вписанном в sw.js; null, если его не разобрать. */
async function fetchExpectedCount(): Promise<number | null> {
  try {
    const response = await fetch('./sw.js', { cache: 'no-store' });
    if (!response.ok) return null;
    const count = (await response.text()).match(/\brevision:/g)?.length ?? 0;
    return count > 0 ? count : null;
  } catch {
    return null;
  }
}

/** Доля уже сохранённых записей предзагрузки. */
async function precachedShare(expected: number): Promise<number> {
  let stored = 0;
  for (const name of await caches.keys()) {
    if (name.startsWith(PRECACHE_PREFIX)) stored += (await (await caches.open(name)).keys()).length;
  }
  return Math.min(stored / expected, 1);
}

type FirstLoadScreenProps = {
  children: ReactNode;
  /** Пропустить экран: при разработке и в тестах сервис-воркера нет. */
  skip?: boolean;
};

/**
 * При первом запуске держит экран загрузки, пока сервис-воркер не сохранит задачи, движок и оболочку.
 * Дальше приложение открывается сразу, в том числе без сети.
 */
export function FirstLoadScreen({ children, skip = import.meta.env.DEV }: FirstLoadScreenProps) {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const [phase, setPhase] = useState<Phase>(() => {
    if (skip || !supported || (readFlag() && navigator.serviceWorker.controller)) return 'app';
    return navigator.onLine ? 'loading' : 'offline';
  });
  /** Доля сохранённого; null — измерить нельзя, полоска без процентов. */
  const [progress, setProgress] = useState<number | null>(null);
  const [noteHidden, setNoteHidden] = useState(false);

  const waiting = phase === 'loading' || phase === 'offline';

  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expected: Promise<number | null> | undefined;

    const tick = async () => {
      try {
        if (await isOfflineReady()) {
          if (stopped) return;
          writeFlag();
          setProgress(1);
          setPhase('done');
          return;
        }
        expected ??= fetchExpectedCount();
        const total = await expected;
        const share = total ? await precachedShare(total) : null;
        if (stopped) return;
        setProgress(share);
        setPhase(navigator.onLine ? 'loading' : 'offline');
      } catch {
        // Cache Storage недоступен на мгновение — проверим в следующий раз
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    const onNetwork = () => setPhase(navigator.onLine ? 'loading' : 'offline');
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
    };
  }, [waiting]);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(() => setPhase('app'), DONE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const retry = useCallback(async () => {
    if (!navigator.onLine) return;
    setPhase('loading');
    // Если установка сорвалась, регистрации нет — тогда загрузить страницу заново.
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) await registration.update().catch(() => undefined);
    else window.location.reload();
  }, []);

  if (phase === 'app') {
    return (
      <>
        {!supported && !skip && !noteHidden && (
          <div className="top-note" role="status">
            <p>Этот браузер не умеет работать без сети</p>
            <button type="button" className="top-note-close" aria-label="Закрыть" onClick={() => setNoteHidden(true)}>
              ×
            </button>
          </div>
        )}
        {children}
      </>
    );
  }

  return (
    <section className="first-load">
      <h1>Шахматный тренажёр</h1>
      {phase === 'done' && <p className="first-load-text">Готово. Дальше интернет не нужен</p>}
      {phase === 'loading' && <p className="first-load-text">Загружаю задачи и доску. Это один раз, лучше по Wi-Fi</p>}
      {phase === 'offline' && <p className="first-load-text">Нужен интернет для первой загрузки</p>}
      {phase !== 'offline' &&
        (progress === null ? (
          <div className="progress-bar progress-bar--indeterminate" role="progressbar" aria-label="Загрузка">
            <i />
          </div>
        ) : (
          <ProgressBar value={progress} label="Загрузка" />
        ))}
      {phase === 'offline' && <BigButton onClick={() => void retry()}>Повторить</BigButton>}
    </section>
  );
}
