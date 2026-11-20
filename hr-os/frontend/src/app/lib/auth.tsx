/**
 * Who is signed in. HR OS has its own team accounts (members), separate from
 * the host: a sign-in returns a session token that rides on every call (and
 * on the realtime connection) as the Authorization header. The token is kept
 * in this browser only and renewed while the app is in use.
 *
 *   const me = useMe();
 *   if (can(me, 'payroll', 'edit')) ...
 *   if (isManager(me)) ...           // team scope (direct and indirect reports)
 */
import { useSyncExternalStore } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { onSignedOut, op } from './api.ts';
import { forgetAll } from './live.ts';
import { setDateStyles } from './format.ts';
import { setReportingCurrency } from './money.ts';
import type { Level, Me, Module } from './types.ts';

const KEY = 'hr.session';

export type Phase = 'loading' | 'setup' | 'signed_out' | 'signed_in' | 'offline';

interface State {
  phase: Phase;
  me: Me | null;
  /** Why the person is on the sign-in screen ("Your session ended."). */
  notice: string;
  /** The company's name, for the sign-in screen. */
  company: string;
  /** The company logo files ('' = none), for the sign-in screen. */
  logo: { light: string; dark: string };
}

let state: State = { phase: 'loading', me: null, notice: '', company: '', logo: { light: '', dark: '' } };
const subs = new Set<() => void>();

/** Each country's date format (from the public country list), read once at boot. */
let countryFormats: Record<string, string> | undefined;

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  // Money shows the symbol only for this currency (see money.ts); days follow the company's date style (format.ts).
  setReportingCurrency(state.me?.company.reporting_currency ?? '');
  const own = state.me?.employee?.employments.find((x) => x.status !== 'ended')?.entity ?? state.me?.employee?.employments[0]?.entity ?? '';
  setDateStyles(state.me?.company.date_style ?? 'entity', state.me?.entities ?? [], countryFormats, own);
  for (const fn of subs) fn();
}

async function loadCountryFormats(): Promise<void> {
  try {
    const r = await op<{ countries: { code: string; date_format: string }[] }>('setup.countries', {}, { quiet: true });
    countryFormats = Object.fromEntries(r.countries.map((c) => [c.code, c.date_format]));
  } catch {
    countryFormats = {};
  }
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

let booted = false;

/** First load: is the company set up, and is someone signed in? */
export async function boot(): Promise<void> {
  if (!booted) {
    booted = true;
    onSignedOut((code) => {
      if (state.phase !== 'signed_in') return;
      writeToken('');
      forgetAll();
      set({ phase: 'signed_out', me: null, notice: code === 'account_inactive' || code === 'account_disabled' ? 'This account is no longer active. Ask an administrator.' : 'Your session ended. Sign in again.' });
    });
  }
  const formats = countryFormats === undefined ? loadCountryFormats() : Promise.resolve();
  try {
    const s = await op<{ setup_done: boolean; company_name: string; logo?: string | undefined; logo_dark?: string | undefined }>('setup.status', {}, { quiet: true });
    set({ company: s.company_name, logo: { light: s.logo ?? '', dark: s.logo_dark ?? '' } });
    if (!s.setup_done) {
      writeToken('');
      set({ phase: 'setup' });
      return;
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'network') {
      set({ phase: 'offline' });
      return;
    }
  }
  await formats;
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
  forgetAll();
  writeToken(token);
  set({ phase: 'signed_in', me, notice: '', company: me.company.name });
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

/** Reload who I am (after my role, profile, PIN or the company changed). */
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

/** A manager by reporting line (sees and approves for the team without module rights). */
export function isManager(me: Me): boolean {
  return me.manages > 0 || me.role?.team_scope === true;
}

/** People-side admin (sees the whole directory). */
export function isPeopleAdmin(me: Me): boolean {
  return can(me, 'people', 'view');
}

/** Pay figures are visible to this person for others (payroll view, or managers when the company allows it). */
export function seesPay(me: Me): boolean {
  return can(me, 'payroll', 'view') || (isManager(me) && me.company.managers_see_pay);
}

/**
 * A permission written as in the catalog ('people:edit', 'admin', 'signed',
 * 'self', 'team', alternatives with '|'), checked against me.
 */
export function allowed(me: Me, perm: string | undefined): boolean {
  if (perm === undefined || perm === '' || perm === 'signed' || perm === 'self' || perm === 'public') return true;
  return perm.split('|').some((p) => {
    if (p === 'admin') return can(me, 'admin', 'edit');
    if (p === 'owner') return me.owner;
    if (p === 'team') return isManager(me);
    if (p === 'employee') return me.employee !== null;
    const [mod, lvl] = p.split(':');
    return can(me, (mod ?? '') as Module, (lvl ?? 'view') as Level);
  });
}
