/**
 * Client for the app's custom verbs (/api/ops/*). Uses the PB client's base
 * URL + auth token so calls work identically in dev (Vite) and production
 * (PocketBase serving the SPA), and satisfy the routes' auth guard.
 */
import { getPbClient } from '../../kit/index.ts';

export class OpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function callOp<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const pb = getPbClient().pb;
  const base = pb.baseURL.replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new OpError(res.status, message);
  }
  return data as T;
}
