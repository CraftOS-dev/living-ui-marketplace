/**
 * App-wide data every screen needs once: organization settings and modules,
 * the reader's language, people (for assignees), the signed-in person's role
 * and permissions, the event catalog, rights dimensions, and the name lists
 * of franchises, titles, characters and talents (for pickers and labels).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../../kit/index.ts';
import { opGet, updateRecord } from './api.ts';
import { setLang } from './i18n.ts';
import { useCollection, useLiveReload } from './live.ts';
import type { CharacterRec, DimensionValueRec, FranchiseRec, SettingsRec, TalentRec, TitleRec, UserRec } from './records.ts';
import { EXTERNAL_ROLES, MODULE_KEYS } from './shapes.ts';
import type { Lang, MetaResponse, ModuleKey, Profile, Role } from './shapes.ts';

/** What the signed-in person may do (mirrors the server's levels in lib_util.js). */
export interface Can {
  read: boolean;
  contribute: boolean;
  edit: boolean;
  rights: boolean;
  licensing: boolean;
  talent: boolean;
  manage: boolean;
  admin: boolean;
  external: boolean;
}

export interface Named {
  id: string;
  name: string;
}

export interface AppData {
  settings: SettingsRec | null;
  settingsLoading: boolean;
  lang: Lang;
  changeLang: (lang: Lang) => void;
  homeCurrency: string;
  jurisdictions: string[];
  profiles: Profile[];
  modules: Record<ModuleKey, boolean>;
  on: (m: ModuleKey) => boolean;
  users: UserRec[];
  userName: (id: string) => string;
  me: UserRec | null;
  role: Role | '';
  can: Can;
  meta: MetaResponse | null;
  refreshMeta: () => void;
  dimValues: DimensionValueRec[];
  dimLabel: (dimension: string, code: string) => string;
  franchises: FranchiseRec[];
  titles: TitleRec[];
  characters: CharacterRec[];
  talents: TalentRec[];
  nameOf: (type: 'franchise' | 'work' | 'character' | 'talent', id: string) => string;
}

const Ctx = createContext<AppData | null>(null);

const INTERNAL: Role[] = ['admin', 'manager', 'rights', 'licensing', 'talent_manager', 'contributor', 'viewer'];
const EDITORS: Role[] = ['admin', 'manager', 'rights', 'licensing', 'talent_manager'];

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId } = useAuth();
  const settingsCol = useCollection<SettingsRec>('settings', { sort: 'created' });
  const usersCol = useCollection<UserRec>('users', { sort: 'name' });
  const dimVals = useCollection<DimensionValueRec>('dimension_values', { sort: 'order' });
  const franchisesCol = useCollection<FranchiseRec>('franchises', { sort: 'name' });
  const titlesCol = useCollection<TitleRec>('titles', { sort: 'title' });
  const charactersCol = useCollection<CharacterRec>('characters', { sort: 'name' });
  const talentsCol = useCollection<TalentRec>('talents', { sort: 'stage_name' });
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

  const refreshMeta = useCallback(() => setMetaTick((x) => x + 1), []);
  // Modules, office connections and the event catalog change when an admin or an agent edits them.
  useLiveReload(['office_connections', 'rules', 'settings'], refreshMeta);

  const value = useMemo<AppData>(() => {
    const settings = settingsCol.records[0] ?? null;
    const me = usersCol.records.find((u) => u.id === userId) ?? null;
    const role = (me?.role || meta?.role || '') as Role | '';
    const r = role as Role;
    const external = role !== '' && EXTERNAL_ROLES.includes(r);
    const can: Can = {
      read: role !== '' && INTERNAL.includes(r),
      contribute: role !== '' && [...EDITORS, 'contributor'].includes(r),
      edit: role !== '' && EDITORS.includes(r),
      rights: role === 'admin' || role === 'manager' || role === 'rights',
      licensing: role === 'admin' || role === 'manager' || role === 'licensing',
      talent: role === 'admin' || role === 'manager' || role === 'talent_manager',
      manage: role === 'admin' || role === 'manager',
      admin: role === 'admin',
      external,
    };
    const lang: Lang = (me?.ui_language || meta?.language || settings?.default_language || 'ja') === 'en' ? 'en' : 'ja';
    setLang(lang);
    const rawModules = settings?.modules ?? meta?.modules ?? {};
    const modules = {} as Record<ModuleKey, boolean>;
    // Before onboarding nothing is chosen yet: show everything.
    const none = Object.keys(rawModules).length === 0;
    for (const k of MODULE_KEYS) modules[k] = none ? true : rawModules[k] === true;
    const userMap = new Map(usersCol.records.map((u) => [u.id, u]));
    const dimMap = new Map(dimVals.records.map((d) => [`${d.dimension}:${d.code}`, d]));
    const names = {
      franchise: new Map(franchisesCol.records.map((x) => [x.id, x.name])),
      work: new Map(titlesCol.records.map((x) => [x.id, x.title])),
      character: new Map(charactersCol.records.map((x) => [x.id, x.name])),
      talent: new Map(talentsCol.records.map((x) => [x.id, x.stage_name])),
    };
    return {
      settings,
      settingsLoading: settingsCol.loading,
      lang,
      changeLang: (l: Lang) => {
        if (me !== null) void updateRecord('users', me.id, { ui_language: l });
        else {
          setLang(l);
          setMetaTick((x) => x + 1);
        }
      },
      homeCurrency: (settings?.home_currency || 'JPY').toUpperCase(),
      jurisdictions: settings?.jurisdictions ?? ['JP', 'US', 'CN', 'KR', 'TW', 'EM', 'WO'],
      profiles: settings?.profiles ?? meta?.profiles ?? [],
      modules,
      on: (m: ModuleKey) => modules[m],
      users: usersCol.records,
      userName: (id: string) => {
        if (!id) return '';
        const u = userMap.get(id);
        return u ? u.name || u.email : lang === 'ja' ? '退職者' : 'Former user';
      },
      me,
      role,
      can,
      meta,
      refreshMeta,
      dimValues: dimVals.records,
      dimLabel: (dimension: string, code: string) => {
        const d = dimMap.get(`${dimension}:${code}`);
        if (d === undefined) return code;
        return lang === 'ja' ? d.label_ja || d.label : d.label;
      },
      franchises: franchisesCol.records,
      titles: titlesCol.records,
      characters: charactersCol.records,
      talents: talentsCol.records,
      nameOf: (type, id) => names[type].get(id) ?? '',
    };
  }, [
    settingsCol.records,
    settingsCol.loading,
    usersCol.records,
    userId,
    meta,
    refreshMeta,
    dimVals.records,
    franchisesCol.records,
    titlesCol.records,
    charactersCol.records,
    talentsCol.records,
  ]);

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
  const reload = useCallback(() => setTick((x) => ({ n: x.n + 1, silent: false })), []);
  const refresh = useCallback(() => setTick((x) => ({ n: x.n + 1, silent: true })), []);
  return { data, loading, error, reload, refresh };
}
