import { useRef, type PointerEvent } from 'react';
import type { MoveReview, Side } from '../../domain/gameTypes';
import { moverOf } from './reviewModel';

interface GameChartProps {
  /** Доля белых 0..1 для каждой позиции (chartPoints). */
  points: number[];
  reviews: MoveReview[];
  userColor: Side;
  current: number;
  onSelect(index: number): void;
}

const MARKED = new Set(['mistake', 'blunder', 'brilliant', 'great']);

/** График партии по цветам: верх — белые, низ — чёрные. Нажатие и ведение пальцем переносят на ближайшую позицию. */
export function GameChart({ points, reviews, userColor, current, onSelect }: GameChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const last = Math.max(1, points.length - 1);
  const x = (i: number) => (i / last) * 100;
  // Поля сверху и снизу, чтобы линия у края (мат) не обрезалась.
  const y = (p: number) => 6 + (1 - p) * 88;

  const select = (e: PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    if (rect.width <= 0) return;
    const share = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const index = Math.round(share * last);
    if (index !== current && index < points.length) onSelect(index);
  };

  const dots = reviews.flatMap((r) => {
    const tone = r.mark ?? r.grade;
    if (moverOf(r.ply) !== userColor || !MARKED.has(tone) || r.ply + 1 >= points.length) return [];
    return [{ index: r.ply + 1, tone }];
  });

  return (
    <div
      ref={ref}
      className="game-chart"
      role="slider"
      aria-label="График партии"
      aria-valuemin={0}
      aria-valuemax={points.length - 1}
      aria-valuenow={current}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        select(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) select(e);
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect className="game-chart-white" x="0" y="0" width="100" height="50" />
        <rect className="game-chart-black" x="0" y="50" width="100" height="50" />
        <polyline
          className="game-chart-line"
          points={points.map((p, i) => `${x(i)},${y(p)}`).join(' ')}
          vectorEffect="non-scaling-stroke"
        />
        <line className="game-chart-now" x1={x(current)} x2={x(current)} y1="0" y2="100" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Точки — отдельным слоем, чтобы при растянутом SVG они оставались круглыми. */}
      {dots.map((d) => (
        <i
          key={d.index}
          className="game-chart-dot"
          style={{ left: `${x(d.index)}%`, top: `${y(points[d.index])}%`, background: `var(--grade-${d.tone})` }}
        />
      ))}
    </div>
  );
}
