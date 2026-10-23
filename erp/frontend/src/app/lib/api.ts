/**
 * The one door to the server. Screens call the same operations your AI agent
 * calls through the agent-app CLI (pb_hooks/cat_*.js), so every rule (rights,
 * posting, locks) holds for both.
 *
 *   op<T>('docs.get', { doc: 'INV-00012' })
 *   opForm<T>('inbox.add', { note: '...' }, { file })
 *
 * Errors arrive as OpError { status, code, message, data }. By default a
 * failed call shows its message as a toast; pass { quiet: true } when the
 * screen shows the error itself (forms, loading states).
 */
import { ClientResponseError } from 'pocketbase';
import { getPbClient, toast } from '../../kit/index.ts';
import { OPS } from './ops.gen.ts';
import type { OpName } from './ops.gen.ts';

export type { OpName };

export class OpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: Record<string, unknown>;
  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

type Scalar = string | number | boolean;
export type Params = Record<string, Scalar | Scalar[] | Record<string, unknown> | Record<string, unknown>[] | null | undefined>;

/** Listeners for "the session is gone" (signed out elsewhere, expired). */
const signedOut = new Set<() => void>();
export function onSignedOut(fn: () => void): () => void {
  signedOut.add(fn);
  return () => {
    signedOut.delete(fn);
  };
}

function toOpError(err: unknown): OpError {
  if (err instanceof OpError) return err;
  if (err instanceof ClientResponseError) {
    const r = (err.response ?? {}) as { message?: string | undefined; code?: string | undefined; data?: Record<string, unknown> | undefined };
    if (err.status === 0) return new OpError(0, err.isAbort ? 'aborted' : 'network', err.isAbort ? 'Cancelled' : 'Cannot reach the app right now. Check the connection and try again.');
    return new OpError(err.status, r.code ?? String(err.status), r.message ?? err.message, r.data ?? {});
  }
  const e = err as { message?: string | undefined };
  return new OpError(0, 'error', e.message ?? 'Something went wrong');
}

function path(name: OpName): string {
  const i = name.indexOf('.');
  return `/api/ops/${name.slice(0, i)}/${name.slice(i + 1)}`;
}

function encode(params: Params): Record<string, string | number | boolean | unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

function query(params: Params): Record<string, string> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(encode(params))) {
    q[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return q;
}

export interface CallOptions {
  /** The screen shows the error itself: no toast. */
  quiet?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

async function send<T>(name: OpName, init: { method: string; query?: Record<string, string> | undefined; body?: unknown | undefined }, opts: CallOptions): Promise<T> {
  try {
    const options: Record<string, unknown> = { method: init.method, requestKey: null };
    if (init.query !== undefined) options['query'] = init.query;
    if (init.body !== undefined) options['body'] = init.body;
    if (opts.signal !== undefined) options['signal'] = opts.signal;
    return await getPbClient().call((pb) => pb.send<T>(path(name), options), { silent: true });
  } catch (raw) {
    const err = toOpError((raw as { raw?: unknown | undefined }).raw ?? raw);
    if (err.status === 401 && (err.code === 'session_required' || err.code === 'account_inactive')) {
      for (const fn of signedOut) fn();
    }
    if (opts.quiet !== true && err.code !== 'aborted') toast.error(err.message);
    throw err;
  }
}

/** Run one operation. GET operations send their params as a query; others as JSON. */
export function op<T>(name: OpName, params: Params = {}, opts: CallOptions = {}): Promise<T> {
  const method = OPS[name];
  if (method === 'GET') return send<T>(name, { method, query: query(params) }, opts);
  return send<T>(name, { method, body: encode(params) }, opts);
}

/** Run an operation that takes files (multipart). Lists and objects go as JSON text. */
export function opForm<T>(name: OpName, params: Params, files: Record<string, File | File[] | null | undefined>, opts: CallOptions = {}): Promise<T> {
  const f = new FormData();
  for (const [k, v] of Object.entries(encode(params))) f.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const [k, v] of Object.entries(files)) {
    if (v === null || v === undefined) continue;
    for (const file of Array.isArray(v) ? v : [v]) f.append(k, file);
  }
  return send<T>(name, { method: 'POST', body: f }, opts);
}

/**
 * A streamed file (attachment, receipt, export) fetched with the session and
 * handed to the browser: saved with its name, or opened in a new tab.
 */
export async function download(name: OpName, params: Params, mode: 'save' | 'open', fallbackName = 'download'): Promise<void> {
  const pb = getPbClient().pb;
  const url = new URL(pb.buildURL(path(name)));
  for (const [k, v] of Object.entries(query(params))) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {}, credentials: 'include' });
  if (!res.ok) {
    let msg = 'Could not get the file';
    try {
      const j = (await res.json()) as { message?: string | undefined };
      msg = j.message ?? msg;
    } catch {
      /* not JSON */
    }
    toast.error(msg);
    throw new OpError(res.status, 'download_failed', msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const file = m?.[1] !== undefined ? decodeURIComponent(m[1]) : fallbackName;
  const href = URL.createObjectURL(blob);
  if (mode === 'open') {
    window.open(href, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(href), 60000);
    return;
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

/** Save text (a CSV an operation returned) as a file. */
export function saveText(text: string, fileName: string, mime = 'text/csv'): void {
  const href = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

/** The message to show for any caught error. */
export function errMessage(err: unknown): string {
  return toOpError(err).message;
}

/** The machine code of a caught error ('' when unknown). */
export function errCode(err: unknown): string {
  return toOpError(err).code;
}
