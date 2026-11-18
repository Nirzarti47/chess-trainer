import { render, screen } from '@testing-library/react';
import { CATEGORY_ORDER } from '../analysis/report';
import { CATEGORY_TITLE } from '../analysis/phrases';
import { CategoryIcon } from './CategoryIcon';

describe('CategoryIcon', () => {
  it.each(CATEGORY_ORDER)('%s: подпись из CATEGORY_TITLE и цвет var(--cat-…)', (category) => {
    const { container } = render(<CategoryIcon category={category} />);
    const icon = screen.getByRole('img', { name: CATEGORY_TITLE[category] });
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('circle')?.getAttribute('fill')).toBe(`var(--cat-${category})`);
  });

  it('decorative: значок скрыт от чтеца, без role и aria-label', () => {
    const { container } = render(<CategoryIcon category="best" decorative />);
    const icon = container.querySelector('svg')!;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.hasAttribute('role')).toBe(false);
    expect(icon.hasAttribute('aria-label')).toBe(false);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('размер задаётся в пикселях, по умолчанию 30', () => {
    const { rerender } = render(<CategoryIcon category="best" />);
    expect(screen.getByRole('img').getAttribute('width')).toBe('30');
    rerender(<CategoryIcon category="best" size={20} />);
    expect(screen.getByRole('img').getAttribute('height')).toBe('20');
  });
});
