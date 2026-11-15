import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { pieceUrl } from '../content/pieceSets';
import { declineFastTrack, getActiveDays, getDueReviews, getLessonProgress, getProfile, getThemeStats } from '../data/repo';
import { localDay } from '../domain/dates';
import { buildPath, type PathItem, type PathView } from '../domain/path';
import { computeStreak } from '../domain/streak';
import type { ThemeId } from '../domain/types';
import { BigButton } from '../ui/BigButton';
import { Sheet } from '../ui/Sheet';
import { useSettings } from '../ui/settings';
import './LearnScreen.css';

/** Сколько держится подпись у закрытого узла. */
export const NOTE_MS = 2500;

/** Смещения кнопок змейки по горизонтали; первые пять — как в макете mockups/boards.html. */
const OFFSETS = [0, 34, 52, 22, -14, -34, -48, -24];

const PIECE_BY_THEME: Record<ThemeId, string> = {
  mateIn1: 'wQ', mateIn2: 'wQ',
  backRankMate: 'wR', skewer: 'wR', rookEndgame: 'wR',
  pin: 'wB', discoveredAttack: 'wB',
  hangingPiece: 'wP', promotion: 'wP', pawnEndgame: 'wP',
  smotheredMate: 'wN', fork: 'wN',
};

interface LearnData { path: PathView; streak: number; xp: number; rating: number }

async function loadLearn(): Promise<LearnData> {
  const today = localDay(new Date());
  const [profile, stats, progress, days, due] = await Promise.all([
    getProfile(), getThemeStats(), getLessonProgress(), getActiveDays(), getDueReviews(today),
  ]);
  return {
    path: buildPath(progress, stats, profile.fastTrackDeclined, due.length),
    streak: computeStreak(days, profile.firstDay, today).count,
    xp: profile.xp,
    rating: profile.rating,
  };
}

/** Форма слова по числу: [1, 2–4, 5–20]. */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

function dueCaption(n: number): string {
  if (n === 0) return 'Повтори слабые темы';
  return `${n} ${plural(n, ['задача', 'задачи', 'задач'])} ${plural(n, ['ждёт', 'ждут', 'ждут'])}`;
}

const FireIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2 .8-3.3 2-4.5.3 1.5 1 2.3 2 2.5-.5-3 .2-6 1-9z" />
  </svg>
);

const FlagIcon = () => (
  <svg viewBox="0 0 24 24" className="learn-flag" aria-hidden="true">
    <path d="M6 21V4M6 4h11l-2.5 4.5L17 13H6" />
  </svg>
);

function NodeIcon({ item, pieceSet }: { item: PathItem; pieceSet: string }) {
  const { node, status } = item;
  if (status === 'done') return <>✓</>;
  if (node.kind === 'exam') return <FlagIcon />;
  const code = node.kind === 'authored' ? 'wK' : PIECE_BY_THEME[node.themeId ?? ''] ?? 'wN';
  return <img alt="" src={pieceUrl(pieceSet, code)} />;
}

function caption(item: PathItem): string {
  if (item.status === 'done') return 'Пройдено';
  if (item.status === 'locked') return 'Закрыто';
  if (item.node.lessons === 1) return 'Начать';
  return `Урок ${(item.nextLesson ?? 0) + 1} из ${item.node.lessons}`;
}

/** status — статус узла пути или weak для «Слабых мест»; от него зависит цвет кнопки. */
function PathButton({ status, dot, title, sub, onClick }: {
  status: string; dot: ReactNode; title: string; sub: string; onClick(): void;
}) {
  return (
    <button type="button" className={`learn-node learn-node--${status}`} data-status={status} onClick={onClick}>
      <span className="learn-dot" aria-hidden="true">{dot}</span>
      <span className="learn-label">
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </button>
  );
}

type Dialog = { kind: 'fastTrack'; item: PathItem } | { kind: 'replay'; item: PathItem };

/** Экран «Учёба»: серия, опыт и рейтинг сверху, под ними путь змейкой. */
export function LearnScreen() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [data, setData] = useState<LearnData | null>(null);
  const [failed, setFailed] = useState(false);
  /** «Повторить» увеличивает номер попытки, и данные читаются заново. */
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRef = useRef<HTMLLIElement | null>(null);
  const scrolled = useRef(false);

  // Данные читаются заново при каждом показе экрана и при возвращении в приложение.
  useEffect(() => {
    let alive = true;
    const load = () => loadLearn().then(
      (d) => {
        if (!alive) return;
        setData(d);
        setFailed(false);
      },
      (e: unknown) => {
        console.error('Не удалось загрузить путь', e);
        if (alive) setFailed(true);
      },
    );
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [attempt]);

  useEffect(() => {
    if (!data || scrolled.current) return;
    scrolled.current = true;
    currentRef.current?.scrollIntoView?.({ block: 'center' });
  }, [data]);

  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  const openLesson = (nodeId: string, lessonIndex: number) => navigate(`/lesson/${nodeId}/${lessonIndex}`);

  function showNote(nodeId: string) {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setNote(nodeId);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
  }

  function tap(item: PathItem) {
    if (item.status === 'locked') return showNote(item.node.id);
    if (item.status === 'done') return setDialog({ kind: 'replay', item });
    if (item.fastTrackOffer) return setDialog({ kind: 'fastTrack', item });
    openLesson(item.node.id, item.nextLesson ?? 0);
  }

  async function inOrder(item: PathItem) {
    try {
      await declineFastTrack(item.node.id);
    } catch (e: unknown) {
      console.error('Не удалось сохранить выбор', e);
    }
    openLesson(item.node.id, item.nextLesson ?? 0);
  }

  if (failed) {
    return (
      <section className="learn learn-message">
        <p>Не удалось загрузить путь</p>
        <BigButton onClick={() => setAttempt((n) => n + 1)}>Повторить</BigButton>
      </section>
    );
  }
  if (!data) return <section className="learn" aria-busy="true" />;

  const { path } = data;
  const all = path.sections.flatMap((s) => s.items);
  // «Слабые места» стоят сразу за текущим узлом, а если весь путь пройден — в конце.
  const current = all.find((i) => i.status === 'current' && !i.reinforcement);
  const weakAfter = path.weakSpots.visible ? (current ?? all[all.length - 1]) : undefined;

  return (
    <section className="learn">
      <header className="learn-top">
        <span className="learn-chip learn-chip--fire" aria-label="Серия"><FireIcon />{data.streak}</span>
        <span className="learn-chip" aria-label="Опыт">Опыт {data.xp.toLocaleString('ru-RU')}</span>
        <span className="learn-chip learn-chip--right" aria-label="Рейтинг в задачах">{data.rating}</span>
      </header>

      {path.sections.map(({ section, items }) => {
        const nodes = items.filter((i) => !i.reinforcement);
        const done = nodes.filter((i) => i.status === 'done').length;
        const rows: ReactNode[] = [];
        for (const item of items) {
          const { id } = item.node;
          rows.push(
            <li key={id} ref={item === current ? currentRef : undefined}
              style={{ transform: `translateX(${OFFSETS[rows.length % OFFSETS.length]}px)` }}>
              <PathButton status={item.status} title={item.node.title} sub={caption(item)}
                dot={<NodeIcon item={item} pieceSet={settings.pieceSet} />} onClick={() => tap(item)} />
              {note === id && <p className="learn-note" role="status">Сначала пройди предыдущую тему</p>}
            </li>,
          );
          if (item === weakAfter) {
            rows.push(
              <li key="weak" style={{ transform: `translateX(${OFFSETS[rows.length % OFFSETS.length]}px)` }}>
                <PathButton status="weak" dot="↻" title="Слабые места"
                  sub={dueCaption(path.weakSpots.dueCount)} onClick={() => navigate('/run/weak')} />
              </li>,
            );
          }
        }
        return (
          <div key={section.id} className="learn-section">
            <div className="learn-banner">
              <h2>{section.title}</h2>
              <span>Пройдено {done} из {nodes.length}</span>
            </div>
            <ol className="learn-path">{rows}</ol>
          </div>
        );
      })}

      {dialog?.kind === 'fastTrack' && (
        <Sheet label="Тема идёт легко" onClose={() => setDialog(null)}>
          <p className="sheet-text">Тема идёт легко. Пройти сразу последний урок?</p>
          <div className="sheet-actions">
            <BigButton variant="surface" onClick={() => void inOrder(dialog.item)}>Идти по порядку</BigButton>
            <BigButton onClick={() => openLesson(dialog.item.node.id, dialog.item.node.lessons - 1)}>
              Да, к последнему
            </BigButton>
          </div>
        </Sheet>
      )}
      {dialog?.kind === 'replay' && (
        <Sheet label={dialog.item.node.title} onClose={() => setDialog(null)}>
          <p className="sheet-text">{dialog.item.node.title}</p>
          <div className="learn-replay">
            {Array.from({ length: dialog.item.node.lessons }, (_, i) => (
              <BigButton key={i} variant="surface" onClick={() => openLesson(dialog.item.node.id, i)}>
                Урок {i + 1}
              </BigButton>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}
