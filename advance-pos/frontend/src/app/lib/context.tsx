/**
 * What every screen of a signed-in register reads: the store's settings,
 * the catalog the register sells from, and today's status (for the counts
 * on the rail). All three stay live: a price changed on another register or
 * by your AI agent reaches this one within a moment.
 */
import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { money } from './format.ts';
import type { Money } from './format.ts';
import { useLive } from './live.ts';
import { useSession } from './session.tsx';
import type { AppStatus, Product, RegisterCatalog, Settings, Variant } from './types.ts';

export interface StoreValue {
  ready: boolean;
  settings: Settings | null;
  catalog: RegisterCatalog | null;
  status: AppStatus | null;
  money: Money;
  /** Products by id, and each variant with its product, for the sell screen. */
  productById: Map<string, Product>;
  variantById: Map<string, { product: Product; variant: Variant }>;
  reloadSettings: () => void;
  reloadCatalog: () => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useStore outside StoreProvider');
  return v;
}

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { setup, setIdleMinutes } = useSession();
  const settings = useLive(() => api.settings(), ['settings', 'taxes'], []);
  const catalog = useLive(() => api.catalog(), ['products', 'variants', 'categories', 'modifier_groups', 'taxes'], [], 250);
  const status = useLive(() => api.status({ quiet: true }), ['orders', 'requests', 'variants', 'shifts'], [], 600);

  useEffect(() => {
    if (settings.data !== null) setIdleMinutes(settings.data.lock_idle_minutes);
  }, [settings.data, setIdleMinutes]);

  const value = useMemo<StoreValue>(() => {
    const s = settings.data;
    const m = money(s?.currency ?? setup?.currency ?? 'USD', s?.currency_digits ?? setup?.currency_digits ?? 2);
    const productById = new Map<string, Product>();
    const variantById = new Map<string, { product: Product; variant: Variant }>();
    for (const p of catalog.data?.products ?? []) {
      productById.set(p.id, p);
      for (const v of p.variants) variantById.set(v.id, { product: p, variant: v });
    }
    return {
      ready: s !== null && catalog.data !== null,
      settings: s,
      catalog: catalog.data,
      status: status.data,
      money: m,
      productById,
      variantById,
      reloadSettings: settings.reload,
      reloadCatalog: catalog.reload,
    };
  }, [settings.data, settings.reload, catalog.data, catalog.reload, status.data, setup]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
