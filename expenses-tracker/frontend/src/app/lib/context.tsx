/** App-wide live data every page needs: settings (currency, budget) and categories. */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { useLive } from './live.ts';
import { decimalsOf } from './money.ts';
import type { Category, Settings } from './types.ts';

interface AppData {
  settings: Settings | null;
  currency: string;
  decimals: number;
  categories: Category[];
  /** Categories ordered for quick picking: most used lately first. */
  byUse: Category[];
  categoryById: Map<string, Category>;
  ready: boolean;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useLive(() => api.settings(), ['settings'], []);
  const cats = useLive(() => api.categories(), ['categories', 'expenses'], []);
  const value = useMemo<AppData>(() => {
    const currency = settings.data?.currency ?? 'USD';
    const categories = cats.data?.categories ?? [];
    const byUse = [...categories].sort((a, b) => b.recent_count - a.recent_count || b.count - a.count || a.sort - b.sort);
    return {
      settings: settings.data,
      currency,
      decimals: decimalsOf(currency),
      categories,
      byUse,
      categoryById: new Map(categories.map((c) => [c.id, c])),
      ready: settings.data !== null && cats.data !== null,
    };
  }, [settings.data, cats.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp outside AppDataProvider');
  return v;
}
