/**
 * Who is at the register. A person signs in with their PIN and gets a
 * session for this device's register; the register locks itself after the
 * idle time set in Settings (and, when set, after every sale), and when the
 * server says the session ended. The open sale is kept on the server, so
 * the next person picks it up where it was.
 *
 * Phases: loading, setup (the store is new), locked (the PIN screen),
 * ready, and unreachable (the store server cannot be reached).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { OpError, api, onSignedOut, setTill } from './api.ts';
import type { PermKey, Permissions, SetupStatus, StaffBrief, Unlock, Ref } from './types.ts';

const SESSION_KEY = 'pos.session.v1';
const REGISTER_KEY = 'pos.register.v1';

interface Stored {
  till: string;
  staff: StaffBrief;
  register: Ref;
  permissions: Permissions;
  expires: number;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const s = JSON.parse(raw) as Stored;
    if (typeof s.till !== 'string' || s.till === '' || typeof s.expires !== 'number' || s.expires < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

function writeStored(s: Stored | null): void {
  try {
    if (s === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // Storage off (private mode): the session lasts until the page reloads.
  }
}

/** This device's register (each till remembers its own). */
export function readDeviceRegister(): string {
  try {
    return localStorage.getItem(REGISTER_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDeviceRegister(id: string): void {
  try {
    localStorage.setItem(REGISTER_KEY, id);
  } catch {
    // Not remembered across reloads; the lock screen asks again.
  }
}

export type Phase = 'loading' | 'setup' | 'locked' | 'ready' | 'unreachable';

export interface SessionValue {
  phase: Phase;
  setup: SetupStatus | null;
  staff: StaffBrief | null;
  register: Ref | null;
  permissions: Permissions | null;
  can: (k: PermKey) => boolean;
  /** Sign in with what auth.unlock (or setup.complete) answered. */
  signIn: (u: Unlock) => void;
  lock: () => void;
  /** Re-read the store's setup status (after setup, register changes). */
  reload: () => void;
  deviceRegister: string;
  setDeviceRegister: (id: string) => void;
  /** Lock after the idle time (minutes; 0 never). */
  setIdleMinutes: (m: number) => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (v === null) throw new Error('useSession outside SessionProvider');
  return v;
}

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading');
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [user, setUser] = useState<Stored | null>(null);
  const [deviceRegister, setDeviceRegisterState] = useState(readDeviceRegister);
  const idle = useRef(0);
  const lastActive = useRef(Date.now());
  const expires = useRef(0);

  const lock = useCallback(() => {
    setTill('');
    writeStored(null);
    setUser(null);
    setPhase((p) => (p === 'setup' || p === 'loading' ? p : 'locked'));
  }, []);

  const load = useCallback(async () => {
    let st: SetupStatus;
    try {
      st = await api.setupStatus();
    } catch {
      setPhase('unreachable');
      return;
    }
    setSetup(st);
    if (!st.setup_done) {
      setPhase('setup');
      return;
    }
    if (idle.current === 0) idle.current = st.lock_idle_minutes;
    const stored = readStored();
    if (stored === null) {
      setPhase('locked');
      return;
    }
    setTill(stored.till);
    try {
      const s = await api.session();
      const next: Stored = { ...stored, staff: s.staff ?? stored.staff, register: s.register ?? stored.register, permissions: s.permissions };
      writeStored(next);
      setUser(next);
      expires.current = next.expires;
      lastActive.current = Date.now();
      setPhase('ready');
    } catch (err) {
      if (err instanceof OpError && err.status === 0) {
        setPhase('unreachable');
        return;
      }
      setTill('');
      writeStored(null);
      setPhase('locked');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onSignedOut(lock);
    return () => onSignedOut(null);
  }, [lock]);

  const signIn = useCallback((u: Unlock) => {
    const s: Stored = { till: u.till, staff: u.staff, register: u.register, permissions: u.permissions, expires: Date.now() + u.expires_in * 1000 - 60000 };
    setTill(u.till);
    writeStored(s);
    setUser(s);
    expires.current = s.expires;
    writeDeviceRegister(u.register.id);
    setDeviceRegisterState(u.register.id);
    lastActive.current = Date.now();
    setPhase('ready');
  }, []);

  const setDeviceRegister = useCallback((id: string) => {
    writeDeviceRegister(id);
    setDeviceRegisterState(id);
  }, []);

  const setIdleMinutes = useCallback((m: number) => {
    idle.current = m;
  }, []);

  // Idle lock: any touch, click or key counts as activity.
  useEffect(() => {
    if (phase !== 'ready') return;
    const mark = (): void => {
      lastActive.current = Date.now();
    };
    const opts = { passive: true, capture: true } as const;
    window.addEventListener('pointerdown', mark, opts);
    window.addEventListener('keydown', mark, opts);
    window.addEventListener('wheel', mark, opts);
    const t = setInterval(() => {
      const m = idle.current;
      if (m > 0 && Date.now() - lastActive.current > m * 60000) lock();
      else if (expires.current > 0 && expires.current < Date.now()) lock();
    }, 10000);
    return () => {
      window.removeEventListener('pointerdown', mark, opts);
      window.removeEventListener('keydown', mark, opts);
      window.removeEventListener('wheel', mark, opts);
      clearInterval(t);
    };
  }, [phase, lock]);

  const value = useMemo<SessionValue>(
    () => ({
      phase,
      setup,
      staff: user?.staff ?? null,
      register: user?.register ?? null,
      permissions: user?.permissions ?? null,
      can: (k) => user?.permissions[k] === true,
      signIn,
      lock,
      reload: () => void load(),
      deviceRegister,
      setDeviceRegister,
      setIdleMinutes,
    }),
    [phase, setup, user, signIn, lock, load, deviceRegister, setDeviceRegister, setIdleMinutes],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
