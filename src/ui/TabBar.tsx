import { NavLink } from 'react-router-dom';

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

export function TabBar() {
  return (
    <nav className="tabbar">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {tab.icon}
          </svg>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
