/**
 * The organisation lists people pages pick from (departments, locations,
 * titles, grades, employment types, cost centres), each one live view, plus
 * helpers that turn them into Picker items.
 */
import type { PickItem } from '../../components/ui.tsx';
import { useOp } from '../../lib/live.ts';
import type { Live } from '../../lib/live.ts';
import type { Department, OrgItem } from './types.ts';

export type OrgKind = 'departments' | 'locations' | 'titles' | 'grades' | 'employment-types' | 'cost-centers';

const READS: Record<OrgKind, string> = {
  departments: 'departments',
  locations: 'locations',
  titles: 'job_titles',
  grades: 'grades',
  'employment-types': 'employment_types',
  'cost-centers': 'cost_centers',
};

/** The answer key of each list operation. */
export const LIST_KEY: Record<OrgKind, string> = {
  departments: 'departments',
  locations: 'locations',
  titles: 'titles',
  grades: 'grades',
  'employment-types': 'employment_types',
  'cost-centers': 'cost_centers',
};

export function useOrgList<T extends OrgItem = OrgItem>(kind: OrgKind, entity = ''): { items: T[] | null; live: Live<Record<string, T[]>> } {
  const live = useOp<Record<string, T[]>>(`${kind}.list`, entity !== '' ? { entity } : {}, [READS[kind]], { name: `org.${kind}` });
  return { items: live.data === null ? null : (live.data[LIST_KEY[kind]] ?? []), live };
}

export function useDepartments(entity = ''): Department[] | null {
  return useOrgList<Department & OrgItem>('departments', entity).items;
}

export function pickItems(list: OrgItem[] | null, sub?: (x: OrgItem) => string): PickItem[] {
  return (list ?? []).map((x) => ({ value: x.id, label: String(x.name ?? x.code ?? ''), sub: sub?.(x) }));
}

/** Departments as an indented outline (parents first), for pickers and trees. */
export function departmentOutline(list: Department[]): { dept: Department; depth: number }[] {
  const kids = new Map<string, Department[]>();
  const ids = new Set(list.map((d) => d.id));
  for (const d of list) {
    const p = d.parent !== '' && ids.has(d.parent) ? d.parent : '';
    const arr = kids.get(p) ?? [];
    arr.push(d);
    kids.set(p, arr);
  }
  const out: { dept: Department; depth: number }[] = [];
  const walk = (parent: string, depth: number, seen: Set<string>): void => {
    for (const d of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ dept: d, depth });
      walk(d.id, depth + 1, seen);
    }
  };
  walk('', 0, new Set());
  return out;
}
