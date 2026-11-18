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

  it('размер задаётся в пикселях, по умолчанию 30', () => {
    const { rerender } = render(<CategoryIcon category="best" />);
    expect(screen.getByRole('img').getAttribute('width')).toBe('30');
    rerender(<CategoryIcon category="best" size={20} />);
    expect(screen.getByRole('img').getAttribute('height')).toBe('20');
  });
});
