/** Урока по такому адресу нет (неизвестный узел, номер вне диапазона). Остальные сбои — «не удалось открыть». */
export class LessonNotFoundError extends Error {
  constructor(message = 'Урок не найден') {
    super(message);
    this.name = 'LessonNotFoundError';
  }
}

/** Короткое описание сбоя для экрана: по нему видно, что именно не сработало на устройстве. */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const inner = (e as { inner?: unknown }).inner;
  const own = `${e.name}: ${e.message}`;
  return inner instanceof Error && inner.message && !own.includes(inner.message)
    ? `${own} (${inner.name}: ${inner.message})` : own;
}

/** Помечает сбой шага загрузки названием шага. */
export function labelled<T>(label: string, p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    throw new Error(`${label} — ${describeError(e)}`);
  });
}
