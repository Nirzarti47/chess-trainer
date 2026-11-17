import { useState, type FormEvent } from 'react';
import { ChessComError, fetchPlayer as realFetchPlayer, NO_ANSWER, normalizeNick } from '../../chesscom/api';
import { changeNick, setChessUser } from '../../data/gamesRepo';
import { gamesQueue, syncNow } from '../../games/gamesStore';
import { describeError } from '../lessonErrors';
import { BigButton } from '../../ui/BigButton';

export interface NickFormProps {
  /** Нынешний ник: если он есть, форма меняет его, а не подключает первый. */
  current?: string;
  onSaved(): void;
  fetchPlayer?: (nick: string) => Promise<void>;
  sync?: () => Promise<void>;
  /** Смена ника: стирает прежние партии и ставит новый ник. */
  change?: (nick: string) => Promise<void>;
}

async function changeAndRefresh(nick: string) {
  await changeNick(nick);
  await gamesQueue.reset();
}

function errorText(e: unknown): string {
  if (e instanceof ChessComError) {
    if (e.kind === 'notFound') return 'Игрок не найден';
    if (e.kind === 'offline') return 'Нет сети. Проверь интернет и попробуй ещё раз';
    if (e.kind === 'noAnswer') return NO_ANSWER;
    return `Chess.com ответил ошибкой: ${e.message}`;
  }
  return `Не удалось сохранить ник: ${describeError(e)}`;
}

/** Ввод ника с Chess.com: проверяет игрока, сохраняет ник и запускает загрузку партий. */
export function NickForm({
  current, onSaved, fetchPlayer = realFetchPlayer, sync = syncNow, change = changeAndRefresh,
}: NickFormProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const nick = normalizeNick(value);
    if (!nick || busy) return;
    // Тот же ник: менять нечего, партии остаются.
    if (current && nick === current) {
      onSaved();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetchPlayer(nick);
      if (current) await change(nick);
      else await setChessUser({ nick, loadedThrough: null });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    // Загрузка идёт в фоне: ход виден на вкладке «Партии».
    void sync();
    onSaved();
  }

  return (
    <form className="nick-form" onSubmit={(e) => void submit(e)}>
      <label htmlFor="nick-input">Ник на Chess.com</label>
      <input id="nick-input" type="text" value={value} autoCapitalize="none" autoCorrect="off"
        spellCheck={false} autoComplete="off" placeholder={current ?? 'Твой ник на Chess.com'}
        onChange={(e) => setValue(e.target.value)} />
      {error && <p className="nick-error" role="alert">{error}</p>}
      <BigButton type="submit" disabled={busy || !normalizeNick(value)}>
        {busy ? 'Проверяю…' : current ? 'Сменить ник' : 'Найти партии'}
      </BigButton>
    </form>
  );
}
