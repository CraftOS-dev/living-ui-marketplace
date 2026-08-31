/**
 * Company-level hooks: the singleton company record, its vocabulary pack,
 * and the module activation map. All realtime via the kit's useCollection.
 */
import { useEffect, useState } from 'react';
import { getPbClient, useCollection } from '../../kit/index.ts';
import type { Company, ModuleKey, ModuleRow, Vocab } from './types.ts';
import { DEFAULT_VOCAB } from './types.ts';
import { MODULES_CHANGED_EVENT } from './moduleEvents.ts';

export interface CompanyState {
  company: Company | null;
  vocab: Vocab;
  loading: boolean;
  error: string | null;
}

export function useCompany(): CompanyState {
  const { records, loading, error } = useCollection<Company>('company');
  const company = records.length > 0 ? (records[0] ?? null) : null;
  const vocab: Vocab =
    company !== null && company.vocab !== null && typeof company.vocab === 'object'
      ? { ...DEFAULT_VOCAB, ...company.vocab }
      : DEFAULT_VOCAB;
  return { company, vocab, loading, error };
}

export interface ModulesState {
  modules: ModuleRow[];
  activeKeys: ReadonlySet<ModuleKey>;
  suggestedKeys: ReadonlySet<ModuleKey>;
  loading: boolean;
}

export function useModules(): ModulesState {
  const { records, loading } = useCollection<ModuleRow>('modules', { sort: 'key' });
  const [modules, setModules] = useState<ModuleRow[]>(records);

  useEffect(() => {
    setModules(records);
  }, [records]);

  useEffect(() => {
    let cancelled = false;

    const refresh = (): void => {
      void getPbClient()
        .call((pb) => pb.collection('modules').getFullList<ModuleRow>({ sort: 'key' }))
        .then((rows) => {
          if (!cancelled) setModules(rows);
        })
        .catch(() => undefined);
    };

    window.addEventListener(MODULES_CHANGED_EVENT, refresh as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(MODULES_CHANGED_EVENT, refresh as EventListener);
    };
  }, []);

  const activeKeys = new Set<ModuleKey>();
  const suggestedKeys = new Set<ModuleKey>();
  for (const row of modules) {
    if (row.active) activeKeys.add(row.key);
    else if (row.suggested) suggestedKeys.add(row.key);
  }
  return { modules, activeKeys, suggestedKeys, loading };
}

/** Monday of the week containing `d`, as YYYY-MM-DD. */
export function weekStart(d: Date): string {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - day);
  return copy.toISOString().slice(0, 10);
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentQuarter(): string {
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
}

export function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
