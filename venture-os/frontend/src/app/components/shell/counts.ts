/**
 * The small numbers the shell shows, read ONCE for the whole frame: the
 * Next count (total and by kind, for the top bar and sidebar badges), your
 * AI agent's open requests (sent in the last 24 hours, or being worked on;
 * read from the platform's request rows), unread notifications. Every
 * consumer reads the same answer with useShellCounts().
 */
import { createContext, createElement, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AgentRequestRecord } from '../../../kit/index.ts';
import { useOp } from '../../lib/live.ts';
import type { NextCount, NextKind } from '../../lib/types.ts';
import { useRequests } from '../agent.tsx';

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  created: string;
}

export interface ShellCounts {
  next: number;
  byKind: Partial<Record<NextKind, number>>;
  /** Requests open with your AI agent (sent in the last 24 hours, or being worked on). */
  asked: number;
  /** Requests your AI agent is working on now. */
  working: number;
  unread: number;
  /** The latest notifications (the bell's list). */
  notifications: Notification[] | null;
  /** The open requests (the agent card and panel). */
  openRequests: AgentRequestRecord[];
}

const Counts = createContext<ShellCounts | null>(null);

export function ShellCountsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const next = useOp<NextCount>('next.count', {}, ['*'], { name: 'shell.next', keep: true });
  const open = useRequests({ open: true, limit: 30, name: 'shell.requests' });
  const notes = useOp<{ notifications: Notification[]; unread: number }>('notifications.list', { limit: 30 }, ['notifications'], { name: 'shell.notifications', keep: true });
  const value = useMemo<ShellCounts>(
    () => ({
      next: next.data?.total ?? 0,
      byKind: next.data?.by_kind ?? {},
      asked: (open.data ?? []).length,
      working: (open.data ?? []).filter((r) => r.status === 'claimed').length,
      unread: notes.data?.unread ?? 0,
      notifications: notes.data?.notifications ?? null,
      openRequests: open.data ?? [],
    }),
    [next.data, open.data, notes.data],
  );
  return createElement(Counts.Provider, { value }, children);
}

export function useShellCounts(): ShellCounts {
  const c = useContext(Counts);
  if (c === null) throw new Error('useShellCounts is used outside <ShellCountsProvider>');
  return c;
}
