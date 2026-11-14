/** Форма слова по числу: [1, 2–4, 5–20]. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}
