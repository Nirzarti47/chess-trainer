import type { ReactNode } from 'react';

/** Нижняя шторка поверх экрана; нажатие на затемнение вызывает onClose. */
export function Sheet({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="sheet">
      <button type="button" className="sheet-backdrop" aria-label="Закрыть" tabIndex={-1} onClick={onClose} />
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
