/**
 * The one door to the server. Screens call the same operations your AI agent
 * calls through the agent-app CLI (pb_hooks/cat_*.js), so every rule holds
 * for both.
 *
 *   op<T>('works.get', { work: id })
 *   opForm<T>('files.upload', { project }, { file: files })
 *   opUrl('files.content', { file: id })   // a URL for pdf.js or <img>
 *
 * Errors arrive as OpError { status, code, message, data }. By default a
 * failed call shows its message as a toast; pass { quiet: true } when the
 * screen shows the error itself.
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

export type Params = Record<string, unknown>;

function toOpError(err: unknown): OpError {
  if (err instanceof OpError) return err;
  if (err instanceof ClientResponseError) {
    const r = (err.response ?? {}) as { message?: string | undefined; code?: string | undefined; data?: Record<string, unknown> | undefined };
    if (err.status === 0) return new OpError(0, err.isAbort ? 'aborted' : 'network', err.isAbort ? 'Cancelled' : 'Cannot reach the app right now. Try again in a moment.');
    return new OpError(err.status, r.code ?? String(err.status), r.message ?? err.message, r.data ?? {});
  }
  const e = err as { message?: string | undefined };
  return new OpError(0, 'error', e.message ?? 'Something went wrong');
}

function path(name: OpName): string {
  const i = name.indexOf('.');
  return `/api/ops/${name.slice(0, i)}/${name.slice(i + 1)}`;
}

function clean(params: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function query(params: Params): Record<string, string> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(clean(params))) q[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return q;
}

export interface CallOptions {
  quiet?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export async function op<T>(name: OpName, params: Params = {}, opts: CallOptions = {}): Promise<T> {
  const method = OPS[name];
  const pb = getPbClient().pb;
  try {
    if (method === 'GET') return await pb.send<T>(path(name), { method: 'GET', query: query(params), requestKey: null, signal: opts.signal ?? null });
    return await pb.send<T>(path(name), { method: 'POST', body: clean(params), requestKey: null, signal: opts.signal ?? null });
  } catch (err) {
    const e = toOpError(err);
    if (!opts.quiet && e.code !== 'aborted') toast.error(e.message);
    throw e;
  }
}

/** A multipart call (uploads). Files go under their field name; params as form fields. */
export async function opForm<T>(name: OpName, params: Params, files: Record<string, File | Blob | (File | Blob)[]>, opts: CallOptions = {}): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(clean(params))) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const [k, v] of Object.entries(files)) {
    const list = Array.isArray(v) ? v : [v];
    for (const f of list) fd.append(k, f, f instanceof File ? f.name : k + '.png');
  }
  try {
    return await getPbClient().pb.send<T>(path(name), { method: 'POST', body: fd, requestKey: null, signal: opts.signal ?? null });
  } catch (err) {
    const e = toOpError(err);
    if (!opts.quiet) toast.error(e.message);
    throw e;
  }
}

/** A GET operation as a URL (the PDF for the reader, a thumbnail). */
export function opUrl(name: OpName, params: Params): string {
  const base = getPbClient().pb.baseURL.replace(/\/$/, '');
  return base + path(name) + '?' + new URLSearchParams(query(params)).toString();
}

export function errMessage(err: unknown): string {
  const e = err as { message?: string | undefined };
  return e.message ?? 'Something went wrong';
}

/** Save text as a file (exports). */
export function download(filename: string, content: string | Blob, mime = 'text/plain;charset=utf-8'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
