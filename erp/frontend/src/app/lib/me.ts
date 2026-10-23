/**
 * The signed-in person and what their role lets them do. Screens hide what
 * a role cannot use (the server refuses it anyway): a menu entry, a button,
 * a column of figures.
 *
 *   const me = useMe();
 *   if (can(me, 'sales', 'edit')) ...
 */
import type { Level, Me, Module } from './types.ts';
import { useSession } from './session.ts';

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, full: 3 };

export function useMe(): Me {
  const s = useSession();
  if (s.me === null) throw new Error('useMe outside a signed-in screen');
  return s.me;
}

/** The module is switched on and the role reaches `need` in it. */
export function can(me: Me, module: Module, need: Level = 'view'): boolean {
  if (module !== 'reports' && me.modules[module] === false) return false;
  return RANK[me.levels[module] ?? 'none'] >= RANK[need];
}

/** The module is switched on for the company (whatever the role). */
export function moduleOn(me: Me, module: Module): boolean {
  return me.modules[module] !== false;
}

/** The base currency. */
export function baseCurrency(me: Me): string {
  return me.company.currency;
}

/** Which module a document type belongs to, and the level to see or change it. */
export function docModule(type: string): Module {
  switch (type) {
    case 'quote':
    case 'sales_order':
    case 'invoice':
    case 'credit_note':
    case 'delivery':
      return 'sales';
    default:
      return 'purchasing';
  }
}
