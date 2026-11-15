import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BigButton } from '../ui/BigButton';
import { ProgressBar } from '../ui/ProgressBar';
import { isIosBrowserTab } from './InstallHint';
import './offline.css';

/** Отметка в localStorage: всё нужное для работы без сети уже сохранено. */
export const OFFLINE_READY_KEY = 'offline-ready';

/** Файлы, без которых приложение без сети не работает: задачи и движок. */
export const PUZZLE_FILES = ['./puzzles/c1.json', './puzzles/c2.json', './puzzles/c3.json'];
export const REQUIRED_FILES = [
  ...PUZZLE_FILES,
  './engine/stockfish-19-lite-single.js',
  './engine/stockfish-19-lite-single.wasm',
];

const POLL_MS = 300;
const DONE_PAUSE_MS = 1200;
/** Сколько ждать хоть одного нового файла в кеше, прежде чем предложить повторить.
 *  Крупнейший файл задач после сжатия около 1,2 МБ: на 100 кбит/с это ~95 с. */
export const STALL_MS = 90_000;
/** Доля объёма, которая приходится на три файла задач. */
const PUZZLES_SHARE = 0.7;

/** Текст для вкладки Safari на iPhone: у значка на домашнем экране своё хранилище. */
export const IOS_TAB_NOTE = 'Сначала добавь приложение на экран «Домой»: «Поделиться» → «На экран «Домой»». '
  + 'Потом открой его оттуда при интернете. То, что пройдено в Safari, в приложение не перенесётся.';
/** Кэши, в которые Workbox складывает предзагрузку. */
const PRECACHE_PREFIX = 'workbox-precache';

/** stalled — сеть есть, но установка сорвалась или давно не движется. */
type Phase = 'loading' | 'offline' | 'stalled' | 'done' | 'app';

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

/**
 * Сервис-воркер активен и все обязательные файлы лежат в Cache Storage.
 * Управлять именно этой страницей он не обязан: после жёсткой перезагрузки controller пуст,
 * но без сети приложение всё равно откроется при следующем запуске.
 */
export async function isOfflineReady(registration: ServiceWorkerRegistration | undefined): Promise<boolean> {
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

/** Сколько из трёх файлов задач уже в кэше. */
async function countPuzzleFiles(): Promise<number> {
  const found = await Promise.all(PUZZLE_FILES.map((file) => caches.match(file, { ignoreSearch: true })));
  return found.filter(Boolean).length;
}

/**
 * Доля скачанного по объёму: файлы задач — около 70 % байт при трёх записях из ~120,
 * поэтому 0,3 даёт число мелких записей и 0,7 — число файлов задач.
 */
export function loadedShare(stored: number, total: number, puzzles: number): number {
  const big = PUZZLE_FILES.length;
  if (total <= big) return Math.min(stored / total, 1);
  const small = Math.min(Math.max(stored - puzzles, 0) / (total - big), 1);
  return Math.min((1 - PUZZLES_SHARE) * small + PUZZLES_SHARE * (puzzles / big), 1);
}

/** Сколько записей предзагрузки уже сохранено. */
async function countPrecached(): Promise<number> {
  let stored = 0;
  for (const name of await caches.keys()) {
    if (name.startsWith(PRECACHE_PREFIX)) stored += (await (await caches.open(name)).keys()).length;
  }
  return stored;
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
  const [startedReady] = useState(() => supported && !skip && readFlag());
  const [iosTab] = useState(() => typeof navigator !== 'undefined' && isIosBrowserTab());
  const [phase, setPhase] = useState<Phase>(() => {
    if (skip || !supported || (readFlag() && navigator.serviceWorker.controller)) return 'app';
    return navigator.onLine ? 'loading' : 'offline';
  });
  /** Доля сохранённого; null — измерить нельзя, полоска без процентов. */
  const [progress, setProgress] = useState<number | null>(null);
  const [noteHidden, setNoteHidden] = useState(false);
  /** Номер попытки: «Повторить» его увеличивает, и слежение начинается заново. */
  const [attempt, setAttempt] = useState(0);
  /** Число записей из sw.js; запоминается только удачно полученное. */
  const expectedRef = useRef<number | null>(null);

  const waiting = phase === 'loading' || phase === 'offline' || phase === 'stalled';

  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expectedFetched = false;
    /** Установка сорвалась или застряла: дальше только «Повторить». */
    let failed = false;
    let watched: ServiceWorker | null = null;
    let lastStored = -1;
    let lastChange = Date.now();

    const showState = () => setPhase(!navigator.onLine ? 'offline' : failed ? 'stalled' : 'loading');
    const fail = () => {
      if (stopped || failed) return;
      failed = true;
      showState();
    };

    const tick = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (await isOfflineReady(registration)) {
          if (stopped) return;
          writeFlag();
          setProgress(1);
          setPhase(startedReady ? 'app' : 'done');
          return;
        }
        // Воркер, ушедший в redundant, установку не закончит.
        const installing = registration?.installing ?? null;
        if (installing && installing !== watched) {
          watched = installing;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'redundant') fail();
          });
        }
        if (expectedRef.current === null && !expectedFetched) {
          expectedFetched = true;
          expectedRef.current = await fetchExpectedCount();
        }
        const stored = await countPrecached();
        const puzzles = await countPuzzleFiles();
        if (stopped) return;
        if (stored !== lastStored) {
          lastStored = stored;
          lastChange = Date.now();
          // Записи прибавляются — значит, установка идёт (или пошла новая после сбоя).
          failed = false;
        } else if (Date.now() - lastChange >= STALL_MS) {
          failed = true;
        }
        const total = expectedRef.current;
        setProgress(total ? loadedShare(stored, total, puzzles) : null);
        showState();
      } catch {
        // Cache Storage недоступен на мгновение — проверим в следующий раз
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    const onNetwork = showState;
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
    };
  }, [waiting, attempt, startedReady]);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(() => setPhase('app'), DONE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const retry = useCallback(async () => {
    if (!navigator.onLine) return;
    setPhase('loading');
    setAttempt((n) => n + 1);
    // Если установка сорвалась, регистрации может не быть — тогда загрузить страницу заново.
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
      {phase === 'stalled' && <p className="first-load-text">Загрузка остановилась. Проверь связь и попробуй ещё раз.</p>}
      {(phase === 'loading' || phase === 'done') &&
        (progress === null ? (
          <div className="progress-bar progress-bar--indeterminate" role="progressbar" aria-label="Загрузка">
            <i />
          </div>
        ) : (
          <ProgressBar value={progress} label="Загрузка" />
        ))}
      {(phase === 'offline' || phase === 'stalled') && <BigButton onClick={() => void retry()}>Повторить</BigButton>}
      {iosTab && waiting && <p className="first-load-text first-load-ios">{IOS_TAB_NOTE}</p>}
    </section>
  );
}
