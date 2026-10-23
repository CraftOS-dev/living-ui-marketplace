/** App-wide live data every page needs: settings, the feature schema and the engine status. */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { setNameLabels } from './keys.ts';
import { useLive } from './live.ts';
import type { AppStatus, Schema, Settings } from './types.ts';
import type { Unit } from './format.ts';

interface AppData {
  settings: Settings | null;
  unit: Unit;
  schema: Schema | null;
  status: AppStatus | null;
  /** Read the status again now (after starting something it reports). */
  reloadStatus: () => void;
  ready: boolean;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useLive(() => api.settings(), ['settings'], []);
  const status = useLive(() => api.status(), ['builds', 'parts', 'briefs'], [], 400);
  const [schema, setSchema] = useState<Schema | null>(null);
  useEffect(() => {
    api
      .schema()
      .then((s) => {
        setNameLabels(s.name_labels);
        setSchema(s);
      })
      .catch(() => undefined);
  }, []);
  // The engine starts and stops on its own: look again every few seconds
  // (every second while its first-run download is on its way).
  const reloadStatus = status.reload;
  const setup = status.data?.engine.setup.state;
  const settingUp = setup === 'pending' || setup === 'downloading' || setup === 'installing';
  useEffect(() => {
    const t = setInterval(reloadStatus, settingUp ? 1000 : 5000);
    return () => clearInterval(t);
  }, [reloadStatus, settingUp]);
  const value = useMemo<AppData>(
    () => ({
      settings: settings.data,
      unit: settings.data?.display_unit ?? 'mm',
      schema,
      status: status.data,
      reloadStatus,
      ready: settings.data !== null && schema !== null,
    }),
    [settings.data, schema, status.data, reloadStatus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp outside AppDataProvider');
  return v;
}
