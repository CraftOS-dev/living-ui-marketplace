/**
 * Who is signed in. The app has its own team accounts (members), separate
 * from the host: a sign-in returns a session token that rides on every call
 * (and on the realtime connection) as the Authorization header. The token is
 * kept in this browser only and renewed while the app is in use.
 */
import { useSyncExternalStore } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { onSignedOut, op } from './api.ts';
import type { Me } from './types.ts';

const KEY = 'erp.session';

export type Phase = 'loading' | 'setup' | 'signed_out' | 'signed_in';

interface State {
  phase: Phase;
  me: Me | null;
  /** Why the person is looking at the sign-in screen (expired, signed out elsewhere). */
  notice: string;
  /** The company's name, for the sign-in screen. */
  company: string;
}

let state: State = { phase: 'loading', me: null, notice: '', company: '' };
const subs = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  for (const fn of subs) fn();
}

function readToken(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

function writeToken(token: string): void {
  try {
    if (token === '') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, token);
  } catch {
    /* private window: the session lasts this tab */
  }
  const store = getPbClient().pb.authStore;
  if (token === '') store.clear();
  else store.save(token, null);
}

export function useSession(): State {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => state,
  );
}

export function currentMe(): Me | null {
  return state.me;
}

let renewTimer: ReturnType<typeof setInterval> | null = null;

function startRenewing(): void {
  if (renewTimer !== null) return;
  // A fresh token every 12 hours of use keeps a 30-day session alive.
  renewTimer = setInterval(() => void renew(), 12 * 3600 * 1000);
}

async function renew(): Promise<void> {
  try {
    const r = await op<{ token: string; me: Me }>('auth.refresh', {}, { quiet: true });
    writeToken(r.token);
    set({ me: r.me });
  } catch {
    /* the next call says if the session is gone */
  }
}

/** First load: is the company set up, and is someone signed in? */
export async function boot(): Promise<void> {
  onSignedOut(() => {
    if (state.phase !== 'signed_in') return;
    writeToken('');
    set({ phase: 'signed_out', me: null, notice: 'Your session ended. Sign in again.' });
  });
  try {
    const s = await op<{ setup_done: boolean; company_name: string }>('setup.status', {}, { quiet: true });
    set({ company: s.company_name });
    if (!s.setup_done) {
      writeToken('');
      set({ phase: 'setup' });
      return;
    }
  } catch {
    /* fall through: the sign-in screen shows what is wrong */
  }
  const token = readToken();
  if (token === '') {
    set({ phase: 'signed_out' });
    return;
  }
  writeToken(token);
  try {
    const r = await op<{ token: string; me: Me }>('auth.refresh', {}, { quiet: true });
    writeToken(r.token);
    set({ phase: 'signed_in', me: r.me, notice: '' });
    startRenewing();
  } catch {
    writeToken('');
    set({ phase: 'signed_out', notice: '' });
  }
}

/** After sign-in, setup or accepting an invite. */
export function signedIn(token: string, me: Me): void {
  writeToken(token);
  set({ phase: 'signed_in', me, notice: '' });
  startRenewing();
}

export async function signOut(): Promise<void> {
  try {
    await op('auth.logout', {}, { quiet: true });
  } catch {
    /* signing out never fails on screen */
  }
  writeToken('');
  set({ phase: 'signed_out', me: null, notice: '' });
}

/** Reload who I am (after my role, profile or the company changed). */
export async function refreshMe(): Promise<void> {
  try {
    const me = await op<Me>('auth.me', {}, { quiet: true });
    set({ me });
  } catch {
    /* kept */
  }
}
