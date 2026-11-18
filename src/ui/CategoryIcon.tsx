import type { ReactNode } from 'react';
import { CATEGORY_TITLE } from '../analysis/phrases';
import type { Category } from '../analysis/report';

const WHITE = '#fff';

/** Восклицательный знак с центром по x = cx; s — масштаб. */
function bang(cx: number, s = 1): ReactNode {
  return (
    <g transform={`translate(${cx} 12) scale(${s}) translate(-12 -12)`} fill={WHITE}>
      <rect x="10.6" y="4.6" width="2.8" height="9.4" rx="1.4" />
      <circle cx="12" cy="18.2" r="1.7" />
    </g>
  );
}

/** Вопросительный знак с центром по x = cx; s — масштаб. */
function question(cx: number, s = 1): ReactNode {
  return (
    <g transform={`translate(${cx} 12) scale(${s}) translate(-12 -12)`}>
      <path d="M9.2 9.2a2.9 2.9 0 1 1 4.4 2.5c-1.1.7-1.6 1.2-1.6 2.5" fill="none" stroke={WHITE}
        strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="18.2" r="1.7" fill={WHITE} />
    </g>
  );
}

/** Пятиконечная звезда в центре кружка. */
const STAR = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 === 0 ? 7 : 3;
  const a = (Math.PI / 5) * i - Math.PI / 2;
  return `${(12 + r * Math.cos(a)).toFixed(2)},${(12.5 + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');

/** Белый знак внутри кружка (сетка 24 × 24). */
function glyph(category: Category): ReactNode {
  switch (category) {
    case 'brilliant': return <>{bang(8.4, 0.95)}{bang(15.6, 0.95)}</>;
    case 'great': return bang(12, 1.05);
    case 'best': return <polygon points={STAR} fill={WHITE} />;
    case 'excellent':
      return (
        <g fill={WHITE}>
          <path d="M5.6 11h2.9v7.2H6.6a1 1 0 0 1-1-1z" />
          <path d="M9.6 11l2.6-5.6a1.7 1.7 0 0 1 2.2 1.9L13.8 10h3.7a1.6 1.6 0 0 1 1.6 1.9l-.9 4.7a1.8 1.8 0 0 1-1.8 1.6H9.6z" />
        </g>
      );
    case 'good':
      return <path d="M7 12.6l3.3 3.3L17 9" fill="none" stroke={WHITE} strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round" />;
    case 'book':
      return (
        <g fill={WHITE}>
          <path d="M11.3 8.2c-1.6-1.2-3.7-1.7-6.1-1.5v9.7c2.4-.2 4.5.3 6.1 1.5z" />
          <path d="M12.7 8.2c1.6-1.2 3.7-1.7 6.1-1.5v9.7c-2.4-.2-4.5.3-6.1 1.5z" />
        </g>
      );
    case 'inaccuracy': return <>{question(9.4, 0.9)}{bang(16.6, 0.8)}</>;
    case 'mistake': return question(12, 1.05);
    case 'miss':
      return <path d="M8.4 8.4l7.2 7.2M15.6 8.4l-7.2 7.2" fill="none" stroke={WHITE} strokeWidth="2.8"
        strokeLinecap="round" />;
    case 'blunder': return <>{question(8.4, 0.95)}{question(15.6, 0.95)}</>;
  }
}

/** Значок вида хода: кружок цвета вида (var(--cat-<вид>)) с белым знаком внутри. size — в пикселях. */
export function CategoryIcon({ category, size = 30 }: { category: Category; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={CATEGORY_TITLE[category]}>
      <circle cx="12" cy="12" r="12" fill={`var(--cat-${category})`} />
      {glyph(category)}
    </svg>
  );
}
