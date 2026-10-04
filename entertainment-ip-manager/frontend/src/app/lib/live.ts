/**
 * Live data: every view follows changes made by anyone, including CraftBot
 * and other agents writing through the API or the app's operations, without
 * a page refresh.
 *
 * - useCollection: the kit's realtime list, plus a subscription to every
 *   collection its `expand` pulls in (a renamed matter updates the deadline
 *   rows that show its title).
 * - useLiveReload: re-run anything when records in the given collections
 *   change (computed summaries, previews, reports, search results).
 * - useLiveAsync: useAsync that refreshes itself, silently, from those
 *   changes (no loading flash; the last result stays on screen meanwhile).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import { getPbClient, useCollection as useKitCollection } from '../../kit/index.ts';
import type { CollectionQuery, CollectionState } from '../../kit/index.ts';
import { useAsync } from './context.tsx';

/** Relation field name to the collection it points at (see the schema migration). */
const FIELD_TARGET: Record<string, string> = {
  actor: 'users', agency: 'parties', agent: 'parties', agreement: 'agreements', appears_in: 'titles',
  approval: 'approvals', asset: 'content_id_assets', assigned_reviewers: 'users', assignee: 'users',
  base_event: 'events', captured_by: 'users', case_ref: 'enforcement_cases', character: 'characters',
  characters: 'characters', claim: 'content_id_claims', closed_by: 'users', committee: 'committees',
  counterparty: 'parties', created_by: 'users', creator: 'parties', deadline: 'deadlines', decided_by: 'users',
  derived_from: 'character_assets', distributor: 'parties', docketer: 'users', document: 'documents',
  enrollment: 'platform_enrollments', family: 'families', fan_registration: 'fan_registrations',
  first_approver: 'users', franchise: 'franchises', franchises: 'franchises', guideline: 'guidelines',
  holders: 'parties', label: 'parties', licensee: 'parties', managers: 'users', matter: 'matters',
  matters: 'matters', original_work: 'titles', owner: 'users', party: 'parties', permission: 'permissions',
  portal_users: 'users', product: 'products', recordation: 'customs_recordations', recording: 'recordings',
  recordings: 'recordings', registration: 'society_registrations', report: 'royalty_reports',
  requested_by: 'users', responsible: 'users', reviewer: 'users', rule: 'rules', snapshot: 'documents',
  society_contract: 'society_contracts', song: 'songs', songs: 'songs', supersedes: 'guidelines',
  talent: 'talents', talents: 'talents', uploaded_by: 'users', user: 'users', work: 'titles', works: 'titles',
};

/** Collections an expand string reads, besides the base collection. */
export function expandSources(base: string, expand: string | undefined): string[] {
  if (expand === undefined || expand.trim() === '') return [];
  const out = new Set<string>();
  for (const path of expand.split(',')) {
    for (const seg of path.trim().split('.')) {
      const target = seg === 'parent' ? base : FIELD_TARGET[seg];
      if (target !== undefined && target !== base) out.add(target);
    }
  }
  return [...out];
}

/**
 * Call `onChange` (debounced) whenever any record in `collections` is
 * created, updated or deleted. Collections the person cannot list simply
 * send no events.
 */
export function useLiveReload(collections: readonly string[], onChange: () => void, enabled = true): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = [...new Set(collections)].sort().join(',');
  useEffect(() => {
    if (!enabled || key === '') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubs: UnsubscribeFunc[] = [];
    const fire = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) cb.current();
      }, 200);
    };
    const client = getPbClient();
    for (const name of key.split(',')) {
      void client
        .call((pb) => pb.collection(name).subscribe('*', fire), { silent: true })
        .then((fn) => {
          if (cancelled) void fn();
          else unsubs.push(fn);
        })
        .catch(() => {
          /* realtime unavailable: the view still loads, just not live */
        });
    }
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      for (const fn of unsubs) void fn();
    };
  }, [key, enabled]);
}

/** The kit's live list, also refreshed when expanded (related) records change. */
export function useCollection<T extends RecordModel>(collection: string, query: CollectionQuery = {}): CollectionState<T> {
  const state = useKitCollection<T>(collection, query);
  const refresh = state.refresh;
  useLiveReload(expandSources(collection, query.expand), refresh);
  return state;
}

/** useAsync that re-runs silently whenever the given collections change. */
export function useLiveAsync<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
  sources: readonly string[],
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const res = useAsync(fn, deps);
  useLiveReload(sources, res.refresh);
  return { data: res.data, loading: res.loading, error: res.error, reload: res.reload };
}

/**
 * Keep records a view was handed (a dialog's deadline, a drawer's item)
 * current: realtime changes to those ids replace the snapshot, keeping the
 * snapshot's `expand` (realtime events carry none).
 */
export function useLiveRecords<T extends RecordModel>(collection: string, snapshot: T[]): T[] {
  const [fresh, setFresh] = useState<Record<string, T>>({});
  const idKey = snapshot.map((r) => r.id).join(',');
  useEffect(() => {
    setFresh({});
    if (idKey === '') return;
    const ids = new Set(idKey.split(','));
    let cancelled = false;
    let unsub: UnsubscribeFunc | null = null;
    void getPbClient()
      .call(
        (pb) =>
          pb.collection(collection).subscribe<T>('*', (e) => {
            if (cancelled || !ids.has(e.record.id) || e.action === 'delete') return;
            setFresh((m) => ({ ...m, [e.record.id]: e.record }));
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
  }, [collection, idKey]);
  return useMemo(
    () =>
      snapshot.map((r) => {
        const f = fresh[r.id];
        return f !== undefined && f.updated >= r.updated ? ({ ...r, ...f, expand: r.expand } as T) : r;
      }),
    [snapshot, fresh],
  );
}

/**
 * A preview (the deadlines an event would create) re-ran because data
 * changed. Keep what the person ticked for keys that still exist, and apply
 * the default only to keys that are new in this run.
 */
export function mergeSelection<P extends { key: string }>(
  prevSel: Set<string>,
  prevItems: readonly P[] | null,
  next: readonly P[],
  byDefault: (p: P) => boolean,
): Set<string> {
  if (prevItems === null) return new Set(next.filter(byDefault).map((p) => p.key));
  const before = new Set(prevItems.map((p) => p.key));
  const out = new Set<string>();
  for (const p of next) {
    if (before.has(p.key)) {
      if (prevSel.has(p.key)) out.add(p.key);
    } else if (byDefault(p)) out.add(p.key);
  }
  return out;
}
