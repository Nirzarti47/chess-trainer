import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_BOARD } from '../content/boards';
import { DEFAULT_PIECE_SET } from '../content/pieceSets';
import { getSettings, saveSettings } from '../data/repo';
import type { Settings } from '../domain/types';
import { boardThemeCss } from './boardTheme';

const DEFAULT_SETTINGS: Settings = { board: DEFAULT_BOARD, pieceSet: DEFAULT_PIECE_SET };

interface SettingsValue {
  settings: Settings;
  setSettings(s: Settings): void;
}

const SettingsContext = createContext<SettingsValue>({ settings: DEFAULT_SETTINGS, setSettings: () => {} });

/** Настройки оформления для всего приложения. До загрузки из базы действуют значения по умолчанию. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setState] = useState<Settings>(DEFAULT_SETTINGS);
  // Если выбор сделан раньше, чем пришли сохранённые настройки, загрузка его не перетирает.
  const changedByUser = useRef(false);

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => {
        if (alive && !changedByUser.current) setState(s);
      })
      .catch(() => {
        // Без базы остаются значения по умолчанию.
      });
    return () => {
      alive = false;
    };
  }, []);

  const setSettings = useCallback((s: Settings) => {
    changedByUser.current = true;
    setState(s);
    saveSettings(s).catch((e: unknown) => console.error('Не удалось сохранить настройки', e));
  }, []);

  const value = useMemo(() => ({ settings, setSettings }), [settings, setSettings]);

  return (
    <SettingsContext.Provider value={value}>
      <style data-board-theme="">{boardThemeCss(settings)}</style>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsValue {
  return useContext(SettingsContext);
}
