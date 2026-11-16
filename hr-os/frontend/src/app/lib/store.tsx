/**
 * Per-viewer conveniences, kept in this browser: "Hide pay" (blanks every
 * money figure for screen sharing), the sidebar rail, and the selected legal
 * entity (pages that work per entity read it; '' means all entities).
 *
 *   const { hidePay, entity } = useUi();
 *   setUi({ hidePay: true });
 */
import { useSyncExternalStore } from 'react';

export interface Ui {
  hidePay: boolean;
  rail: boolean;
  /** The selected entity id ('' = all the member may see). */
  entity: string;
}

const KEY = 'hr.ui';

function load(): Ui {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) {
      const v = JSON.parse(raw) as Partial<Ui>;
      return { hidePay: v.hidePay === true, rail: v.rail === true, entity: typeof v.entity === 'string' ? v.entity : '' };
    }
  } catch {
    /* a convenience */
  }
  return { hidePay: false, rail: false, entity: '' };
}

let ui: Ui = load();
const subs = new Set<() => void>();

export function setUi(patch: Partial<Ui>): void {
  ui = { ...ui, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ui));
  } catch {
    /* a convenience */
  }
  for (const fn of subs) fn();
}

export function getUi(): Ui {
  return ui;
}

export function useUi(): Ui {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => ui,
  );
}
