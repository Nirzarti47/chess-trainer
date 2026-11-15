import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../data/db';
import { getProfile } from '../data/repo';
import { addDays, localDay } from '../domain/dates';
import { TabBar } from './TabBar';

const DOT = 'Пора сделать резервную копию';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function firstDayAgo(days: number) {
  const p = await getProfile();
  await db.kv.put({ key: 'profile', value: { ...p, firstDay: addDays(localDay(new Date()), -days) } });
}

const renderBar = () => render(<MemoryRouter initialEntries={['/learn']}><TabBar /></MemoryRouter>);

describe('TabBar', () => {
  it('когда пора делать копию, на значке «Профиль» точка', async () => {
    await firstDayAgo(15);
    renderBar();
    const dot = await screen.findByRole('img', { name: DOT });
    expect(dot.closest('a')!.textContent).toContain('Профиль');
  });

  it('пока не пора, точки нет', async () => {
    await firstDayAgo(3);
    renderBar();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('img', { name: DOT })).toBeNull();
  });
});
