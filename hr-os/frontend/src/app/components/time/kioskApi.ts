/**
 * The kiosk tablet's calls. The kiosk operations (kiosk.roster, kiosk.punch,
 * kiosk.photo) are public: the tablet proves itself with the device token
 * it got when HR started it, sent in the X-Kiosk-Device header (never in a
 * query string, so it stays out of logs). The token lives in this tablet's
 * storage only; clearing the browser data stops the kiosk until HR starts it
 * again.
 */
import { ClientResponseError } from 'pocketbase';
import { getPbClient } from '../../../kit/index.ts';
import { OpError } from '../../lib/api.ts';

const KEY = 'hr.kiosk.';

export function kioskToken(code: string): string {
  try {
    return window.localStorage.getItem(KEY + code.toUpperCase()) ?? '';
  } catch {
    return '';
  }
}

export function setKioskToken(code: string, token: string): void {
  try {
    if (token === '') window.localStorage.removeItem(KEY + code.toUpperCase());
    else window.localStorage.setItem(KEY + code.toUpperCase(), token);
  } catch {
    /* private mode: the kiosk asks to be started again */
  }
}

function toError(err: unknown): OpError {
  if (err instanceof ClientResponseError) {
    const r = (err.response ?? {}) as { message?: string; code?: string; data?: Record<string, unknown> };
    if (err.status === 0) return new OpError(0, 'network', 'Cannot reach the app right now.');
    return new OpError(err.status, r.code ?? String(err.status), r.message ?? err.message, r.data ?? {});
  }
  return new OpError(0, 'error', (err as { message?: string }).message ?? 'Something went wrong');
}

/** One kiosk call with the tablet token. */
export async function kioskCall<T>(name: 'kiosk.roster' | 'kiosk.punch', code: string, params: Record<string, unknown>): Promise<T> {
  const pb = getPbClient().pb;
  const verb = name.slice(name.indexOf('.') + 1);
  const headers = { 'X-Kiosk-Device': kioskToken(code) };
  try {
    if (name === 'kiosk.roster') {
      const q: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q[k] = String(v);
      return await pb.send<T>('/api/ops/kiosk/' + verb, { method: 'GET', query: q, headers, requestKey: null });
    }
    return await pb.send<T>('/api/ops/kiosk/' + verb, { method: 'POST', body: params, headers, requestKey: null });
  } catch (e) {
    throw toError(e);
  }
}

const photos = new Map<string, string>();

/** A person's photo as an object URL (fetched once with the tablet token); '' when none. */
export async function kioskPhoto(code: string, employee: string): Promise<string> {
  const k = code + ':' + employee;
  const have = photos.get(k);
  if (have !== undefined) return have;
  try {
    const pb = getPbClient().pb;
    const url = new URL(pb.buildURL('/api/ops/kiosk/photo'));
    url.searchParams.set('code', code);
    url.searchParams.set('employee', employee);
    const res = await fetch(url.toString(), { headers: { 'X-Kiosk-Device': kioskToken(code) }, credentials: 'same-origin' });
    if (!res.ok) {
      photos.set(k, '');
      return '';
    }
    const u = URL.createObjectURL(await res.blob());
    photos.set(k, u);
    return u;
  } catch {
    return '';
  }
}
