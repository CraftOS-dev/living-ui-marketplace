/**
 * Helpers for the work pages (Today, Inbox, Deadlines, Reports): silent
 * hash updates (selection and filters that survive a reload without
 * remounting the page), one live record, record types for pickers and
 * links, loose JSON readers for proposal data, and small form pieces.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import { Select, cn, getPbClient } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { t, tf } from '../lib/i18n.ts';
import { parseHash } from '../lib/router.ts';
import type { ModuleKey } from '../lib/shapes.ts';
import { RecordPicker } from './pickers.tsx';
import { Field } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Hash                                                                */
/* ------------------------------------------------------------------ */

/** Replace the address without telling the router (no remount, no history entry). */
export function replaceHashSilently(hash: string): void {
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
}

/** "#/page/id?current=params" with the params already in the address. */
export function hashWithId(page: string, id: string): string {
  const p = parseHash(window.location.hash).params.toString();
  const base = `#/${page}${id !== '' ? `/${encodeURIComponent(id)}` : ''}`;
  return p !== '' ? `${base}?${p}` : base;
}

/**
 * A query param kept in local state and written to the address silently,
 * so it survives a reload but never remounts the page (used where the page
 * also changes its id silently, like the Inbox selection).
 */
export function useSilentParam(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => parseHash(window.location.hash).params.get(key) ?? fallback);
  const set = useCallback(
    (v: string) => {
      setValue(v);
      const r = parseHash(window.location.hash);
      const p = new URLSearchParams(r.params);
      if (v === fallback || v === '') p.delete(key);
      else p.set(key, v);
      const qs = p.toString();
      const base = `#/${r.page}${r.id !== '' ? `/${encodeURIComponent(r.id)}` : ''}`;
      replaceHashSilently(qs !== '' ? `${base}?${qs}` : base);
    },
    [key, fallback],
  );
  return [value, set];
}

/* ------------------------------------------------------------------ */
/* Errors and one live record                                          */
/* ------------------------------------------------------------------ */

/** Message of an Error, a normalized PocketBase error, or anything else. */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  return t('Something went wrong');
}

/**
 * One record kept current: realtime changes to it (by anyone, including
 * CraftBot) reload it with its expand. State never leaks from a previous id.
 */
export function useLiveRecord<T extends RecordModel>(
  collection: string,
  id: string,
  expand?: string | undefined,
): { record: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [state, setState] = useState<{ id: string; record: T | null; error: string | null; loaded: boolean }>({ id: '', record: null, error: null, loaded: false });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (id === '') {
      setState({ id: '', record: null, error: null, loaded: true });
      return;
    }
    let cancelled = false;
    let unsub: UnsubscribeFunc | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (): void => {
      getPbClient()
        .call((p) => p.collection(collection).getOne<T>(id, expand !== undefined && expand !== '' ? { expand } : undefined), { silent: true })
        .then((r) => {
          if (!cancelled) setState({ id, record: r, error: null, loaded: true });
        })
        .catch((e: unknown) => {
          if (!cancelled) setState({ id, record: null, error: errMsg(e), loaded: true });
        });
    };
    setState((s) => (s.id === id ? s : { id, record: null, error: null, loaded: false }));
    load();
    getPbClient()
      .call(
        (p) =>
          p.collection(collection).subscribe<T>(id, (ev) => {
            if (cancelled) return;
            if (ev.action === 'delete') {
              setState({ id, record: null, error: t('This record no longer exists.'), loaded: true });
              return;
            }
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(load, 150);
          }),
        { silent: true },
      )
      .then((fn) => {
        if (cancelled) void fn();
        else unsub = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      if (unsub !== null) void unsub();
    };
  }, [collection, id, expand, tick]);

  const refresh = useCallback(() => setTick((x) => x + 1), []);
  const mine = state.id === id;
  return { record: mine ? state.record : null, loading: !mine || !state.loaded, error: mine ? state.error : null, refresh };
}

/* ------------------------------------------------------------------ */
/* Loose JSON readers (proposal data written by CraftBot or offices)   */
/* ------------------------------------------------------------------ */

export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isInteger(n)) : [];
}

export function toggled<T>(set: Set<T>, v: T, on: boolean): Set<T> {
  const n = new Set(set);
  if (on) n.add(v);
  else n.delete(v);
  return n;
}

/** A field name written by an agent ("term_end") as plain words ("Term end"). */
export function humanField(f: string): string {
  const s = f.split('_').join(' ').trim();
  return s === '' ? '' : s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/* Record types                                                        */
/* ------------------------------------------------------------------ */

/** Record types a deadline or an Inbox proposal can be attached to by picking. */
export type PickType = 'matter' | 'agreement' | 'work' | 'character' | 'talent' | 'product' | 'committee' | 'case' | 'permission';

export const PICK_TYPES: readonly PickType[] = ['matter', 'agreement', 'work', 'character', 'talent', 'product', 'committee', 'case', 'permission'];

interface PickDef {
  collection: string;
  module: ModuleKey | null;
  search: string[];
}

const PICK: Record<PickType, PickDef> = {
  matter: { collection: 'matters', module: null, search: ['ref', 'title', 'application_no', 'registration_no'] },
  agreement: { collection: 'agreements', module: null, search: ['ref', 'title'] },
  work: { collection: 'titles', module: 'titles', search: ['title'] },
  character: { collection: 'characters', module: 'franchises', search: ['name'] },
  talent: { collection: 'talents', module: 'talents', search: ['stage_name'] },
  product: { collection: 'products', module: 'products', search: ['ref', 'name', 'sku', 'jan'] },
  committee: { collection: 'committees', module: 'committees', search: ['name'] },
  case: { collection: 'enforcement_cases', module: null, search: ['ref', 'title'] },
  permission: { collection: 'permissions', module: 'permissions', search: ['title', 'subject_name'] },
};

export function isPickType(v: string): v is PickType {
  return (PICK_TYPES as readonly string[]).includes(v);
}

/** "trademark" and "design" are matters. */
export function normSubjectType(v: string): string {
  return v === 'trademark' || v === 'design' ? 'matter' : v;
}

/** The module a record type belongs to (null: always on). */
export function pickModule(type: PickType): ModuleKey | null {
  return PICK[type].module;
}

/** Name of a record type, in the reader's language. */
export function subjectTypeLabel(type: string): string {
  switch (type) {
    case 'matter':
      return t('Trademark or design');
    case 'trademark':
      return t('Trademark');
    case 'design':
      return t('Design');
    case 'agreement':
      return t('Agreement');
    case 'work':
      return t('Title');
    case 'character':
      return t('Character');
    case 'talent':
      return t('Talent');
    case 'product':
      return t('Product');
    case 'approval':
      return t('Approval');
    case 'permission':
      return t('Permission');
    case 'committee':
      return t('Committee');
    case 'case':
      return t('Enforcement case');
    case 'registration':
      return t('Society registration');
    case 'claim':
      return t('Content ID claim');
    case 'recordation':
      return t('Customs recordation');
    case 'society_contract':
      return t('Society contract');
    case 'fan_registration':
      return t('Fan registration');
    case 'enrollment':
      return t('Platform enrollment');
    default:
      return humanField(type);
  }
}

/** How a record of a type is named in lists and links. */
export function recordLabel(type: string, rec: Record<string, unknown> | null | undefined): string {
  if (rec === null || rec === undefined) return '';
  const s = (k: string): string => (typeof rec[k] === 'string' ? (rec[k] as string) : '');
  const join = (...xs: string[]): string => xs.filter((x) => x !== '').join(' ');
  switch (normSubjectType(type)) {
    case 'matter':
    case 'agreement':
    case 'case':
      return join(s('ref'), s('title'));
    case 'work':
      return tf(rec, 'title');
    case 'character':
    case 'committee':
      return tf(rec, 'name');
    case 'talent':
      return s('stage_name');
    case 'product':
      return join(s('ref'), s('name'));
    case 'permission':
      return s('title');
    default:
      return s('title') || s('name');
  }
}

/**
 * Record type and record: a type select (types of switched-off modules are
 * hidden), then a searchable picker for that type.
 */
export function SubjectPicker({
  type,
  id,
  onChange,
  allowNone = false,
  types,
}: {
  type: PickType | '';
  id: string;
  onChange: (type: PickType | '', id: string) => void;
  allowNone?: boolean | undefined;
  types?: readonly PickType[] | undefined;
}): React.JSX.Element {
  const { on } = useApp();
  const list = (types ?? PICK_TYPES).filter((x) => {
    const m = PICK[x].module;
    return m === null || on(m) || x === type;
  });
  const options = list.map((x) => ({ value: x, label: subjectTypeLabel(x) }));
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <Select
        aria-label={t('Record type')}
        value={type}
        placeholder={allowNone ? t('No record') : undefined}
        options={options}
        onChange={(e) => {
          const v = e.target.value;
          onChange(isPickType(v) ? v : '', '');
        }}
      />
      {type !== '' ? (
        <RecordPicker<RecordModel>
          key={type}
          collection={PICK[type].collection}
          value={id}
          onChange={(nextId) => onChange(type, nextId)}
          labelOf={(r) => recordLabel(type, r) || r.id}
          searchFields={PICK[type].search}
          placeholder={t('Search by name or reference')}
        />
      ) : (
        <p className="self-center text-xs text-[var(--agent-app-muted)]">{t('Not linked to a record.')}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form pieces                                                         */
/* ------------------------------------------------------------------ */

export const DATE_INPUT_CLS =
  'h-9 w-full min-w-0 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm tabular-nums disabled:opacity-60';

/** Labelled native date input (value "YYYY-MM-DD"). */
export function DateField({
  label,
  value,
  onChange,
  required,
  help,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean | undefined;
  help?: ReactNode | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  return (
    <Field label={label} required={required} help={help} error={error}>
      <input type="date" aria-label={label} className={DATE_INPUT_CLS} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Small uppercase heading inside a detail pane. */
export function PaneHeading({ children, right, className }: { children: ReactNode; right?: ReactNode | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('mb-2 flex flex-wrap items-center justify-between gap-2', className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h3>
      {right}
    </div>
  );
}

/** Absolute address of a server path (the calendar feed). */
export function absoluteUrl(path: string): string {
  const base = getPbClient().pb.baseURL.replace(/\/$/, '');
  if (/^https?:\/\//.test(base)) return `${base}${path}`;
  return `${window.location.origin}${base}${path}`;
}
