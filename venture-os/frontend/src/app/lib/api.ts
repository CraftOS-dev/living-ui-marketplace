/**
 * The one door to the server. Screens call the same operations your AI agent
 * calls through the agent-app CLI (pb/pb_hooks/cat_*.js), so every rule
 * (rights, fund scope, restricted deals, PIN, audit) holds for both.
 *
 *   const r = await op<{ deal: Deal }>('deals.get', { id: 'D-0012' });
 *   await op('committee.reveal', { meeting }, { pin: { title: 'Reveal votes' } });
 *   const live = useOp<List>('deals.list', { stage }, ['deals']);   // lib/live.ts
 *
 * Names are typed through ops.gen.ts (generated from the catalog). A name
 * that arrives as data (a NextItem action) goes through runOp(), which
 * checks it against the catalog first.
 *
 * Errors arrive as OpError { status, code, message, data }. A failed call
 * shows its message as a toast unless { quiet: true }. A 401 that means the
 * session is gone sends the person to sign in.
 *
 * PIN: every `confirm` operation (PIN_OPS) opens the PIN dialog before it is
 * sent; { pin: { title } } words it, { pin: true } asks for any op. A wrong
 * PIN asks again with the tries left.
 *
 * At most six calls are on the wire at once; the rest wait in order (reads
 * first while the line is long). A 429 or a dropped read is tried again
 * twice with jitter.
 *
 * Reads asked for together (a page's first load, the views one realtime
 * change refreshes) travel as ONE app.batch request, up to twelve reads
 * each; the same read asked twice in that moment is sent once. Every caller
 * still gets its own answer or OpError, as from a call of its own; nothing
 * changes for the caller. Writes, uploads, files, public reads and calls
 * made before sign-in go alone. Why (kernel-core notes 22): each request holds several
 * of the server's pooled JS runtimes, so ten reads at once run in cold
 * throwaway runtimes and take seconds, while one batch of ten takes one.
 */
import { ClientResponseError } from 'pocketbase';
import { getPbClient } from '../../kit/index.ts';
import { OPS, PIN_OPS } from './ops.gen.ts';
import type { OpName } from './ops.gen.ts';
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

const BUSY = 'The app is busy for a moment. Try again in a few seconds.';

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
  /** The server said the last PIN was wrong. */
  wrong?: boolean | undefined;
  left?: number | undefined;
  text?: string | undefined;
}

let pinAsker: ((ask: PinAsk) => Promise<string | null>) | null = null;
/** The PIN dialog host registers itself here (components/ui.tsx PinHost). */
export function setPinAsker(fn: ((ask: PinAsk) => Promise<string | null>) | null): void {
  pinAsker = fn;
}

/** Ask for the PIN once (a batch passes it as the `pin` param). Null when cancelled. */
export function askPin(ask: PinAsk = {}): Promise<string | null> {
  if (pinAsker === null) return Promise.resolve(null);
  return pinAsker(ask);
}

function wantsPin(err: OpError): boolean {
  return err.code === 'wrong_pin' || (err.code === 'missing_param' && err.data['param'] === 'pin');
}

const pinNotSet = new Set<() => void>();
/** Listeners for "set your approval PIN first". */
export function onPinNotSet(fn: () => void): () => void {
  pinNotSet.add(fn);
  return () => {
    pinNotSet.delete(fn);
  };
}

/* ------------------------------------------------------------------ calls */

export function toOpError(err: unknown): OpError {
  if (err instanceof OpError) return err;
  if (err instanceof ClientResponseError) {
    const r = (err.response ?? {}) as { message?: string | undefined; error?: string | undefined; code?: string | undefined; data?: Record<string, unknown> | undefined };
    if (err.status === 0) return new OpError(0, err.isAbort ? 'aborted' : 'network', err.isAbort ? 'Cancelled' : 'Cannot reach the app. Check the connection.');
    return new OpError(err.status, r.code ?? String(err.status), r.message ?? r.error ?? err.message, r.data ?? {});
  }
  const e = err as { message?: string | undefined; name?: string | undefined };
  if (e.name === 'AbortError') return new OpError(0, 'aborted', 'Cancelled');
  return new OpError(0, 'error', e.message ?? 'Something went wrong');
}

function path(name: string): string {
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

/** Lists and objects travel as JSON strings (SPEC 4.1). */
function body(params: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean(params))) out[k] = typeof v === 'object' ? JSON.stringify(v) : v;
  return out;
}

export interface CallOptions {
  /** The screen shows the error itself: no toast. */
  quiet?: boolean | undefined;
  signal?: AbortSignal | undefined;
  /** Ask for the approval PIN first (every `confirm` op does anyway). */
  pin?: PinAsk | true | undefined;
}

/* ------------------------------------------------------------- the line */

const IN_FLIGHT = 6;
let inFlight = 0;
const line: { read: boolean; go: () => void }[] = [];

function nextInLine(): void {
  while (inFlight < IN_FLIGHT && line.length > 0) {
    let i = 0;
    if (line.length > IN_FLIGHT) {
      const r = line.findIndex((x) => x.read);
      if (r >= 0) i = r;
    }
    const [item] = line.splice(i, 1);
    item?.go();
  }
}

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

async function inTurn<T>(read: boolean, signal: AbortSignal | null | undefined, run: () => Promise<T>): Promise<T> {
  const back = await turn(read, signal);
  try {
    return await run();
  } finally {
    back();
  }
}

const TRIES = 3;

function retryable(err: OpError, read: boolean): boolean {
  if (err.status === 429) return true;
  return read && (err.code === 'network' || err.status === 502 || err.status === 503 || err.status === 504);
}

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

function calm(err: OpError): OpError {
  return err.status === 429 ? new OpError(429, 'busy', BUSY, err.data) : err;
}

/* -------------------------------------------------------------- the batch */

/** Reads per app.batch request (the server's limit). */
const BATCH_MAX = 12;
/** How long the first read waits for others to join it (ms). */
const GATHER_MS = 8;
/** A read whose params are longer than this goes alone (the batch is one URL). */
const PARAMS_MAX = 1500;
const BATCH_OP = 'app.batch';
/** Reads the server would not batch (they send a file or headers), learned as they come back. */
const solo = new Set<string>();

interface Waiter {
  resolve: (data: unknown) => void;
  reject: (err: OpError) => void;
  signal: AbortSignal | undefined;
  done: boolean;
}

interface Gathered {
  name: OpName;
  params: Params;
  q: Record<string, string>;
  waiters: Waiter[];
}

interface BatchResult {
  op: string;
  status: number;
  data?: unknown;
  message?: string | undefined;
  code?: string | undefined;
}

let gathering = new Map<string, Gathered>();
let gatherTimer: ReturnType<typeof setTimeout> | null = null;

function batchable(name: OpName, params: Params, q: Record<string, string>): boolean {
  if (name === BATCH_OP || solo.has(name) || !isOp(BATCH_OP)) return false;
  const spec = OPS[name] as { method: string; effect: string; perm: string };
  // Public reads are the boot's and the sign-in screen's: they go at once.
  if (spec.method !== 'GET' || spec.effect !== 'read' || spec.perm === 'public' || params['pin'] !== undefined) return false;
  if (JSON.stringify(q).length > PARAMS_MAX) return false;
  return getPbClient().pb.authStore.token !== '';
}

function give(g: Gathered, data: unknown): void {
  let first = true;
  for (const w of g.waiters) {
    if (w.done) continue;
    w.done = true;
    // A read asked twice: each caller gets its own copy, as from its own call.
    w.resolve(first ? data : structuredClone(data));
    first = false;
  }
}

function failAll(g: Gathered, err: OpError): void {
  for (const w of g.waiters) {
    if (w.done) continue;
    w.done = true;
    w.reject(err);
  }
}

/** Cancelled only when every caller in it has cancelled. */
function controllerFor(list: Gathered[]): AbortController {
  const c = new AbortController();
  const all = list.flatMap((g) => g.waiters);
  const check = (): void => {
    if (all.every((w) => w.done)) c.abort();
  };
  for (const w of all) w.signal?.addEventListener('abort', check, { once: true });
  return c;
}

async function sendGathered(list: Gathered[]): Promise<void> {
  const ctl = controllerFor(list);
  const first = list[0];
  if (first === undefined) return;
  if (list.length === 1) {
    try {
      give(first, await inTurn(true, ctl.signal, () => raw<unknown>(first.name, first.params, ctl.signal)));
    } catch (e) {
      failAll(first, toOpError(e));
    }
    return;
  }
  let results: BatchResult[];
  try {
    const calls = JSON.stringify(list.map((g) => ({ op: g.name, params: g.q })));
    const out = await inTurn(true, ctl.signal, () => getPbClient().pb.send<{ results?: BatchResult[] }>(path(BATCH_OP), { method: 'GET', query: { calls }, requestKey: null, signal: ctl.signal }));
    results = out.results ?? [];
  } catch (e) {
    const err = toOpError(e);
    for (const g of list) failAll(g, err);
    return;
  }
  list.forEach((g, i) => {
    const r = results[i];
    if (r === undefined) failAll(g, new OpError(0, 'error', 'Something went wrong'));
    else if (r.status >= 200 && r.status < 300) give(g, r.data);
    else if (r.code === 'not_batchable') {
      solo.add(g.name);
      void sendGathered([g]);
    } else failAll(g, new OpError(r.status, r.code ?? String(r.status), r.message ?? 'Something went wrong', (r.data ?? {}) as Record<string, unknown>));
  });
}

function flushGathered(): void {
  if (gatherTimer !== null) clearTimeout(gatherTimer);
  gatherTimer = null;
  const list = [...gathering.values()].filter((g) => g.waiters.some((w) => !w.done));
  gathering = new Map();
  for (let i = 0; i < list.length; i += BATCH_MAX) void sendGathered(list.slice(i, i + BATCH_MAX));
}

/** A read joins the ones asked for in the same moment; they go as one app.batch request. */
function gathered<T>(name: OpName, params: Params, q: Record<string, string>, signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new OpError(0, 'aborted', 'Cancelled'));
      return;
    }
    const key = name + ' ' + JSON.stringify(q);
    let g = gathering.get(key);
    if (g === undefined) {
      g = { name, params, q, waiters: [] };
      gathering.set(key, g);
    }
    const w: Waiter = { resolve: resolve as (data: unknown) => void, reject, signal, done: false };
    g.waiters.push(w);
    signal?.addEventListener(
      'abort',
      () => {
        if (w.done) return;
        w.done = true;
        reject(new OpError(0, 'aborted', 'Cancelled'));
      },
      { once: true },
    );
    if (gathering.size >= BATCH_MAX) flushGathered();
    else if (gatherTimer === null) gatherTimer = setTimeout(flushGathered, GATHER_MS);
  });
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
  let askNow = (opts.pin !== undefined && params['pin'] === undefined) || needsPin;
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
      const q = read ? query(send) : {};
      if (read && batchable(name, send, q)) return await gathered<T>(name, send, q, opts.signal);
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

/** True when `name` is an operation of this app's catalog. */
export function isOp(name: string): name is OpName {
  return Object.prototype.hasOwnProperty.call(OPS, name);
}

/**
 * Run an operation whose name arrived as data (a NextItem action, a command
 * from a module): checked against the catalog, then op().
 */
export function runOp<T>(name: string, params: Params = {}, opts: CallOptions = {}): Promise<T> {
  if (!isOp(name)) {
    const err = new OpError(400, 'unknown_op', `This action is not available (${name}).`);
    if (opts.quiet !== true) toast.error(err.message);
    return Promise.reject(err);
  }
  return op<T>(name, params, opts);
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

/**
 * A protected file (a document, an export) fetched with the session and
 * saved or opened. POST operations (exports with a PIN) send JSON.
 */
export async function download(name: OpName, params: Params, mode: 'save' | 'open', fallbackName = 'download'): Promise<void> {
  const pb = getPbClient().pb;
  let p = params;
  if (PIN_OPS.has(name) && params['pin'] === undefined) {
    const pin = await askPin({});
    if (pin === null) throw new OpError(0, 'aborted', 'Cancelled');
    p = { ...params, pin };
  }
  const url = new URL(pb.buildURL(path(name)));
  const get = OPS[name].method === 'GET';
  if (get) for (const [k, v] of Object.entries(query(p))) url.searchParams.set(k, v);
  const headers: Record<string, string> = pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {};
  if (!get) headers['Content-Type'] = 'application/json';
  const init: RequestInit = { method: get ? 'GET' : 'POST', headers, credentials: 'same-origin' };
  if (!get) init.body = JSON.stringify(body(p));
  const res = await inTurn(get, null, () => fetch(url.toString(), init));
  if (!res.ok) {
    let msg = res.status === 429 ? BUSY : 'Could not get the file';
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
  if (mode === 'open') {
    const link = URL.createObjectURL(blob);
    window.open(link, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(link), 60000);
    return;
  }
  saveBlob(blob, file);
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
