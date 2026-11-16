import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { getProfile } from '../data/repo';
import { backupReminderDue } from '../domain/backupReminder';

const TABS = [
  {
    to: '/learn',
    label: 'Учёба',
    icon: (
      <>
        <path d="M4 5.5c3-1 5.5-.6 8 1 2.5-1.6 5-2 8-1v12c-3-1-5.5-.6-8 1-2.5-1.6-5-2-8-1z" />
        <path d="M12 6.5v12" />
      </>
    ),
  },
  {
    to: '/puzzles',
    label: 'Задачи',
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </>
    ),
  },
  {
    to: '/games',
    label: 'Партии',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 12h16M12 4v16" />
      </>
    ),
  },
  {
    to: '/profile',
    label: 'Профиль',
    icon: (
      <>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
      </>
    ),
  },
];

/** Пора ли напомнить о резервной копии; читается заново при каждом переходе и возвращении в приложение. */
function useBackupDue(): boolean {
  const { pathname } = useLocation();
  const [due, setDue] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => getProfile().then(
      (p) => { if (alive) setDue(backupReminderDue(p, new Date())); },
      () => undefined,
    );
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname]);
  return due;
}

export function TabBar() {
  const backupDue = useBackupDue();
  return (
    <nav className="tabbar">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to}>
          <span className="tabbar-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {tab.icon}
            </svg>
            {tab.to === '/profile' && backupDue && (
              <span className="tabbar-dot" role="img" aria-label="Пора сделать резервную копию" />
            )}
          </span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
