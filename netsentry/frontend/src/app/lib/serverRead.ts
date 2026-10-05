/**
 * Looking at the server (v4 plan N-B9): ask once (server.read), then wait for the monitor's answer
 * (server.read-result). The monitor checks in every two seconds while someone looks, so an answer
 * usually comes within a few seconds; after 40 s we say it didn't come, honestly.
 */
import { runOp, opError, type OpParams } from './ops.ts';
import { useResource } from '../store/resources.ts';

interface ReadAnswer<T> {
  ready: boolean;
  result?: T | null;
  error?: string;
  at?: string;
}

export async function readServer<T>(kind: string, params: OpParams = {}): Promise<T> {
  const r = await runOp<{ request_id: string }>('server.read', { kind, ...params }, { silent: true });
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => window.setTimeout(res, i < 5 ? 600 : 1000));
    const a = await runOp<ReadAnswer<T>>('server.read-result', { request_id: r.request_id }, { silent: true });
    if (a.ready) {
      if (a.error) throw new Error(a.error);
      return a.result as T;
    }
  }
  throw new Error("The server didn't answer in 40 seconds — is its monitor running?");
}

/**
 * Read something from the server when the screen opens (and again on reload()). Cached in the store
 * by the question (v4 §17): coming back to a folder or a tab shows the last answer at once while a
 * fresh one is read; another folder never shows this one's answer.
 */
export function useServerRead<T>(kind: string, params: OpParams = {}, enabled = true): {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
} {
  const key = `read:${kind}:${JSON.stringify(params)}`;
  const r = useResource<T>(key, () => readServer<T>(kind, params).catch((e: unknown) => Promise.reject(new Error(e instanceof Error ? e.message : opError(e)))), { enabled, freshMs: 10000 });
  return { data: r.data, error: r.error, loading: r.loading || r.refreshing, reload: r.reload };
}

export function bytesWords(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} bytes`;
}
