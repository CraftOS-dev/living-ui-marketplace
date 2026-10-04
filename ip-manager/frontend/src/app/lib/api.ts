/**
 * Client for the app's custom verbs (/api/ops/*) and small PocketBase
 * helpers. Uses the kit's PB client so auth and base URL match the rest of
 * the app in dev and production.
 */
import type { RecordModel } from 'pocketbase';
import { getPbClient, toast } from '../../kit/index.ts';

export class OpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function base(): string {
  return getPbClient().pb.baseURL.replace(/\/$/, '');
}

function headers(): Record<string, string> {
  const token = getPbClient().pb.authStore.token;
  return {
    'Content-Type': 'application/json',
    ...(token !== '' ? { Authorization: token } : {}),
  };
}

/**
 * A stored session can outlive the database that issued it (data reset, a
 * recycled port, another app on the same address). Ask the server whether it
 * still knows the token, and drop it quietly when it does not, so nothing is
 * sent with a dead token (which shows up as 401 errors). The token goes in
 * X-Session-Token because a dead Authorization header is refused before any
 * route runs; the session route answers 200 either way. Network trouble
 * keeps the session: the kit decides.
 */
export async function dropStaleSession(): Promise<void> {
  const pb = getPbClient().pb;
  const token = pb.authStore.token;
  if (token === '') return;
  if (!pb.authStore.isValid) {
    pb.authStore.clear();
    return;
  }
  try {
    const res = await fetch(`${base()}/api/session/check`, { headers: { 'X-Session-Token': token } });
    if (!res.ok) return;
    const j = (await res.json()) as { valid?: boolean; id?: string };
    if (j.valid !== true || j.id !== pb.authStore.record?.id) pb.authStore.clear();
  } catch {
    /* offline or server restarting: keep the session */
  }
}

async function parse<T>(res: Response): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : `Request failed (${res.status})`;
    throw new OpError(res.status, message);
  }
  return data as T;
}

/** POST an op. Throws OpError with the server's plain-language message. */
export async function op<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${base()}/api/ops/${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body ?? {}),
  });
  return parse<T>(res);
}

export async function opGet<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}/api/ops/${path}`, { method: 'GET', headers: headers() });
  return parse<T>(res);
}

/** Run an op and toast its error; returns null on failure. */
export async function opToast<T>(path: string, body?: Record<string, unknown>, success?: string): Promise<T | null> {
  try {
    const r = await op<T>(path, body);
    if (success !== undefined) toast.success(success);
    return r;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function pb() {
  return getPbClient().pb;
}

/** Create/update/delete through the kit client (errors toast automatically). */
export async function createRecord<T extends RecordModel>(collection: string, data: Record<string, unknown> | FormData): Promise<T> {
  return getPbClient().call((p) => p.collection(collection).create<T>(data));
}

export async function updateRecord<T extends RecordModel>(collection: string, id: string, data: Record<string, unknown> | FormData): Promise<T> {
  return getPbClient().call((p) => p.collection(collection).update<T>(id, data));
}

export async function deleteRecord(collection: string, id: string): Promise<boolean> {
  return getPbClient().call((p) => p.collection(collection).delete(id));
}

export async function getRecord<T extends RecordModel>(collection: string, id: string): Promise<T> {
  return getPbClient().call((p) => p.collection(collection).getOne<T>(id), { silent: true });
}

export async function listAll<T extends RecordModel>(collection: string, options: { filter?: string; sort?: string } = {}): Promise<T[]> {
  const o: Record<string, string> = {};
  if (options.filter !== undefined) o['filter'] = options.filter;
  if (options.sort !== undefined) o['sort'] = options.sort;
  return getPbClient().call((p) => p.collection(collection).getFullList<T>(o));
}

/** Public URL of a record file (thumb e.g. "100x100"). */
export function fileUrl(record: { collectionId?: string; collectionName?: string; id: string }, filename: string, thumb?: string): string {
  if (!filename) return '';
  const coll = record.collectionId ?? record.collectionName ?? '';
  const q = thumb !== undefined ? `?thumb=${thumb}` : '';
  return `${base()}/api/files/${coll}/${record.id}/${encodeURIComponent(filename)}${q}`;
}

/** Escape a value for a PocketBase filter string literal. */
export function q(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
