/**
 * This device: which register it is, and who is signed in on it.
 *
 * A browser is one register (chosen once, remembered here). The person at
 * it signs in with their PIN and gets a session token, sent with every
 * operation as X-Pos-Session; locking the register ends the session. The
 * token lives in this browser only (local storage); losing it just means
 * signing in again.
 */
import { useSyncExternalStore } from 'react';
import type { SessionInfo, Staff } from './types.ts';

const REGISTER_KEY = 'pos.register';
const SESSION_KEY = 'pos.session';

interface State {
  register: string;
  session: SessionInfo | null;
}

function read(): State {
  let register = '';
  let session: SessionInfo | null = null;
  try {
    register = window.localStorage.getItem(REGISTER_KEY) ?? '';
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as SessionInfo;
      if (typeof parsed.token === 'string' && Date.parse(parsed.expires) > Date.now()) session = parsed;
    }
  } catch {
    /* storage blocked: the person signs in again */
  }
  return { register, session };
}

let state: State = read();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

export const session = {
  get(): State {
    return state;
  },
  token(): string {
    return state.session?.token ?? '';
  },
  staff(): Staff | null {
    return state.session?.staff ?? null;
  },
  setRegister(id: string): void {
    state = { ...state, register: id };
    store(REGISTER_KEY, id);
    emit();
  },
  signIn(info: SessionInfo): void {
    state = { ...state, session: info };
    store(SESSION_KEY, JSON.stringify(info));
    emit();
  },
  /** Refresh what we know about the signed-in person (role, training mode). */
  updateStaff(staff: Staff): void {
    if (state.session === null || state.session.staff.id !== staff.id) return;
    state = { ...state, session: { ...state.session, staff } };
    store(SESSION_KEY, JSON.stringify(state.session));
    emit();
  },
  /** The session ended (locked, expired or refused): back to the PIN pad. */
  clear(): void {
    if (state.session === null) return;
    state = { ...state, session: null };
    store(SESSION_KEY, null);
    emit();
  },
};

const snapshot = (): State => state;

export function useSession(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Another tab of this browser signing in or out follows here.
window.addEventListener('storage', (e) => {
  if (e.key === REGISTER_KEY || e.key === SESSION_KEY) {
    state = read();
    emit();
  }
});

/** May the signed-in person do this without a manager? */
export function can(action: Staff['permissions'][number]): boolean {
  const s = state.session?.staff;
  return s !== undefined && s.permissions.includes(action);
}
