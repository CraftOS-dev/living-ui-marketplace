/**
 * Auth hook (spec B4, multi-user mode) — thin wrapper over PB's users auth.
 * State derives from pb.authStore; login/register/logout go through the
 * client seam. Also exposes the account's `role`/`approved` (Company OS access
 * control) and a `refresh()` so a just-approved user can pick up access without
 * signing out. Login/register errors are thrown (not toasted) so the login
 * screen can render them inline.
 */
import { useCallback, useEffect, useState } from 'react';
import { getPbClient } from './client.ts';

export interface AuthState {
  userId: string | null;
  email: string | null;
  /** 'owner' | 'admin' | 'member' | null (null until known). */
  role: string | null;
  approved: boolean;
  /** True once the initial token validation has settled (avoids UI flashes). */
  authReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-fetch the account (e.g. after an admin approves it). */
  refresh: () => Promise<void>;
}

export function useAuth(): AuthState {
  const client = getPbClient();
  const record = (): Record<string, unknown> | null =>
    client.pb.authStore.record as unknown as Record<string, unknown> | null;

  const [userId, setUserId] = useState<string | null>((record()?.['id'] as string | undefined) ?? null);
  const [email, setEmail] = useState<string | null>((record()?.['email'] as string | undefined) ?? null);
  const [role, setRole] = useState<string | null>((record()?.['role'] as string | undefined) ?? null);
  const [approved, setApproved] = useState<boolean>(Boolean(record()?.['approved']));
  const [authReady, setAuthReady] = useState<boolean>(client.pb.authStore.record === null);

  const sync = useCallback((): void => {
    const r = record();
    setUserId((r?.['id'] as string | undefined) ?? null);
    setEmail((r?.['email'] as string | undefined) ?? null);
    setRole((r?.['role'] as string | undefined) ?? null);
    setApproved(Boolean(r?.['approved']));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => client.pb.authStore.onChange(() => sync()), [client, sync]);

  // A persisted token can outlive the record it points at (recycled loopback
  // ports), and it can be stale after an admin changes the account's access.
  // Validate + refresh once on mount; clear if the token is truly stale.
  useEffect(() => {
    if (client.pb.authStore.record === null) {
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    void client.pb
      .collection('users')
      .authRefresh()
      .catch(() => {
        if (!cancelled) client.pb.authStore.clear();
      })
      .finally(() => {
        if (!cancelled) {
          sync();
          setAuthReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, sync]);

  const login = useCallback(
    async (loginEmail: string, password: string): Promise<void> => {
      await client.call((pb) => pb.collection('users').authWithPassword(loginEmail, password), { silent: true });
    },
    [client],
  );

  const register = useCallback(
    async (registerEmail: string, password: string): Promise<void> => {
      await client.call(
        (pb) => pb.collection('users').create({ email: registerEmail, password, passwordConfirm: password }),
        { silent: true },
      );
      await login(registerEmail, password);
    },
    [client, login],
  );

  const logout = useCallback((): void => {
    client.pb.authStore.clear();
  }, [client]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await client.pb.collection('users').authRefresh();
    } catch {
      client.pb.authStore.clear();
    }
    sync();
  }, [client, sync]);

  return { userId, email, role, approved, authReady, login, register, logout, refresh };
}
