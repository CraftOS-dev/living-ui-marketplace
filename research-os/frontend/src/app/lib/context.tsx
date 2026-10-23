/**
 * What every screen reads: settings (highlight colors and meanings, the
 * citation style), the frame's counts, collections, tags and projects. All
 * live: they follow changes made anywhere.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { op } from './api.ts';
import { useLive } from './live.ts';
import type { AppStatus, CollectionRow, Project, Settings, Slot, TagRow } from './types.ts';

interface AppData {
  ready: boolean;
  settings: Settings | null;
  status: AppStatus | null;
  collections: CollectionRow[];
  tags: TagRow[];
  projects: Project[];
  slot: (n: number) => Slot;
  reloadAll: () => void;
}

const Ctx = createContext<AppData | null>(null);

const FALLBACK: Slot[] = [
  { slot: 1, hue: 'yellow', meaning: 'Key point' },
  { slot: 2, hue: 'red', meaning: 'Disagree' },
  { slot: 3, hue: 'green', meaning: 'Result' },
  { slot: 4, hue: 'blue', meaning: 'Method' },
  { slot: 5, hue: 'violet', meaning: 'Question' },
  { slot: 6, hue: 'orange', meaning: 'Follow up' },
  { slot: 7, hue: 'teal', meaning: 'Definition' },
  { slot: 8, hue: 'gray', meaning: 'Background' },
];

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useLive((signal) => op<{ settings: Settings }>('settings.get', {}, { quiet: true, signal }).then((r) => r.settings), ['settings'], []);
  const status = useLive((signal) => op<AppStatus>('app.status', {}, { quiet: true, signal }), ['works', 'files', 'nodes', 'relations', 'proposals', 'notes', 'candidates', 'ms_changes', 'response_items', 'projects', 'asks'], [], 400);
  const collections = useLive((signal) => op<{ collections: CollectionRow[] }>('collections.list', {}, { quiet: true, signal }).then((r) => r.collections), ['collections', 'collection_items', 'works'], [], 300);
  const tags = useLive((signal) => op<{ tags: TagRow[] }>('tags.list', {}, { quiet: true, signal }).then((r) => r.tags), ['tags', 'work_tags', 'works'], [], 300);
  const projects = useLive((signal) => op<{ projects: Project[] }>('projects.list', { state: 'all' }, { quiet: true, signal }).then((r) => r.projects), ['projects', 'project_works', 'nodes', 'relations', 'boards', 'manuscripts', 'reviews', 'notes', 'tasks'], [], 400);
  const value = useMemo<AppData>(() => {
    const slots = settings.data?.highlight_slots ?? FALLBACK;
    return {
      ready: settings.data !== null || settings.error !== null,
      settings: settings.data,
      status: status.data,
      collections: collections.data ?? [],
      tags: tags.data ?? [],
      projects: projects.data ?? [],
      slot: (n: number) => slots.find((s) => s.slot === n) ?? (FALLBACK[0] as Slot),
      reloadAll: () => {
        settings.reload();
        status.reload();
        collections.reload();
        tags.reload();
        projects.reload();
      },
    };
  }, [settings, status, collections, tags, projects]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp outside AppDataProvider');
  return v;
}
