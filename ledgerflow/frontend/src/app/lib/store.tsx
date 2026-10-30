/**
 * App-wide state: settings, the chart of accounts, tax codes, contacts and
 * the books summary, each kept live (realtime) so what the AI agent changes
 * through the CLI shows at once. Views load their own lists with useLive.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.ts';
import { setCurrencies } from './format.ts';
import { useLive } from './live.ts';
import type { Account, Contact, Currency, Region, Settings, Summary, TaxCode } from './types.ts';

export interface AppState {
  ready: boolean;
  settings: Settings | null;
  regions: Region[];
  currencies: Currency[];
  accounts: Account[];
  allAccounts: Account[];
  taxCodes: TaxCode[];
  contacts: Contact[];
  summary: Summary | null;
  home: string;
  account: (id: string | undefined) => Account | undefined;
  accountName: (id: string | undefined) => string;
  taxName: (id: string | undefined) => string;
  contactName: (id: string | undefined) => string;
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
  const accounts = useLive(() => api.accounts({ archived: true }), ['accounts', 'postings', 'statement_lines'], [], 400);
  const taxes = useLive(() => api.taxCodes(true), ['tax_codes'], []);
  const contacts = useLive(() => api.contacts({ archived: true }), ['contacts', 'documents', 'allocations'], [], 400);
  const summary = useLive(() => api.summary(), ['transactions', 'postings', 'statement_lines', 'documents', 'allocations', 'files', 'settings'], [], 600);

  const settings = setup.data?.settings ?? null;
  const home = settings?.home_currency ?? 'USD';
  const currencies = useMemo(() => setup.data?.currencies ?? [], [setup.data]);
  useMemo(() => setCurrencies(currencies, home), [currencies, home]);

  const allAccounts = useMemo(() => accounts.data?.accounts ?? [], [accounts.data]);
  const active = useMemo(() => allAccounts.filter((a) => !a.archived), [allAccounts]);
  const byId = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);
  const taxList = useMemo(() => taxes.data?.tax_codes ?? [], [taxes.data]);
  const taxById = useMemo(() => new Map(taxList.map((t) => [t.id, t])), [taxList]);
  const contactList = useMemo(() => contacts.data?.contacts ?? [], [contacts.data]);
  const contactById = useMemo(() => new Map(contactList.map((c) => [c.id, c])), [contactList]);

  const reloads = useRef<(() => void)[]>([]);
  reloads.current = [setup.reload, accounts.reload, taxes.reload, contacts.reload, summary.reload];
  const reloadAll = useCallback(() => {
    for (const r of reloads.current) r();
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready: setup.data !== null,
      settings,
      regions: setup.data?.regions ?? [],
      currencies,
      accounts: active.filter((a) => !a.archived),
      allAccounts,
      taxCodes: taxList.filter((t) => !t.archived),
      contacts: contactList.filter((c) => !c.archived),
      summary: summary.data,
      home,
      account: (id) => (id === undefined ? undefined : byId.get(id)),
      accountName: (id) => {
        const a = id === undefined ? undefined : byId.get(id);
        return a === undefined ? '' : a.name;
      },
      taxName: (id) => (id === undefined || id === '' ? '' : (taxById.get(id)?.code ?? '')),
      contactName: (id) => (id === undefined || id === '' ? '' : (contactById.get(id)?.name ?? '')),
      reloadAll,
    }),
    [setup.data, settings, currencies, active, allAccounts, taxList, contactList, summary.data, home, byId, taxById, contactById, reloadAll],
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
