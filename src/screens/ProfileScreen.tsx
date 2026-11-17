import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { THEMES } from '../content/themes';
import {
  getActiveDays, getLessonProgress, getProfile, getRatingHistory, getSolvedPuzzleCount, getThemeStats, snoozeBackup,
} from '../data/repo';
import { getChessUser } from '../data/gamesRepo';
import type { ChessUser } from '../domain/gameTypes';
import { backupReminderDue } from '../domain/backupReminder';
import { localDay } from '../domain/dates';
import { buildPath } from '../domain/path';
import { computeStreak, type StreakInfo } from '../domain/streak';
import type { ThemeStat } from '../domain/types';
import { BigButton } from '../ui/BigButton';
import { Sheet } from '../ui/Sheet';
import { NickForm, type NickFormProps } from './games/NickForm';
import { plural } from '../ui/plural';
import './ProfileScreen.css';

/** Тема попадает в сильные и слабые, когда решено не меньше стольких задач. */
export const THEME_MIN_SOLVED = 5;
const THEMES_SHOWN = 3;
/** Больше точек график не рисует: длинная история прореживается. */
export const CHART_POINTS = 250;

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const STATE_TEXT: Record<string, string> = {
  done: 'засчитан', forgiven: 'пропуск прощён', missed: 'пропущен', today: 'сегодня',
};

interface ProfileData {
  streak: StreakInfo; xp: number; rating: number; history: number[];
  themesDone: number; lessonsDone: number; puzzlesSolved: number;
  strong: ThemeStat[]; weak: ThemeStat[]; reminder: boolean;
}

async function loadProfile(): Promise<ProfileData> {
  const now = new Date();
  const [profile, stats, progress, days, solved, history] = await Promise.all([
    getProfile(), getThemeStats(), getLessonProgress(), getActiveDays(), getSolvedPuzzleCount(), getRatingHistory(),
  ]);
  const path = buildPath(progress, stats, profile.fastTrackDeclined, 0);
  const themesDone = path.sections.flatMap((s) => s.items)
    .filter((i) => i.node.kind === 'theme' && !i.reinforcement && i.status === 'done').length;
  // Сильные — лучшие по рейтингу, слабые — худшие из оставшихся, чтобы тема не попала в оба списка.
  const ranked = stats.filter((s) => s.solved >= THEME_MIN_SOLVED).sort((a, b) => b.rating - a.rating);
  const strong = ranked.slice(0, THEMES_SHOWN);
  const weak = ranked.slice(strong.length).reverse().slice(0, THEMES_SHOWN);
  return {
    streak: computeStreak(days, profile.firstDay, localDay(now)),
    xp: profile.xp,
    rating: profile.rating,
    history: history.map((h) => h.rating),
    themesDone,
    lessonsDone: progress.length,
    puzzlesSolved: solved,
    strong,
    weak,
    reminder: backupReminderDue(profile, now),
  };
}

const themeTitle = (id: string) => THEMES.find((t) => t.id === id)?.title ?? id;

/** Не больше limit точек через равные промежутки; первая и последняя сохраняются. */
export function thinPoints(points: number[], limit = CHART_POINTS): number[] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => points[Math.round(i * step)]);
}

function RatingChart({ points: all }: { points: number[] }) {
  if (all.length < 2) return <p className="profile-hint">График появится после первых задач</p>;
  const points = thinPoints(all);
  const W = 300, H = 64, PAD = 4;
  // Циклом, а не Math.min(...points): разворот длинного массива в Safari бросает исключение.
  let min = points[0], max = points[0];
  for (const r of points) {
    if (r < min) min = r;
    if (r > max) max = r;
  }
  const y = (r: number) => (max === min ? H / 2 : PAD + ((max - r) / (max - min)) * (H - 2 * PAD));
  const coords = points.map((r, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${y(r).toFixed(1)}`);
  return (
    <svg className="profile-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label="График рейтинга">
      <polyline points={coords.join(' ')} />
    </svg>
  );
}

function ThemeList({ id, title, stats }: { id: string; title: string; stats: ThemeStat[] }) {
  if (stats.length === 0) return null;
  return (
    <>
      <h2 id={id}>{title}</h2>
      <ul className="profile-themes" aria-labelledby={id}>
        {stats.map((s) => (
          <li key={s.theme}><span>{themeTitle(s.theme)}</span><b>{s.rating}</b></li>
        ))}
      </ul>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="profile-stat">
      <b aria-label={label}>{value.toLocaleString('ru-RU')}</b>
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

type NickDeps = Pick<NickFormProps, 'fetchPlayer' | 'sync' | 'change'> & {
  /** Чтение ника из базы; в тестах подменяется. */
  readUser?: () => Promise<ChessUser | null>;
};

/** Строка «Ник на Chess.com»: открывает лист со сменой ника и предупреждением. */
function NickRow({ readUser = getChessUser, ...deps }: NickDeps) {
  // undefined — ещё не прочитан, null — ника нет, строка — ник есть.
  const [nick, setNick] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) return;
    let alive = true;
    readUser().then(
      (u) => { if (alive) { setNick(u?.nick ?? null); setFailed(false); } },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [open, readUser]);
  const ready = nick !== undefined && !failed;
  let label: string;
  if (failed) label = 'Не удалось прочитать ник';
  else if (nick === undefined) label = 'Ник на Chess.com';
  else label = nick ? `Ник на Chess.com: ${nick}` : 'Подключить Chess.com';
  return (
    <>
      <button type="button" disabled={!ready} onClick={() => setOpen(true)}>
        {label}<span aria-hidden="true">›</span>
      </button>
      {open && ready && (
        <Sheet label="Смена ника" onClose={() => setOpen(false)}>
          {nick && <p className="sheet-text">Партии и задачи из них для прежнего ника будут удалены</p>}
          {/* Прежний ник больше не верен: строка ждёт нового чтения выключенной. */}
          <NickForm current={nick ?? undefined} onSaved={() => { setNick(undefined); setOpen(false); }} {...deps} />
        </Sheet>
      )}
    </>
  );
}

function ProfileMenu(deps: NickDeps) {
  return (
    <nav className="profile-menu" aria-label="Настройки">
      <NickRow {...deps} />
      <Link to="/profile/appearance">Оформление<span aria-hidden="true">›</span></Link>
      <Link to="/profile/backup">Резервная копия<span aria-hidden="true">›</span></Link>
      <Link to="/profile/about">О приложении<span aria-hidden="true">›</span></Link>
    </nav>
  );
}

/** Экран «Профиль»: серия, опыт, рейтинг, темы и вход в настройки. */
export function ProfileScreen(deps: NickDeps) {
  const navigate = useNavigate();
  const [data, setData] = useState<ProfileData | null>(null);
  const [failed, setFailed] = useState(false);
  /** «Повторить» увеличивает номер попытки, и данные читаются заново. */
  const [attempt, setAttempt] = useState(0);

  // Данные читаются заново при каждом показе экрана и при возвращении в приложение.
  useEffect(() => {
    let alive = true;
    const load = () => loadProfile().then(
      (d) => {
        if (!alive) return;
        setData(d);
        setFailed(false);
      },
      (e: unknown) => {
        console.error('Не удалось загрузить профиль', e);
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

  async function later() {
    setData((d) => d && { ...d, reminder: false });
    try {
      await snoozeBackup(new Date());
    } catch (e: unknown) {
      console.error('Не удалось отложить напоминание', e);
    }
  }

  // Меню рисуется и при ошибке: через него восстанавливают резервную копию.
  if (failed) {
    return (
      <section className="profile">
        <header className="profile-head"><h1>Профиль</h1></header>
        <div className="profile-card">
          <p className="profile-hint">Не удалось загрузить профиль</p>
          <BigButton onClick={() => setAttempt((n) => n + 1)}>Повторить</BigButton>
        </div>
        <ProfileMenu {...deps} />
      </section>
    );
  }
  if (!data) return <section className="profile" aria-busy="true" />;

  const { streak } = data;
  return (
    <section className="profile">
      <header className="profile-head"><h1>Профиль</h1></header>

      {data.reminder && (
        <div className="profile-card profile-reminder">
          <p><b>Давно не было резервной копии</b>Сохрани прогресс в файл, чтобы не потерять его.</p>
          <div className="sheet-actions">
            <BigButton variant="surface" onClick={() => void later()}>Позже</BigButton>
            <BigButton onClick={() => navigate('/profile/backup')}>Сохранить</BigButton>
          </div>
        </div>
      )}

      <div className="profile-card">
        <p className="profile-streak">
          <b aria-label="Серия">{streak.count}</b> {plural(streak.count, ['день', 'дня', 'дней'])} подряд
        </p>
        <ul className="profile-week" aria-label="Эта неделя">
          {streak.week.map(({ day, state }, i) => (
            <li key={day} data-state={state}
              title={STATE_TEXT[state] ? `${WEEKDAYS[i]}: ${STATE_TEXT[state]}` : undefined}>
              {WEEKDAYS[i]}
            </li>
          ))}
        </ul>
        <p className="profile-hint">
          Пропуск на этой неделе: {streak.skipUsedThisWeek ? 'использован' : 'есть'}
        </p>
      </div>

      <div className="profile-card">
        <div className="profile-stats">
          <Stat label="Рейтинг в задачах" value={data.rating} />
          <Stat label="Опыт" value={data.xp} />
        </div>
        <RatingChart points={data.history} />
      </div>

      <div className="profile-card profile-stats profile-stats--three">
        <Stat label="Пройдено тем" value={data.themesDone} />
        <Stat label="Пройдено уроков" value={data.lessonsDone} />
        <Stat label="Решено без ошибок" value={data.puzzlesSolved} />
      </div>

      {data.strong.length === 0
        ? <p className="profile-hint profile-pad">Статистика по темам появится после первых уроков</p>
        : (
          <>
            <ThemeList id="profile-strong" title="Сильные темы" stats={data.strong} />
            <ThemeList id="profile-weak" title="Слабые темы" stats={data.weak} />
          </>
        )}

      <ProfileMenu {...deps} />
    </section>
  );
}
