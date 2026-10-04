/**
 * Page-local helpers for the work pages (Today, Inbox, Deadlines): a live
 * "latest N records" hook, a live single-record hook that resets cleanly
 * when the id changes, deadline subject titles from expanded relations,
 * silent hash updates, and a plain date field.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import { cn, getPbClient } from '../../kit/index.ts';
import { parseHash } from '../lib/router.ts';
import type { AgreementRec, DeadlineRec, DisclosureRec, MatterRec, WorkRec } from '../lib/types.ts';
import { Field } from './ui.tsx';

/** Relations expanded on deadline lists so rows can name their subject. */
export const DEADLINE_EXPAND = 'matter,agreement,work,disclosure';

interface DeadlineExpand {
  matter?: MatterRec | undefined;
  agreement?: AgreementRec | undefined;
  work?: WorkRec | undefined;
  disclosure?: DisclosureRec | undefined;
}

/** Title of the record a deadline belongs to (from the expanded relation). */
export function subjectTitle(d: DeadlineRec): string {
  const ex = d.expand as DeadlineExpand | undefined;
  return ex?.matter?.title ?? ex?.agreement?.title ?? ex?.work?.title ?? ex?.disclosure?.title ?? '';
}

/** Error text from an Error, a normalized PocketBase error, or anything else. */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
  }
  return 'Something went wrong. Try again.';
}

/**
 * Replace the page hash without notifying the router (no remount, no
 * history entry). Used for selections that should survive a reload.
 */
export function replaceHashSilently(hash: string): void {
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
}

/** Current hash params (live read, not router state). */
export function currentHashParams(): URLSearchParams {
  return parseHash(window.location.hash).params;
}

/** The latest `limit` records of a collection, refreshed on realtime events. */
export function useLatest<T extends RecordModel>(
  collection: string,
  limit: number,
  opts: { filter?: string | undefined; sort?: string | undefined; enabled?: boolean | undefined },
): { records: T[]; loading: boolean; error: string | null } {
  const { filter, sort, enabled = true } = opts;
  const [records, setRecords] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRecords([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let unsub: UnsubscribeFunc | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (): void => {
      const o: Record<string, string> = {};
      if (filter !== undefined && filter !== '') o['filter'] = filter;
      if (sort !== undefined && sort !== '') o['sort'] = sort;
      getPbClient()
        .call((p) => p.collection(collection).getList<T>(1, limit, o), { silent: true })
        .then((r) => {
          if (cancelled) return;
          setRecords(r.items);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(errMsg(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    getPbClient()
      .call(
        (p) =>
          p.collection(collection).subscribe('*', () => {
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
  }, [collection, limit, filter, sort, enabled]);

  return { records, loading, error };
}

/** One record kept live; state never leaks from a previous id. */
export function useLiveRecord<T extends RecordModel>(
  collection: string,
  id: string,
): { record: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [state, setState] = useState<{ id: string; record: T | null; error: string | null; loaded: boolean }>({
    id: '',
    record: null,
    error: null,
    loaded: false,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (id === '') {
      setState({ id: '', record: null, error: null, loaded: true });
      return;
    }
    let cancelled = false;
    let unsub: UnsubscribeFunc | null = null;
    setState((s) => (s.id === id ? s : { id, record: null, error: null, loaded: false }));
    getPbClient()
      .call((p) => p.collection(collection).getOne<T>(id), { silent: true })
      .then((r) => {
        if (!cancelled) setState({ id, record: r, error: null, loaded: true });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ id, record: null, error: errMsg(e), loaded: true });
      });
    getPbClient()
      .call(
        (p) =>
          p.collection(collection).subscribe<T>(id, (ev) => {
            if (cancelled) return;
            if (ev.action === 'delete') setState({ id, record: null, error: 'This item no longer exists.', loaded: true });
            else setState({ id, record: ev.record, error: null, loaded: true });
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
      if (unsub !== null) void unsub();
    };
  }, [collection, id, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const mine = state.id === id;
  return {
    record: mine ? state.record : null,
    loading: !mine || !state.loaded,
    error: mine ? state.error : null,
    refresh,
  };
}

export const DATE_INPUT_CLS =
  'h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm tabular-nums disabled:opacity-60';

/** Labelled native date input (value "YYYY-MM-DD"). */
export function DateField({
  label,
  value,
  onChange,
  required,
  help,
  error,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean | undefined;
  help?: ReactNode | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <Field label={label} required={required} help={help} error={error}>
      <input
        type="date"
        aria-label={label}
        className={cn(DATE_INPUT_CLS, className)}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Small uppercase heading used inside detail panes. */
export function PaneHeading({ children, right }: { children: ReactNode; right?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h3>
      {right}
    </div>
  );
}
