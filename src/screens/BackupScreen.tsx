import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { BackupError, exportBackup, importBackup } from '../data/backup';
import { markBackupDone } from '../data/repo';
import { localDay } from '../domain/dates';
import { BigButton } from '../ui/BigButton';
import { Sheet } from '../ui/Sheet';
import './ProfileScreen.css';

/** Пауза перед перезагрузкой, чтобы успеть прочитать «Прогресс восстановлен». */
export const RELOAD_DELAY_MS = 800;

export const backupFileName = (now: Date) => `chess-trainer-${localDay(now)}.json`;

type Status = { kind: 'ok' | 'error'; text: string } | null;

/** Отдаёт файл через системное меню «Поделиться» (iPhone), иначе скачивает.
 *  false — пользователь закрыл меню, файл не сохранён. */
async function saveFile(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], name, { type: 'application/json' });
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/** Экран «Резервная копия»: весь прогресс в файл и обратно. reload подменяется в тестах. */
export function BackupScreen({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const now = new Date();
      if (await saveFile(await exportBackup(), backupFileName(now))) {
        await markBackupDone(now);
        setStatus({ kind: 'ok', text: 'Копия сохранена' });
      }
    } catch (e: unknown) {
      console.error('Не удалось сохранить копию', e);
      setStatus({ kind: 'error', text: 'Не удалось сохранить файл' });
    } finally {
      setBusy(false);
    }
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
        <BigButton disabled={busy} onClick={() => void save()}>Сохранить в файл</BigButton>
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
