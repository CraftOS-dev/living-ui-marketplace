/**
 * App-wide data every screen needs once: organization settings, the
 * vocabulary pack, people (for assignees), the signed-in person's role and
 * permissions, the event catalog, rights dimensions and properties.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../../kit/index.ts';
import { useCollection } from './live.ts';
import { opGet } from './api.ts';
import { useLiveReload } from './live.ts';
import { VOCAB } from './labels.ts';
import type { Vocab } from './labels.ts';
import type {
  DimensionRec,
  DimensionValueRec,
  MetaResponse,
  PropertyRec,
  Role,
  SettingsRec,
  UserRec,
} from './types.ts';

export interface Can {
  read: boolean;
  contribute: boolean;
  edit: boolean;
  manage: boolean;
  admin: boolean;
}

export interface AppData {
  settings: SettingsRec | null;
  settingsLoading: boolean;
  vocab: Vocab;
  homeCurrency: string;
  users: UserRec[];
  userName: (id: string) => string;
  me: UserRec | null;
  role: Role | '';
  can: Can;
  meta: MetaResponse | null;
  refreshMeta: () => void;
  dimensions: DimensionRec[];
  dimValues: DimensionValueRec[];
  dimLabel: (dimension: string, code: string) => string;
  properties: PropertyRec[];
  propertyName: (id: string) => string;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId } = useAuth();
  const settingsCol = useCollection<SettingsRec>('settings', { sort: 'created' });
  const usersCol = useCollection<UserRec>('users', { sort: 'name' });
  const dims = useCollection<DimensionRec>('dimensions', { sort: 'order' });
  const dimVals = useCollection<DimensionValueRec>('dimension_values', { sort: 'order' });
  const props = useCollection<PropertyRec>('properties', { sort: 'name' });
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [metaTick, setMetaTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    opGet<MetaResponse>('meta')
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, metaTick]);

  const refreshMeta = useCallback(() => setMetaTick((t) => t + 1), []);
  // Office connection state and the rule catalog change when an admin or an
  // agent edits them; meta follows without a reload.
  useLiveReload(['office_connections', 'rules'], refreshMeta);

  const value = useMemo<AppData>(() => {
    const settings = settingsCol.records[0] ?? null;
    const me = usersCol.records.find((u) => u.id === userId) ?? null;
    const role = (me?.role ?? meta?.role ?? '') as Role | '';
    const can: Can = {
      read: role !== '' && role !== 'inventor',
      contribute: role === 'admin' || role === 'manager' || role === 'counsel' || role === 'contributor',
      edit: role === 'admin' || role === 'manager' || role === 'counsel',
      manage: role === 'admin' || role === 'manager',
      admin: role === 'admin',
    };
    const userMap = new Map(usersCol.records.map((u) => [u.id, u]));
    const dimMap = new Map(dimVals.records.map((d) => [`${d.dimension}:${d.code}`, d.label]));
    const propMap = new Map(props.records.map((p) => [p.id, p.name]));
    return {
      settings,
      settingsLoading: settingsCol.loading,
      vocab: VOCAB[settings?.vocab_pack ?? 'general'] ?? VOCAB.general,
      homeCurrency: (settings?.home_currency || 'USD').toUpperCase(),
      users: usersCol.records,
      userName: (id: string) => {
        if (!id) return '';
        const u = userMap.get(id);
        return u ? u.name || u.email : 'Former user';
      },
      me,
      role,
      can,
      meta,
      refreshMeta,
      dimensions: dims.records,
      dimValues: dimVals.records,
      dimLabel: (dimension: string, code: string) => dimMap.get(`${dimension}:${code}`) ?? code,
      properties: props.records,
      propertyName: (id: string) => propMap.get(id) ?? '',
    };
  }, [settingsCol.records, settingsCol.loading, usersCol.records, userId, meta, refreshMeta, dims.records, dimVals.records, props.records]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp must be used inside AppDataProvider');
  return v;
}

/**
 * Load async data with loading/error state. `reload` shows the loading state;
 * `refresh` re-runs quietly and keeps the last result on screen meanwhile
 * (used for live updates, see lib/live.ts).
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
): { data: T | null; loading: boolean; error: string | null; reload: () => void; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState<{ n: number; silent: boolean }>({ n: 0, silent: false });
  useEffect(() => {
    let cancelled = false;
    if (!tick.silent) setLoading(true);
    fn()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => ({ n: t.n + 1, silent: false })), []);
  const refresh = useCallback(() => setTick((t) => ({ n: t.n + 1, silent: true })), []);
  return { data, loading, error, reload, refresh };
}
