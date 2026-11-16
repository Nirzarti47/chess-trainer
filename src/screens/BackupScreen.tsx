import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { BackupError, exportBackup, importBackup } from '../data/backup';
import { markBackupDone } from '../data/repo';
import { localDay } from '../domain/dates';
import { gamesQueue } from '../games/gamesStore';
import { BigButton } from '../ui/BigButton';
import { Sheet } from '../ui/Sheet';
import './ProfileScreen.css';

/** Пауза перед перезагрузкой, чтобы успеть прочитать «Прогресс восстановлен». */
export const RELOAD_DELAY_MS = 800;

export const backupFileName = (now: Date) => `chess-trainer-${localDay(now)}.json`;

type Status = { kind: 'ok' | 'error'; text: string } | null;

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  // Сразу отзывать нельзя: браузер может ещё не начать скачивание.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Отдаёт файл через системное меню «Поделиться» (iPhone), иначе скачивает.
 *  share вызывается синхронно: Safari пускает его только сразу после касания, без await перед ним.
 *  Если меню отказало (например, NotAllowedError), файл скачивается.
 *  false — пользователь закрыл меню, файл не сохранён. */
function saveFile(file: File): Promise<boolean> {
  if (typeof navigator.share !== 'function' || !navigator.canShare?.({ files: [file] })) {
    download(file);
    return Promise.resolve(true);
  }
  let shared: Promise<void>;
  try {
    shared = navigator.share({ files: [file] });
  } catch (e: unknown) {
    shared = Promise.reject(e);
  }
  return shared.then(
    () => true,
    (e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      download(file);
      return true;
    },
  );
}

/** Экран «Резервная копия»: весь прогресс в файл и обратно. reload подменяется в тестах. */
export function BackupScreen({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Файл копии собирается заранее — при показе экрана и при возвращении в приложение,
  // чтобы нажатие сразу вызывало share без ожидания чтения базы.
  useEffect(() => {
    let alive = true;
    let build = 0;
    const prepare = () => {
      const id = ++build;
      setFile(null);
      exportBackup().then(
        (blob) => {
          if (alive && id === build) setFile(new File([blob], backupFileName(new Date()), { type: 'application/json' }));
        },
        (e: unknown) => {
          console.error('Не удалось подготовить копию', e);
          if (alive && id === build) setStatus({ kind: 'error', text: 'Не удалось сохранить файл' });
        },
      );
    };
    const onVisible = () => { if (document.visibilityState === 'visible') prepare(); };
    prepare();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  function save() {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    saveFile(file)
      .then(async (saved) => {
        if (!saved) return;
        await markBackupDone(new Date());
        setStatus({ kind: 'ok', text: 'Копия сохранена' });
      })
      .catch((e: unknown) => {
        console.error('Не удалось сохранить копию', e);
        setStatus({ kind: 'error', text: 'Не удалось сохранить файл' });
      })
      .finally(() => setBusy(false));
  }

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';   // тот же файл можно выбрать ещё раз
    if (file) {
      setStatus(null);
      setPending(file);
    }
  }

  async function restore(file: File) {
    setPending(null);
    setBusy(true);
    try {
      await importBackup(await file.text());
      // Восстановленное состояние и есть содержимое файла: напоминание о копии считается от сейчас.
      await markBackupDone(new Date()).catch((e: unknown) => console.error('Не удалось отметить копию', e));
      // Набор партий и задач мог измениться: очередь разбора перечитывает базу. Сбой не отменяет восстановление.
      await gamesQueue.refresh().catch((e: unknown) => console.error('Не удалось обновить партии', e));
      setStatus({ kind: 'ok', text: 'Прогресс восстановлен' });
      // Перезагрузка — чтобы все экраны и настройки прочитали восстановленные данные.
      setTimeout(reload, RELOAD_DELAY_MS);
    } catch (e: unknown) {
      if (!(e instanceof BackupError)) console.error('Не удалось восстановить копию', e);
      setStatus({ kind: 'error', text: e instanceof BackupError ? e.message : 'Не удалось прочитать файл' });
      setBusy(false);
    }
  }

  return (
    <section className="profile">
      <header className="sub-head">
        <Link to="/profile" className="sub-back" aria-label="Назад в профиль">‹</Link>
        <h1>Резервная копия</h1>
      </header>

      <p className="profile-text profile-pad">
        Прогресс хранится только на этом устройстве. Сохрани его в файл, чтобы перенести на другой телефон
        или вернуть после удаления приложения.
      </p>

      <div className="profile-actions">
        <BigButton disabled={busy || !file} onClick={save}>{file ? 'Сохранить в файл' : 'Готовлю файл…'}</BigButton>
        <BigButton variant="surface" disabled={busy} onClick={() => input.current?.click()}>
          Восстановить из файла
        </BigButton>
        <input ref={input} type="file" accept=".json,application/json" hidden
          aria-label="Восстановить из файла" onChange={choose} />
      </div>

      {status && (
        <p className={`profile-status profile-status--${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.text}
        </p>
      )}

      {pending && (
        <Sheet label="Восстановление" onClose={() => setPending(null)}>
          <p className="sheet-text">Текущий прогресс будет заменён</p>
          <div className="sheet-actions">
            <BigButton variant="surface" onClick={() => setPending(null)}>Отмена</BigButton>
            <BigButton onClick={() => void restore(pending)}>Заменить</BigButton>
          </div>
        </Sheet>
      )}
    </section>
  );
}
