/** Тонкая полоска прогресса из макета (вариант B). value — доля от 0 до 1. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div className="progress-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percent}>
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}
