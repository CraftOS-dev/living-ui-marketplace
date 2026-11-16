/**
 * Per-viewer conveniences kept in this browser: the sidebar rail and the
 * fund scope ('' = all funds the member may see). Never data that must
 * persist: that goes through operations.
 *
 *   const { fund, rail } = useUi();
 *   setUi({ fund: id });
 */
import { useSyncExternalStore } from 'react';

export interface Ui {
  /** The sidebar is folded to its icon rail by the viewer. */
  rail: boolean;
  /** The selected fund id ('' = all funds). */
  fund: string;
}

const KEY = 'vo.ui';

function load(): Ui {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) {
      const v = JSON.parse(raw) as Partial<Ui>;
      return { rail: v.rail === true, fund: typeof v.fund === 'string' ? v.fund : '' };
    }
  } catch {
    /* a convenience */
  }
  return { rail: false, fund: '' };
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

/** A remembered small value per key (a tab, a view), read and written safely. */
export function remember<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem('vo.v.' + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function keep(key: string, value: unknown): void {
  try {
    window.localStorage.setItem('vo.v.' + key, JSON.stringify(value));
  } catch {
    /* a convenience */
  }
}
