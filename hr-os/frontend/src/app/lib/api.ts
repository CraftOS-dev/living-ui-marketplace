/**
 * The one door to the server. Screens call the same operations your AI agent
 * calls through the agent-app CLI (pb/pb_hooks/cat_*.js), so every rule
 * (rights, team scope, approvals, PIN, audit) holds for both.
 *
 *   const r = await op<{ employee: Employee }>('people.get', { employee: 'E0001' });
 *   await op('payruns.lock', { payrun }, { pin: { title: 'Lock the pay run' } });
 *   const live = useOp<List>('people.list', { status: 'active' }, ['employees']);
 *
 * Errors arrive as OpError { status, code, message, data }. A failed call
 * shows its message as a toast unless { quiet: true } (forms that show the
 * error themselves). A 401 that means the session is gone sends the person
 * to the sign-in screen.
 *
 * PIN: every `confirm` operation (PIN_OPS in ops.gen.ts) asks for the
 * approval PIN in the PIN dialog before it is sent; { pin: { title, text } }
 * words the dialog. A wrong PIN asks again with the tries left. A screen
 * that already holds the PIN for a batch passes it as the `pin` param.
 *
 * At most six calls are on the wire at once; the rest wait in order (reads
 * first while the line is longer than six), so a page with many widgets
 * never bursts the server. A call waiting for its turn can be cancelled.
 *
 * Busy server: a 429 (rate limited) was never processed, so every call tries
 * again after a short pause with jitter (at most 3 tries); reads also try
 * again after a dropped connection or a 502/503/504. When it still fails the
 * error says the app is busy for a moment.
 */
import { ClientResponseError } from 'pocketbase';
import { getPbClient } from '../../kit/index.ts';
import { OPS, PIN_OPS } from './ops.gen.ts';
import type { OpName } from './ops.gen.ts';
import { t } from './i18n.ts';
import { toast } from './toast.ts';

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

/* ---------------------------------------------------------------- session */

const signedOut = new Set<(code: string) => void>();
/** Listeners for "the session is gone" (expired, signed out elsewhere, disabled). */
export function onSignedOut(fn: (code: string) => void): () => void {
  signedOut.add(fn);
  return () => {
    signedOut.delete(fn);
  };
}

const SESSION_CODES = new Set(['session_required', 'session_expired', 'account_inactive', 'account_disabled']);

/* -------------------------------------------------------------------- PIN */

export interface PinAsk {
  title?: string | undefined;
  text?: string | undefined;
  /** The server said the last PIN was wrong. */
  wrong?: boolean | undefined;
  /** Remaining tries, when the server tells. */
  left?: number | undefined;
}

let pinAsker: ((ask: PinAsk) => Promise<string | null>) | null = null;
/** The PIN dialog host registers itself here (components/ui.tsx PinHost). */
export function setPinAsker(fn: ((ask: PinAsk) => Promise<string | null>) | null): void {
  pinAsker = fn;
}

/** Ask for the PIN once (a batch of confirm operations passes it as the `pin` param). Null when cancelled. */
export function askPin(ask: PinAsk = {}): Promise<string | null> {
  if (pinAsker === null) return Promise.resolve(null);
  return pinAsker(ask);
}

/** The server asks for the PIN: it was missing, or the last one was wrong. */
function wantsPin(err: OpError): boolean {
  return err.code === 'wrong_pin' || (err.code === 'missing_param' && err.data['param'] === 'pin');
}

const pinNotSet = new Set<() => void>();
/** Listeners for "set your approval PIN first" (the shell offers the way there). */
export function onPinNotSet(fn: () => void): () => void {
  pinNotSet.add(fn);
  return () => {
    pinNotSet.delete(fn);
  };
}

/* ------------------------------------------------------------------ calls */

function toOpError(err: unknown): OpError {
  if (err instanceof OpError) return err;
  if (err instanceof ClientResponseError) {
    const r = (err.response ?? {}) as { message?: string | undefined; error?: string | undefined; code?: string | undefined; data?: Record<string, unknown> | undefined };
    if (err.status === 0) return new OpError(0, err.isAbort ? 'aborted' : 'network', err.isAbort ? 'Cancelled' : 'Cannot reach the app right now. Check the connection and try again.');
    return new OpError(err.status, r.code ?? String(err.status), r.message ?? r.error ?? err.message, r.data ?? {});
  }
  const e = err as { message?: string | undefined; name?: string | undefined };
  if (e.name === 'AbortError') return new OpError(0, 'aborted', 'Cancelled');
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

/** Lists and objects travel as JSON strings (SPEC 3.1). */
function body(params: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean(params))) out[k] = typeof v === 'object' ? JSON.stringify(v) : v;
  return out;
}

export interface CallOptions {
  /** The screen shows the error itself: no toast. */
  quiet?: boolean | undefined;
  signal?: AbortSignal | undefined;
  /** Ask for the approval PIN first (every `confirm` op). */
  pin?: PinAsk | true | undefined;
}

/* ------------------------------------------------------------- the line */

/** Calls on the wire at once. */
const IN_FLIGHT = 6;
let inFlight = 0;
const line: { read: boolean; go: () => void }[] = [];

function nextInLine(): void {
  while (inFlight < IN_FLIGHT && line.length > 0) {
    // A long line lets the reads that fill the screen go first; otherwise first come, first served.
    let i = 0;
    if (line.length > IN_FLIGHT) {
      const r = line.findIndex((x) => x.read);
      if (r >= 0) i = r;
    }
    const [item] = line.splice(i, 1);
    item?.go();
  }
}

/** Wait for a place on the wire; the returned function gives it back (once). */
function turn(read: boolean, signal: AbortSignal | null | undefined): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const go = (): void => {
      inFlight++;
      let back = false;
      resolve(() => {
        if (back) return;
        back = true;
        inFlight--;
        nextInLine();
      });
    };
    if (signal?.aborted === true) {
      reject(new OpError(0, 'aborted', 'Cancelled'));
      return;
    }
    if (inFlight < IN_FLIGHT && line.length === 0) {
      go();
      return;
    }
    const item = { read, go };
    line.push(item);
    signal?.addEventListener(
      'abort',
      () => {
        const i = line.indexOf(item);
        if (i >= 0) {
          line.splice(i, 1);
          reject(new OpError(0, 'aborted', 'Cancelled'));
        }
      },
      { once: true },
    );
  });
}

/** Run one request in its turn. */
async function inTurn<T>(read: boolean, signal: AbortSignal | null | undefined, run: () => Promise<T>): Promise<T> {
  const back = await turn(read, signal);
  try {
    return await run();
  } finally {
    back();
  }
}

/* ------------------------------------------------------------- busy server */

/** Tries in all for one call when the server is busy (the first try included). */
const TRIES = 3;

/** Another try is safe: a 429 was not processed; a read can always be sent again. */
function retryable(err: OpError, read: boolean): boolean {
  if (err.status === 429) return true;
  return read && (err.code === 'network' || err.status === 502 || err.status === 503 || err.status === 504);
}

/** The pause before try n + 1 (n = 1, 2): 250 to 500 ms, then 500 to 1000 ms. */
function backoff(n: number): number {
  const base = 250 * 2 ** (n - 1);
  return base + Math.random() * base;
}

function pause(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new OpError(0, 'aborted', 'Cancelled'));
      return;
    }
    const stop = (): void => {
      clearTimeout(timer);
      reject(new OpError(0, 'aborted', 'Cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** The calm words for a call that stayed rate limited after every try. */
function calm(err: OpError): OpError {
  return err.status === 429 ? new OpError(429, 'busy', t('app.busy'), err.data) : err;
}

/** fetch() for protected files with the same busy-server tries (429 always; reads also on gateway errors). */
export async function fetchRetry(url: string, init: RequestInit = {}): Promise<Response> {
  const read = (init.method ?? 'GET') === 'GET';
  for (let n = 1; ; n++) {
    let res: Response;
    try {
      res = await inTurn(read, init.signal, () => fetch(url, init));
    } catch (e) {
      if ((e as { code?: string }).code === 'aborted') throw e;
      if (!read || n >= TRIES || (e as { name?: string }).name === 'AbortError') throw e;
      await pause(backoff(n), init.signal);
      continue;
    }
    const again = res.status === 429 || (read && (res.status === 502 || res.status === 503 || res.status === 504));
    if (!again || n >= TRIES) return res;
    await pause(backoff(n), init.signal);
  }
}

async function raw<T>(name: OpName, params: Params, signal: AbortSignal | undefined): Promise<T> {
  const pb = getPbClient().pb;
  const options: Record<string, unknown> = { requestKey: null };
  if (signal !== undefined) options['signal'] = signal;
  if (OPS[name].method === 'GET') return pb.send<T>(path(name), { ...options, method: 'GET', query: query(params) });
  return pb.send<T>(path(name), { ...options, method: 'POST', body: body(params) });
}

/** Run one operation. GET operations send their params as a query; others as JSON. */
export async function op<T>(name: OpName, params: Params = {}, opts: CallOptions = {}): Promise<T> {
  const needsPin = PIN_OPS.has(name) && params['pin'] === undefined;
  const read = OPS[name].method === 'GET';
  let words: PinAsk = opts.pin !== undefined && opts.pin !== true ? opts.pin : {};
  let askNow = opts.pin !== undefined || needsPin;
  let p = params;
  let pinTries = 0;
  let busyTries = 1;
  for (;;) {
    if (askNow) {
      if (pinAsker === null) throw new OpError(0, 'pin_unavailable', 'The PIN dialog is not ready.');
      const pin = await pinAsker(words);
      if (pin === null) throw new OpError(0, 'aborted', 'Cancelled');
      p = { ...params, pin };
      askNow = false;
    }
    try {
      const send = p;
      return await inTurn(read, opts.signal, () => raw<T>(name, send, opts.signal));
    } catch (e0) {
      const err = toOpError(e0);
      if (wantsPin(err) && pinAsker !== null) {
        if (++pinTries >= 6) throw new OpError(0, 'pin_failed', 'Too many tries.');
        const left = typeof err.data['left'] === 'number' ? (err.data['left'] as number) : undefined;
        words = { ...words, wrong: err.code === 'wrong_pin', left };
        askNow = true;
        continue;
      }
      if (retryable(err, read) && busyTries < TRIES) {
        await pause(backoff(busyTries++), opts.signal);
        continue;
      }
      const out = calm(err);
      if (out.code === 'pin_not_set') for (const fn of pinNotSet) fn();
      if (out.status === 401 && SESSION_CODES.has(out.code)) for (const fn of signedOut) fn(out.code);
      if (opts.quiet !== true && out.code !== 'aborted') toast.error(out.message);
      throw out;
    }
  }
}

/** A multipart call (uploads). Files go under their field name; params as form fields. */
export async function opForm<T>(name: OpName, params: Params, files: Record<string, File | File[] | null | undefined>, opts: CallOptions = {}): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(clean(params))) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const [k, v] of Object.entries(files)) {
    if (v === null || v === undefined) continue;
    for (const f of Array.isArray(v) ? v : [v]) fd.append(k, f, f.name);
  }
  const options: Record<string, unknown> = { method: 'POST', body: fd, requestKey: null };
  if (opts.signal !== undefined) options['signal'] = opts.signal;
  for (let n = 1; ; n++) {
    try {
      return await inTurn(false, opts.signal, () => getPbClient().pb.send<T>(path(name), options));
    } catch (e0) {
      const err = toOpError(e0);
      if (retryable(err, false) && n < TRIES) {
        await pause(backoff(n), opts.signal);
        continue;
      }
      const out = calm(err);
      if (out.status === 401 && SESSION_CODES.has(out.code)) for (const fn of signedOut) fn(out.code);
      if (opts.quiet !== true && out.code !== 'aborted') toast.error(out.message);
      throw out;
    }
  }
}

/** A protected file (document, receipt, export) fetched with the session and saved or opened. */
export async function download(name: OpName, params: Params, mode: 'save' | 'open', fallbackName = 'download'): Promise<void> {
  const pb = getPbClient().pb;
  const url = new URL(pb.buildURL(path(name)));
  for (const [k, v] of Object.entries(query(params))) url.searchParams.set(k, v);
  const res = await fetchRetry(url.toString(), { headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {} });
  if (!res.ok) {
    let msg = res.status === 429 ? t('app.busy') : 'Could not get the file';
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
  const link = URL.createObjectURL(blob);
  if (mode === 'open') {
    window.open(link, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(link), 60000);
    return;
  }
  saveBlob(blob, file);
  setTimeout(() => URL.revokeObjectURL(link), 10000);
}

export function saveBlob(blob: Blob, fileName: string): void {
  const link = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = link;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(link), 10000);
}

/** Save text (a CSV an operation returned) as a file. */
export function saveText(text: string, fileName: string, mime = 'text/csv'): void {
  saveBlob(new Blob([text], { type: `${mime};charset=utf-8` }), fileName);
}

/** Copy text; true when it worked (clipboard access can be refused inside frames). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** The message to show for any caught error. */
export function errMessage(err: unknown): string {
  return toOpError(err).message;
}

/** The machine code of a caught error. */
export function errCode(err: unknown): string {
  return toOpError(err).code;
}

export { toOpError };
