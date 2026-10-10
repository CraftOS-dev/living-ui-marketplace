import { useCallback, useEffect, useRef, useState } from 'react';
import type { UnsubscribeFunc } from 'pocketbase';
import { getPbClient } from '../kit/index.ts';
import { api } from './api.ts';
import { LIST_FIELDS, type EngineStatus, type NoteSummary } from './types.ts';

/**
 * The sidebar list: live, but only the light fields. (The kit's
 * useCollection loads whole records, and every worker save would re-download
 * every transcript.) `version` bumps on every refresh so views derived from
 * the notes (the digest) know to reload. A deleted note leaves the list at
 * once (forget), not at the next refresh.
 */
export function useNoteList(): {
  notes: NoteSummary[];
  loading: boolean;
  error: string | null;
  version: number;
  forget: (id: string) => void;
} {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deleted ids: a list fetched before the delete went through must not bring the note back.
  const gone = useRef(new Set<string>());

  const forget = useCallback((id: string) => {
    gone.current.add(id);
    setNotes((list) => list.filter((n) => n.id !== id));
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const list = await getPbClient().call(
        (pb) => pb.collection('notes').getFullList<NoteSummary>({ sort: '-date,-created', fields: LIST_FIELDS }),
        { silent: true },
      );
      setNotes(list.filter((n) => !gone.current.has(n.id)));
      setError(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Could not load notes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unsubscribe: UnsubscribeFunc | null = null;
    let cancelled = false;
    void fetchAll();
    void getPbClient()
      .call(
        (pb) =>
          pb.collection('notes').subscribe('*', (e) => {
            if (e.action === 'delete') forget(e.record.id);
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = setTimeout(() => void fetchAll(), 150);
          }),
        { silent: true },
      )
      .then((fn) => {
        if (cancelled) void fn();
        else unsubscribe = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (timer.current !== null) clearTimeout(timer.current);
      if (unsubscribe !== null) void unsubscribe();
    };
  }, [fetchAll, forget]);

  return { notes, loading, error, version, forget };
}

/** The engine download is in progress (or about to start). */
export function settingUp(engine: EngineStatus | null): boolean {
  return engine !== null && ['pending', 'downloading', 'installing'].includes(engine.setup.state);
}

/**
 * Engine status: fetched once, then every 1.5 s while some note is in the
 * pipeline or the engine is being downloaded (that is when progress
 * changes), otherwise every 30 s. refresh() fetches it now.
 */
export function useEngine(active: boolean): { engine: EngineStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const stopped = useRef(false);
  const refresh = useCallback(() => {
    void api
      .engine()
      .then((s) => {
        if (!stopped.current) setStatus(s);
      })
      .catch(() => undefined);
  }, []);
  const fast = active || settingUp(status);
  useEffect(() => {
    stopped.current = false;
    refresh();
    const id = window.setInterval(refresh, fast ? 1500 : 30000);
    return () => {
      stopped.current = true;
      clearInterval(id);
    };
  }, [fast, refresh]);
  return { engine: status, refresh };
}
