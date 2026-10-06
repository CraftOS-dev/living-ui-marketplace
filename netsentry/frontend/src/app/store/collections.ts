/**
 * Records, cached (v4 §17). Every list or record a page reads lives in the store, keyed by what was
 * asked (collection + filter + sort): a page you come back to shows what you saw at once and refreshes
 * quietly — no spinner, no flash of empty. `useCollection` / `useRecord` keep the kit's shape, so pages
 * didn't change, only where the hook comes from.
 *
 * Live updates: ONE PocketBase subscription per collection, made the first time anything reads it and
 * kept while NetSentry is open — never re-made when a filter changes (re-made subscriptions were seen to
 * stop delivering on busy pages). An event refreshes every query of that collection someone is looking
 * at; the others are marked stale and refresh when next shown.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback, useEffect } from 'react';
import type { RecordModel } from 'pocketbase';
import { getPbClient } from '../../kit/index.ts';
import { useAppDispatch, useAppSelector, type AppDispatch, type RootState } from './hooks.ts';

export interface CollectionQuery {
  filter?: string;
  sort?: string;
  expand?: string;
}

interface Entry {
  collection: string;
  /** a list (query) or one record (id) */
  query?: CollectionQuery;
  id?: string;
  records: RecordModel[];
  record: RecordModel | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  fetchedAt: number;
  /** components showing it right now */
  users: number;
}

interface State {
  entries: Record<string, Entry>;
}

const initialState: State = { entries: {} };

const slice = createSlice({
  name: 'collections',
  initialState,
  reducers: {
    attach(state, a: PayloadAction<{ key: string; collection: string; query?: CollectionQuery; id?: string }>) {
      const e = state.entries[a.payload.key];
      if (e) e.users += 1;
      else
        state.entries[a.payload.key] = {
          collection: a.payload.collection, ...(a.payload.query ? { query: a.payload.query } : {}), ...(a.payload.id ? { id: a.payload.id } : {}),
          records: [], record: null, loaded: false, loading: false, error: null, fetchedAt: 0, users: 1,
        };
    },
    detach(state, a: PayloadAction<string>) {
      const e = state.entries[a.payload];
      if (e) e.users = Math.max(0, e.users - 1);
    },
    started(state, a: PayloadAction<string>) {
      const e = state.entries[a.payload];
      if (e) e.loading = true;
    },
    listLoaded(state, a: PayloadAction<{ key: string; records: RecordModel[] }>) {
      const e = state.entries[a.payload.key];
      if (!e) return;
      e.records = a.payload.records;
      e.loaded = true;
      e.loading = false;
      e.error = null;
      e.fetchedAt = Date.now();
    },
    recordLoaded(state, a: PayloadAction<{ key: string; record: RecordModel | null }>) {
      const e = state.entries[a.payload.key];
      if (!e) return;
      e.record = a.payload.record;
      e.loaded = true;
      e.loading = false;
      e.error = null;
      e.fetchedAt = Date.now();
    },
    failed(state, a: PayloadAction<{ key: string; error: string }>) {
      const e = state.entries[a.payload.key];
      if (!e) return;
      e.loaded = true;
      e.loading = false;
      e.error = a.payload.error;
    },
    /** A live event: one record changed — single-record entries take it as it is. */
    recordEvent(state, a: PayloadAction<{ collection: string; action: string; record: RecordModel }>) {
      for (const e of Object.values(state.entries)) {
        if (e.collection !== a.payload.collection || e.id !== a.payload.record.id) continue;
        e.record = a.payload.action === 'delete' ? null : a.payload.record;
        e.fetchedAt = Date.now();
      }
    },
    /** Lists nobody shows right now: refresh when next shown. */
    markStale(state, a: PayloadAction<string>) {
      for (const e of Object.values(state.entries)) if (e.collection === a.payload && !e.id && e.users === 0) e.fetchedAt = 0;
    },
  },
});

export const collectionsReducer = slice.reducer;
const act = slice.actions;

export const keyOf = (collection: string, q: CollectionQuery = {}): string => JSON.stringify(['list', collection, q.filter ?? '', q.sort ?? '', q.expand ?? '']);
const recordKey = (collection: string, id: string): string => JSON.stringify(['record', collection, id]);

const inflight = new Set<string>();
/** Revalidate on show when older than this (a fresh mount within it reuses the answer). */
const FRESH_MS = 5000;

function load(key: string) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    const e = getState().collections.entries[key];
    if (!e || inflight.has(key)) return;
    inflight.add(key);
    dispatch(act.started(key));
    const pb = getPbClient();
    try {
      if (e.id) {
        try {
          const record = await pb.call((c) => c.collection(e.collection).getOne(e.id!));
          dispatch(act.recordLoaded({ key, record }));
        } catch (err) {
          // gone (404) is an answer: no record
          if ((err as { status?: number })?.status === 404) dispatch(act.recordLoaded({ key, record: null }));
          else throw err;
        }
      } else {
        const options: Record<string, string> = {};
        if (e.query?.filter !== undefined) options['filter'] = e.query.filter;
        if (e.query?.sort !== undefined) options['sort'] = e.query.sort;
        if (e.query?.expand !== undefined) options['expand'] = e.query.expand;
        const records = await pb.call((c) => c.collection(e.collection).getFullList(options), { silent: true });
        dispatch(act.listLoaded({ key, records }));
      }
    } catch (err) {
      dispatch(act.failed({ key, error: err instanceof Error ? err.message : 'Failed to load data' }));
    } finally {
      inflight.delete(key);
    }
  };
}

// ------------------------------------------------------------------ live: one subscription per collection

const subscribed = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function follow(collection: string, dispatch: AppDispatch, getState: () => RootState): void {
  if (subscribed.has(collection)) return;
  subscribed.add(collection);
  void getPbClient()
    .call(
      (c) =>
        c.collection(collection).subscribe('*', (ev) => {
          dispatch(act.recordEvent({ collection, action: ev.action, record: ev.record }));
          // A burst of events (a report touches many records) is one refresh.
          const t = timers.get(collection);
          if (t) clearTimeout(t);
          timers.set(
            collection,
            setTimeout(() => {
              timers.delete(collection);
              dispatch(act.markStale(collection));
              for (const [key, e] of Object.entries(getState().collections.entries)) {
                if (e.collection === collection && !e.id && e.users > 0) void dispatch(load(key));
              }
            }, 120),
          );
        }),
      { silent: true },
    )
    .catch(() => subscribed.delete(collection)); // realtime unavailable: data still loads, just not live
}

// ------------------------------------------------------------------ hooks (the kit's shape)

const EMPTY: RecordModel[] = [];

export interface CollectionState<T> {
  records: T[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCollection<T extends RecordModel>(collection: string, query: CollectionQuery = {}): CollectionState<T> {
  const dispatch = useAppDispatch();
  const key = keyOf(collection, query);
  const entry = useAppSelector((s) => s.collections.entries[key]);
  useEffect(() => {
    dispatch(act.attach({ key, collection, query }));
    dispatch((d: AppDispatch, getState: () => RootState) => {
      follow(collection, d, getState);
      const e = getState().collections.entries[key];
      if (e && Date.now() - e.fetchedAt > FRESH_MS) void d(load(key));
    });
    return () => {
      dispatch(act.detach(key));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const refresh = useCallback(() => void dispatch(load(key)), [dispatch, key]);
  return { records: (entry?.records ?? EMPTY) as T[], loading: !entry?.loaded, error: entry?.error ?? null, refresh };
}

export interface RecordState<T> {
  record: T | null;
  loading: boolean;
  error: string | null;
}

export function useRecord<T extends RecordModel>(collection: string, id: string | null): RecordState<T> {
  const dispatch = useAppDispatch();
  const key = id ? recordKey(collection, id) : '';
  const entry = useAppSelector((s) => (key ? s.collections.entries[key] : undefined));
  useEffect(() => {
    if (!key || !id) return;
    dispatch(act.attach({ key, collection, id }));
    dispatch((d: AppDispatch, getState: () => RootState) => {
      follow(collection, d, getState);
      const e = getState().collections.entries[key];
      if (e && Date.now() - e.fetchedAt > FRESH_MS) void d(load(key));
    });
    return () => {
      dispatch(act.detach(key));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!id) return { record: null, loading: false, error: null };
  return { record: (entry?.record ?? null) as T | null, loading: !entry?.loaded, error: entry?.error ?? null };
}
