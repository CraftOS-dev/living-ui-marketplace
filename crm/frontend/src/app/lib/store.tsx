/**
 * App-wide state: settings, pipelines with their stages, lists, custom
 * fields, saved views and the counts behind the badges, each kept live
 * (realtime) so what the AI agent changes through the CLI shows at once.
 * Views load their own rows with useLive.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { setCurrencies } from './format.ts';
import { useLive } from './live.ts';
import type { Currency, FieldDef, ListRec, Obj, Pipeline, Settings, Stage, Summary, Template, ViewRec } from './types.ts';

export interface AppState {
  ready: boolean;
  settings: Settings | null;
  currencies: Currency[];
  templates: Template[];
  pipelines: Pipeline[];
  lists: ListRec[];
  fields: FieldDef[];
  views: ViewRec[];
  summary: Summary | null;
  home: string;
  pipeline: (id: string | undefined) => Pipeline | undefined;
  stage: (id: string | undefined) => Stage | undefined;
  fieldsOf: (o: Obj) => FieldDef[];
  reloadAll: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const setup = useLive(() => api.setup(), ['settings'], []);
  const pipes = useLive(() => api.pipelines(), ['pipelines', 'stages', 'deals'], [], 500);
  const lists = useLive(() => api.lists(), ['lists', 'list_entries'], [], 400);
  const fields = useLive(() => api.fields(), ['fields'], []);
  const views = useLive(() => api.views(), ['views'], []);
  const summary = useLive(() => api.summary(), ['proposals', 'tasks', 'people', 'companies', 'deals', 'interactions', 'emails', 'asks'], [], 600);

  const settings = setup.data?.settings ?? null;
  const home = settings?.home_currency ?? 'USD';
  const currencies = useMemo(() => setup.data?.currencies ?? [], [setup.data]);
  useMemo(() => setCurrencies(currencies, home), [currencies, home]);

  const pipelineList = useMemo(() => pipes.data?.pipelines ?? [], [pipes.data]);
  const pById = useMemo(() => new Map(pipelineList.map((p) => [p.id, p])), [pipelineList]);
  const sById = useMemo(() => new Map(pipelineList.flatMap((p) => p.stages.map((s) => [s.id, s] as const))), [pipelineList]);
  const fieldList = useMemo(() => fields.data?.fields ?? [], [fields.data]);

  const reloads = useRef<(() => void)[]>([]);
  reloads.current = [setup.reload, pipes.reload, lists.reload, fields.reload, views.reload, summary.reload];
  const reloadAll = useCallback(() => {
    for (const r of reloads.current) r();
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready: setup.data !== null,
      settings,
      currencies,
      templates: setup.data?.templates ?? [],
      pipelines: pipelineList,
      lists: lists.data?.lists ?? [],
      fields: fieldList,
      views: views.data?.views ?? [],
      summary: summary.data,
      home,
      pipeline: (id) => (id === undefined ? undefined : pById.get(id)),
      stage: (id) => (id === undefined ? undefined : sById.get(id)),
      fieldsOf: (o) => fieldList.filter((f) => f.object === o),
      reloadAll,
    }),
    [setup.data, settings, currencies, pipelineList, lists.data, fieldList, views.data, summary.data, home, pById, sById, reloadAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Tell the server what is on screen (app.context for the AI agent):
 * debounced, and only when it changes.
 */
export function useReportScreen(view: string, selection: { type: string; id: string } | null, filters?: Record<string, unknown>): void {
  const key = JSON.stringify([view, selection, filters ?? {}]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.ui({ view, selection, filters: filters ?? {} }).catch(() => undefined);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
