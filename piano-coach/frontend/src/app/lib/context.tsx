/**
 * App-wide state: the shell's one call (app.state) kept live, the settings
 * with optimistic writes, and the phone menu.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from '../../kit/index.ts';
import { audio } from '../music/audio.ts';
import { api } from './api.ts';
import { useLive } from './live.ts';
import type { AppState, Settings } from './types.ts';

interface AppCtx {
  state: AppState | null;
  settings: Settings | null;
  unread: number;
  menu: boolean;
  setMenu: (v: boolean) => void;
  reload: () => void;
  save: (p: Partial<Settings>) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const live = useLive(() => api.state(), ['settings', 'messages', 'songs', 'sessions', 'runs'], [], 150, 1200);
  const [menu, setMenu] = useState(false);
  const [local, setLocal] = useState<Partial<Settings>>({});
  const pending = useRef(0);

  const settings = useMemo<Settings | null>(() => (live.data === null ? null : { ...live.data.settings, ...local }), [live.data, local]);

  // Server values win once no write is in flight.
  useEffect(() => {
    if (pending.current === 0) setLocal({});
  }, [live.data]);

  useEffect(() => {
    if (settings === null) return;
    audio.setVolume(settings.volume / 100);
    audio.setClickVolume(settings.click_volume / 100);
  }, [settings]);

  const save = useCallback((p: Partial<Settings>) => {
    setLocal((l) => ({ ...l, ...p }));
    pending.current += 1;
    api
      .saveSettings(p)
      .catch((err: unknown) => toast.error((err as { message?: string }).message ?? 'Could not save the setting'))
      .finally(() => {
        pending.current -= 1;
      });
  }, []);

  const value: AppCtx = {
    state: live.data,
    settings,
    unread: live.data?.unread ?? 0,
    menu,
    setMenu,
    reload: live.reload,
    save,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (c === null) throw new Error('useApp outside AppProvider');
  return c;
}
