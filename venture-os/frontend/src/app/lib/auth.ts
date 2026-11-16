/**
 * Who is signed in. Venture OS has its own team accounts (members),
 * separate from the host: a sign-in returns a session token that rides on
 * every call (and the realtime connection) as the Authorization header. The
 * token is kept in this browser only and renewed while the app is in use.
 *
 *   const me = useMe();
 *   if (can(me, 'funds', 'edit')) ...
 *   if (allowed(me, 'committee:view|funds:view')) ...
 */
import { useSyncExternalStore } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { onSignedOut, op } from './api.ts';
import { setFirmFormat } from './format.ts';
import { forgetAll } from './live.ts';
import type { Level, Me, Module } from './types.ts';

const KEY = 'vo.session';

export type Phase = 'loading' | 'setup' | 'signed_out' | 'signed_in' | 'offline';

export interface Session {
  phase: Phase;
  me: Me | null;
  /** Why the person is on the sign-in screen. */
  notice: string;
  /** The firm's name, for the sign-in screen. */
  firm: string;
}

let state: Session = { phase: 'loading', me: null, notice: '', firm: '' };
const subs = new Set<() => void>();

function set(next: Partial<Session>): void {
  state = { ...state, ...next };
  if (state.me !== null) setFirmFormat(state.me.firm.zone, state.me.firm.date_style);
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
    /* a private window: the session lasts this tab */
  }
  const store = getPbClient().pb.authStore;
  if (token === '') store.clear();
  else store.save(token, null);
}

export function useSession(): Session {
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

let booted = false;

/** First load: is the firm set up, and is someone signed in? */
export async function boot(): Promise<void> {
  if (!booted) {
    booted = true;
    onSignedOut((code) => {
      if (state.phase !== 'signed_in') return;
      writeToken('');
      forgetAll();
      set({ phase: 'signed_out', me: null, notice: code === 'account_inactive' || code === 'account_disabled' ? 'This account is not active.' : 'Your session ended.' });
    });
  }
  // A live session first: it means the firm is set up, so the frame (and its first reads) start as soon as
  // auth.refresh answers and setup.status is not asked. One request, not two side by side: right after a restart
  // each concurrent request warms its own cold JS runtimes on the server (kernel-core notes 22), which measured slower.
  const token = readToken();
  if (token !== '') {
    writeToken(token);
    try {
      const r = await op<{ token: string; me: Me }>('auth.refresh', {}, { quiet: true });
      writeToken(r.token);
      set({ phase: 'signed_in', me: r.me, notice: '', firm: r.me.firm.name });
      startRenewing();
      return;
    } catch {
      /* no live session: setup.status decides between setup and sign in */
    }
  }
  try {
    const s = await op<{ setup_done: boolean; firm_name: string }>('setup.status', {}, { quiet: true });
    set({ firm: s.firm_name });
    if (!s.setup_done) {
      writeToken('');
      set({ phase: 'setup' });
      return;
    }
  } catch (e) {
    if ((e as { code?: string }).code === 'network') {
      set({ phase: 'offline' });
      return;
    }
  }
  if (token !== '') writeToken('');
  set({ phase: 'signed_out', notice: '' });
}

/** After sign-in, setup or accepting an invite. */
export function signedIn(token: string, me: Me): void {
  forgetAll();
  writeToken(token);
  set({ phase: 'signed_in', me, notice: '', firm: me.firm.name });
  startRenewing();
}

/** A new session token for the same person (after a password change). */
export function replaceToken(token: string): void {
  writeToken(token);
}

export async function signOut(): Promise<void> {
  try {
    await op('auth.logout', {}, { quiet: true });
  } catch {
    /* signing out never fails on screen */
  }
  writeToken('');
  forgetAll();
  set({ phase: 'signed_out', me: null, notice: '' });
}

/** Reload who I am (after my role, profile, PIN or the firm changed). */
export async function refreshMe(): Promise<void> {
  try {
    const me = await op<Me>('auth.me', {}, { quiet: true });
    set({ me });
  } catch {
    /* kept */
  }
}

/* ----------------------------------------------------------------- rights */

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, full: 3 };

export function useMe(): Me {
  const s = useSession();
  if (s.me === null) throw new Error('useMe outside a signed-in screen');
  return s.me;
}

/** The role reaches `need` in `module`. */
export function can(me: Me, module: Module, need: Level = 'view'): boolean {
  if (me.owner) return true;
  return RANK[me.levels[module] ?? 'none'] >= RANK[need];
}

/**
 * A permission written as in the catalog ('funds:edit', 'admin', 'signed',
 * 'self', alternatives with '|'), checked against me. The screen only hides
 * what a role cannot use; the server refuses it anyway.
 */
export function allowed(me: Me, perm: string | undefined): boolean {
  if (perm === undefined || perm === '' || perm === 'signed' || perm === 'self' || perm === 'public') return true;
  return perm.split('|').some((p) => {
    if (p === 'admin') return me.admin || me.owner;
    if (p === 'owner') return me.owner;
    const [mod, lvl] = p.split(':');
    return can(me, (mod ?? '') as Module, (lvl ?? 'view') as Level);
  });
}
