/** App-wide live data every page needs: settings, categories, locations and suppliers. */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { useLive } from './live.ts';
import type { Category, LocationNode, Settings, Supplier } from './types.ts';

export interface FlatLocation {
  id: string;
  name: string;
  code: string;
  kind: LocationNode['kind'];
  path: string;
  depth: number;
  parent: string | null;
  units: number;
  items: number;
  hasChildren: boolean;
}

interface AppData {
  settings: Settings | null;
  currency: string;
  categories: Category[];
  icons: string[];
  categoryById: Map<string, Category>;
  tree: LocationNode[];
  /** Every location in tree order (parents before their children). */
  locations: FlatLocation[];
  locationById: Map<string, FlatLocation>;
  suppliers: Supplier[];
  ready: boolean;
}

const Ctx = createContext<AppData | null>(null);

function flatten(nodes: LocationNode[], out: FlatLocation[]): FlatLocation[] {
  for (const n of nodes) {
    out.push({
      id: n.id,
      name: n.name,
      code: n.code,
      kind: n.kind,
      path: n.path,
      depth: n.depth,
      parent: n.parent,
      units: n.total.units,
      items: n.total.items,
      hasChildren: n.children.length > 0,
    });
    flatten(n.children, out);
  }
  return out;
}

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useLive(() => api.settings(), ['settings'], []);
  const cats = useLive(() => api.categories(), ['categories', 'items'], []);
  const locs = useLive(() => api.locations(), ['locations', 'stock'], []);
  const sups = useLive(() => api.suppliers(), ['suppliers', 'items', 'orders'], []);
  const value = useMemo<AppData>(() => {
    const categories = cats.data?.categories ?? [];
    const tree = locs.data?.tree ?? [];
    const flat = flatten(tree, []);
    return {
      settings: settings.data,
      currency: settings.data?.currency ?? 'USD',
      categories,
      icons: cats.data?.icons ?? [],
      categoryById: new Map(categories.map((c) => [c.id, c])),
      tree,
      locations: flat,
      locationById: new Map(flat.map((l) => [l.id, l])),
      suppliers: sups.data?.suppliers ?? [],
      ready: settings.data !== null && cats.data !== null && locs.data !== null && sups.data !== null,
    };
  }, [settings.data, cats.data, locs.data, sups.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp outside AppDataProvider');
  return v;
}
