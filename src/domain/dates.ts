const pad = (n: number) => String(n).padStart(2, '0');

function parse(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [y, m, d];
}

function format(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** День по местному времени устройства, 'YYYY-MM-DD'. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Сдвиг дня на n дней; считается в UTC, поэтому не зависит от часового пояса и перехода на летнее время. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = parse(day);
  return format(Date.UTC(y, m - 1, d + n));
}

/** Понедельник недели, в которую входит день. */
export function mondayOf(day: string): string {
  const [y, m, d] = parse(day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 — воскресенье
  return addDays(day, -((weekday + 6) % 7));
}
