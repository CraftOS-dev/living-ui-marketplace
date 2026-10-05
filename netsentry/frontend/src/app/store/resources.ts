/**
 * Reads, cached (v4 §17): an operation's answer (Home's overview, the change list, a graph's history,
 * a folder on the server…) is kept in the store under what was asked. Coming back shows the last answer
 * at once while a fresh one is fetched; `deps` (a signature of what the answer depends on) asks again
 * when it changes. Two components asking the same thing at once make one request.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback, useEffect, useRef } from 'react';
import { runOp, type OpParams } from '../lib/ops.ts';
import { useAppDispatch, useAppSelector, type AppDispatch, type RootState } from './hooks.ts';

interface Entry {
  data: unknown;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  fetchedAt: number;
}

const slice = createSlice({
  name: 'resources',
  initialState: { entries: {} as Record<string, Entry> },
  reducers: {
    started(state, a: PayloadAction<string>) {
      const e = state.entries[a.payload];
      if (e) e.loading = true;
      else state.entries[a.payload] = { data: null, loaded: false, loading: true, error: null, fetchedAt: 0 };
    },
    loaded(state, a: PayloadAction<{ key: string; data: unknown }>) {
      state.entries[a.payload.key] = { data: a.payload.data, loaded: true, loading: false, error: null, fetchedAt: Date.now() };
    },
    failed(state, a: PayloadAction<{ key: string; error: string }>) {
      const e = state.entries[a.payload.key];
      if (!e) return;
      e.loaded = true;
      e.loading = false;
      e.error = a.payload.error;
    },
  },
});

export const resourcesReducer = slice.reducer;
const act = slice.actions;

const inflight = new Map<string, Promise<void>>();

function fetchResource(key: string, fetcher: () => Promise<unknown>) {
  return (dispatch: AppDispatch): Promise<void> => {
    const running = inflight.get(key);
    if (running) return running;
    dispatch(act.started(key));
    const p = fetcher()
      .then((data) => void dispatch(act.loaded({ key, data })))
      .catch((err: unknown) => void dispatch(act.failed({ key, error: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err) })))
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

export interface Resource<T> {
  data: T | null;
  /** true only until the first answer: a refresh keeps showing the last one */
  loading: boolean;
  /** a refresh is under way */
  refreshing: boolean;
  error: string;
  reload: () => void;
}

/**
 * Any async read, cached under `key`. Asks on show when older than `freshMs`, and again whenever `deps`
 * changes. `enabled: false` asks nothing (and shows nothing new).
 */
export function useResource<T>(key: string, fetcher: () => Promise<T>, opts: { deps?: unknown; enabled?: boolean; freshMs?: number; debounceMs?: number } = {}): Resource<T> {
  const { deps, enabled = true, freshMs = 3000, debounceMs = 150 } = opts;
  const dispatch = useAppDispatch();
  const entry = useAppSelector((s: RootState) => s.resources.entries[key]);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const depsKey = JSON.stringify(deps ?? null);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const changed = seen.current !== null && seen.current !== depsKey;
    seen.current = depsKey;
    const ask = (): void =>
      void dispatch((d: AppDispatch, getState: () => RootState) => {
        const e = getState().resources.entries[key];
        if (changed || !e || Date.now() - e.fetchedAt > freshMs) void d(fetchResource(key, () => fetcherRef.current()));
      });
    // What it depends on often changes several times in a burst (lists arriving): ask once, after it settles.
    if (!changed) {
      ask();
      return;
    }
    const t = setTimeout(ask, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, depsKey, enabled]);
  const reload = useCallback(() => void dispatch(fetchResource(key, () => fetcherRef.current())), [dispatch, key]);
  return {
    data: (entry?.data ?? null) as T | null,
    loading: enabled && !entry?.loaded,
    refreshing: !!entry?.loading && !!entry?.loaded,
    error: entry?.error ?? '',
    reload,
  };
}

/** A read-only operation's answer, cached by its name and parameters. */
export function useOp<T>(op: string, params: OpParams = {}, opts: { deps?: unknown; enabled?: boolean; freshMs?: number; debounceMs?: number } = {}): Resource<T> {
  const key = `op:${op}:${JSON.stringify(params)}`;
  return useResource<T>(key, () => runOp<T>(op, params, { silent: true }), opts);
}
