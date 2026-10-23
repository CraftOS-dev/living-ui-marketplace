/**
 * App-wide live data every screen needs: settings, the catalog the register
 * sells from, tax classes, payment methods, registers, staff and the counts
 * the rail and the register show (open tickets, drafts, kitchen, low stock).
 * Each part reloads itself when its collections change (another register,
 * your AI agent, the back office), once for the whole page.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { useLive } from './live.ts';
import type { AppStatus, Catalog, CatalogProduct, Category, ModifierGroup, Register, Settings, Staff, TaxClass, Tender } from './types.ts';

interface AppData {
  settings: Settings | null;
  currency: string;
  exp: number;
  catalog: Catalog | null;
  productById: Map<string, CatalogProduct>;
  categoryById: Map<string, Category>;
  groupById: Map<string, ModifierGroup>;
  taxes: TaxClass[];
  taxById: Map<string, TaxClass>;
  tenders: Tender[];
  registers: Register[];
  staff: Staff[];
  status: AppStatus | null;
  ready: boolean;
  reloadAll: () => void;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const settings = useLive(() => api.settings(), ['settings'], []);
  const catalog = useLive(() => api.catalog(), ['products', 'variants', 'codes', 'categories', 'modifier_groups', 'modifiers', 'discounts', 'stock'], []);
  const taxes = useLive(() => api.taxes(true), ['tax_classes'], []);
  const tenders = useLive(() => api.tenders(false), ['tenders'], []);
  const registers = useLive(() => api.registers(false), ['registers', 'shifts'], []);
  const staff = useLive(() => api.staff(false), ['staff'], []);
  const status = useLive(() => api.status(), ['carts', 'products', 'imports', 'tickets', 'stock'], []);
  const value = useMemo<AppData>(() => {
    const cat = catalog.data;
    const taxList = taxes.data?.tax_classes ?? [];
    return {
      settings: settings.data,
      currency: settings.data?.currency ?? 'USD',
      exp: settings.data?.currency_decimals ?? 2,
      catalog: cat,
      productById: new Map((cat?.products ?? []).map((p) => [p.id, p])),
      categoryById: new Map((cat?.categories ?? []).map((c) => [c.id, c])),
      groupById: new Map((cat?.groups ?? []).map((g) => [g.id, g])),
      taxes: taxList,
      taxById: new Map(taxList.map((t) => [t.id, t])),
      tenders: tenders.data?.tenders ?? [],
      registers: registers.data?.registers ?? [],
      staff: staff.data?.staff ?? [],
      status: status.data,
      ready: settings.data !== null && catalog.data !== null && taxes.data !== null && tenders.data !== null && registers.data !== null && staff.data !== null,
      reloadAll: () => {
        settings.reload();
        catalog.reload();
        taxes.reload();
        tenders.reload();
        registers.reload();
        staff.reload();
        status.reload();
      },
    };
    // The reload functions are stable per loader; the data objects drive the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data, catalog.data, taxes.data, tenders.data, registers.data, staff.data, status.data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useApp outside AppDataProvider');
  return v;
}
