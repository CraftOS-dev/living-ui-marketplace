/**
 * The small numbers the shell shows: what waits in the Inbox (approvals for
 * me and your AI agent's proposals), my questions your AI agent has not
 * answered yet, unread notifications, and the items of the modules' Inbox
 * sections.
 *
 * Read ONCE for the whole shell: <ShellCountsProvider> sits at the frame's
 * root, runs app.home and every module's inboxSections useItems() hook a
 * single time per refresh, and every consumer (sidebar, header, agent card,
 * Inbox page) reads the same answer with useShellCounts().
 */
import { createContext, createElement, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { allowed, useMe } from '../../lib/auth.tsx';
import { inboxSections } from '../../routes.tsx';
import type { InboxItem, InboxSection } from '../../lib/contract.ts';
import { useOp } from '../../lib/live.ts';

export interface HomeCounts {
  today: string;
  approvals_total: number;
  proposals_total: number;
  questions_asked: number;
  unread?: number | undefined;
  requested?: number | undefined;
  counts?: { people: number; starting_soon: number; leaving_soon: number; entities: number } | undefined;
  setup?: { steps: { key: string; label: string; done: boolean; link: string }[]; done: number; total: number } | undefined;
}

export interface ShellCounts {
  /** Approvals + proposals + module section items: the sidebar Inbox badge. */
  inbox: number;
  approvals: number;
  proposals: number;
  /** Items in the modules' Inbox sections the viewer may see. */
  sections: number;
  /** My questions your AI agent has not answered yet. */
  questions: number;
  unread: number;
  /** People in the company (null until known). */
  people: number | null;
  /** Each module section's items by section key (null while loading or not allowed). */
  items: Record<string, InboxItem[] | null>;
}

let SECTIONS: InboxSection[] | null = null;
/** The modules' Inbox sections, read once (lazily: routes.tsx imports pages that import this file). */
export function sections(): InboxSection[] {
  if (SECTIONS === null) SECTIONS = inboxSections();
  return SECTIONS;
}

const HOME_READS = ['approvals', 'proposals', 'agent_questions', 'notifications', 'employments', 'documents'];

const Counts = createContext<ShellCounts | null>(null);

/** Mounted once at the shell root (Frame). */
export function ShellCountsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const me = useMe();
  // Every section hook runs here and only here, in a stable order.
  const list = sections();
  const found: (InboxItem[] | null)[] = list.map((s) => s.useItems());
  const home = useOp<HomeCounts>('app.home', {}, HOME_READS, { name: 'shell.home', keep: true });
  const h = home.data;
  const value = useMemo<ShellCounts>(() => {
    const items: Record<string, InboxItem[] | null> = {};
    let n = 0;
    list.forEach((s, i) => {
      const ok = allowed(me, s.perm);
      const got = found[i] ?? null;
      items[s.key] = ok ? got : null;
      if (ok) n += got?.length ?? 0;
    });
    const approvals = h?.approvals_total ?? 0;
    const proposals = h?.proposals_total ?? 0;
    return { inbox: approvals + proposals + n, approvals, proposals, sections: n, questions: h?.questions_asked ?? 0, unread: h?.unread ?? me.unread, people: h?.counts?.people ?? null, items };
    // found holds one entry per section (a fixed count), so it can be spread into the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, me, ...found]);
  return createElement(Counts.Provider, { value }, children);
}

/** The shell's numbers (inside the frame; read from the one provider). */
export function useShellCounts(): ShellCounts {
  const c = useContext(Counts);
  if (c === null) throw new Error('useShellCounts is used outside <ShellCountsProvider>');
  return c;
}
