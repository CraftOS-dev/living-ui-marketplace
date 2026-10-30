/**
 * What every page shares: the settings, the platform catalog, the shops and
 * the attention counts (badges), each a live view that reloads when anything
 * it reads changes, whoever changed it. It also keeps the store's UTC offset
 * equal to this computer's clock, so reports count the seller's own days.
 */
import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { op } from './api.ts';
import { useLive } from './live.ts';
import type { Attention, Catalog, Platform, PlatformId, Settings, Shop } from './types.ts';

export interface StoreState {
  settings: Settings | null;
  catalog: Catalog | null;
  shops: Shop[];
  attention: Attention | null;
  error: string | null;
  platform: (id: PlatformId | string) => Platform | undefined;
  shop: (id: string) => Shop | undefined;
}

const Ctx = createContext<StoreState | null>(null);

/** Minutes east of UTC in an IANA time zone right now; the device's own when none is set or the name is unknown. */
function zoneOffset(zone: string): number {
  const now = new Date();
  if (zone !== '') {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(now);
      const part = (t: Intl.DateTimeFormatPartTypes): number => Number(parts.find((x) => x.type === t)?.value ?? 0);
      const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
      return Math.round((wall - (now.getTime() - (now.getTime() % 60000))) / 60000);
    } catch {
      /* unknown zone name: the device clock */
    }
  }
  return -now.getTimezoneOffset();
}

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useLive<{ settings: Settings }>('settings', (signal) => op('settings.get', {}, { signal, quiet: true }), ['settings']);
  const catalog = useLive<Catalog>('platforms', (signal) => op('platforms.list', {}, { signal, quiet: true }), []);
  const shops = useLive<{ shops: Shop[] }>('shops', (signal) => op('shops.list', {}, { signal, quiet: true }), ['shops', 'orders', 'threads', 'listings', 'tasks', 'settings']);
  const attention = useLive<Attention>('attention', (signal) => op('reports.attention', {}, { signal, quiet: true }), ['orders', 'threads', 'proposals', 'listings', 'products', 'variants', 'stock_moves', 'order_lines', 'shipments', 'tasks', 'shops', 'settings']);
  const s = settings.data?.settings ?? null;
  // Reports count days in the store's time zone: keep its offset (the server has no zone table) current.
  const zone = s?.timezone ?? null;
  const stored = s?.utc_offset ?? null;
  useEffect(() => {
    if (zone === null || stored === null) return;
    const offset = zoneOffset(zone);
    if (stored !== offset) void op('settings.update', { utc_offset: offset }, { quiet: true }).catch(() => undefined);
  }, [zone, stored]);
  const list = shops.data?.shops ?? [];
  const cat = catalog.data;
  const value: StoreState = {
    settings: s,
    catalog: cat,
    shops: list,
    attention: attention.data,
    error: settings.error ?? shops.error,
    platform: (id) => cat?.platforms.find((p) => p.id === id),
    shop: (id) => list.find((x) => x.id === id),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreState {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useStore outside StoreProvider');
  return v;
}

/** The base currency ('' until the store is set up). */
export function useBase(): string {
  return useStore().settings?.base_currency ?? '';
}
