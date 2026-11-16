/**
 * All copy goes through t('key'). English is the only catalog in v1; each
 * module ships its own `i18n/<module>.en.ts` exporting a flat object of
 * dotted keys, and this file loads every one of them at build time:
 *
 *   // i18n/leave.en.ts
 *   export default { 'leave.title': 'Leave', 'leave.days': '{n} days' } as const;
 *
 *   t('leave.days', { n: 3 })            -> "3 days"
 *   tn('people.count', 1)                 -> uses 'people.count.one' or '.other'
 *
 * A missing key shows the key itself (and a console warning in dev), so a
 * typo is visible on screen instead of silently blank.
 */

type Catalog = Record<string, string>;

const files = import.meta.glob<{ default: Catalog }>('../i18n/*.en.ts', { eager: true });

const EN: Catalog = {};
for (const mod of Object.values(files)) Object.assign(EN, mod.default);

export type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars): string {
  if (vars === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m));
}

export function t(key: string, vars?: Vars): string {
  const text = EN[key];
  if (text === undefined) {
    if (import.meta.env.DEV) console.warn('[i18n] missing key', key);
    return key;
  }
  return fill(text, vars);
}

/** A counted phrase: `key.one` for 1, `key.other` otherwise; `{n}` is the count. */
export function tn(key: string, n: number, vars?: Vars): string {
  const one = EN[`${key}.one`];
  const other = EN[`${key}.other`];
  const text = n === 1 && one !== undefined ? one : (other ?? one);
  if (text === undefined) return t(key, { n, ...vars });
  return fill(text, { n, ...vars });
}

/** True when a key exists (optional copy, such as a hint). */
export function has(key: string): boolean {
  return EN[key] !== undefined;
}
