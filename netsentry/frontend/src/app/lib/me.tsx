/**
 * The signed-in member and what their role allows. UI gating only — the
 * server enforces the same rules on every operation.
 *
 * Reads the auth store directly instead of calling the kit's useAuth(): every
 * useAuth() instance fires an authRefresh on mount, and with more than one
 * instance the SDK auto-cancels the duplicate request — which useAuth treats as
 * an invalid session and clears, unmounting the app behind LoginGate, which
 * remounts on the surviving refresh… an infinite loop. LoginGate keeps the one
 * useAuth() the app needs.
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { getPbClient } from '../../kit/index.ts';
import { useRecord } from '../store/collections.ts';
import type { Member, Role } from './types.ts';

const LEVEL: Record<Role, number> = { auditor: 1, viewer: 1, analyst: 2, admin: 3 };

export interface Me {
  member: Member | null;
  role: Role;
  loading: boolean;
  can: (min: Role) => boolean;
  logout: () => void;
}

const Ctx = createContext<Me>({ member: null, role: 'viewer', loading: true, can: () => false, logout: () => undefined });

function subscribe(onChange: () => void): () => void {
  return getPbClient().pb.authStore.onChange(onChange);
}

function currentUserId(): string | null {
  return getPbClient().pb.authStore.record?.id ?? null;
}

export function MeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const userId = useSyncExternalStore(subscribe, currentUserId);
  const { record, loading } = useRecord<Member>('users', userId);
  const role: Role = record?.role === 'admin' || record?.role === 'analyst' || record?.role === 'auditor' ? record.role : 'viewer';
  const value: Me = {
    member: record,
    role,
    loading,
    can: (min) => LEVEL[role] >= LEVEL[min],
    // Reload after clearing: the kit's LoginGate stays mounted across sign-out and
    // would keep the previous user's email/password in its form, and a reload
    // also drops every in-memory record from the previous session.
    logout: () => {
      getPbClient().pb.authStore.clear();
      window.location.reload();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMe(): Me {
  return useContext(Ctx);
}
