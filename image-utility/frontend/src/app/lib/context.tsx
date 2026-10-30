/** App-wide live data every page needs: settings, the edit kinds, the presets and the engine status. */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { useLive } from './live.ts';
import type { AppStatus, Preset, Schema, Settings } from './types.ts';

interface AppData {
  settings: Settings | null;
  schema: Schema | null;
  presets: Preset[];
  status: AppStatus | null;
  /** Read the status again now (after starting something it reports). */
  reloadStatus: () => void;
  ready: boolean;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useLive(() => api.settings(), ['settings'], []);
  const presets = useLive(() => api.presets(), ['presets'], []);
  const status = useLive(() => api.status(), ['images', 'proposals', 'requests', 'batches', 'exports'], [], 400);
  const [schema, setSchema] = useState<Schema | null>(null);
  useEffect(() => {
    api
      .schema()
      .then(setSchema)
      .catch(() => undefined);
  }, []);
  // The engine starts and stops on its own: look again every few seconds
  // (every second while a download is on its way).
  const reloadStatus = status.reload;
  const p = status.data?.setup.progress;
  const settingUp = status.data?.setup.state === 'pending' || p?.phase === 'downloading' || p?.phase === 'installing';
  useEffect(() => {
    const t = setInterval(reloadStatus, settingUp ? 1000 : 5000);
    return () => clearInterval(t);
  }, [reloadStatus, settingUp]);
  const value = useMemo<AppData>(
    () => ({
      settings: settings.data,
      schema,
      presets: presets.data?.presets ?? [],
      status: status.data,
      reloadStatus,
      ready: settings.data !== null && schema !== null,
    }),
    [settings.data, schema, presets.data, status.data, reloadStatus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp outside AppDataProvider');
  return v;
}
