/**
 * App chrome: the floating sidebar (Company OS / Command Center rail),
 * the top bar (search, Ask CraftBot, notifications), the command palette
 * (Ctrl/Cmd+K) and the notifications drawer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  Copyright,
  FileSignature,
  FlaskConical,
  Gem,
  Globe2,
  Home,
  Inbox,
  Layers,
  Lightbulb,
  Menu,
  PackageCheck,
  RefreshCcw,
  Search,
  Settings,
  Shapes,
  ShieldAlert,
  Sparkles,
  Tag as TagIcon,
  Users,
} from 'lucide-react';
import { Button, Drawer, cn, useAuth, useHotkey } from '../../kit/index.ts';
import { useCollection, useLiveReload } from '../lib/live.ts';
import { op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, today, toPb } from '../lib/format.ts';
import { ROLE_LABEL } from '../lib/labels.ts';
import { navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { NotificationRec, SearchResult } from '../lib/types.ts';
import { AskCraftBot } from './craftbot.tsx';
import { IdentityChip, Kbd } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: typeof Home;
  count?: number | undefined;
  countTone?: 'bad' | 'accent' | undefined;
  match?: Page[] | undefined;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

function useNavCounts(enabled: boolean): { inbox: number; overdue: number } {
  const inbox = useCollection<{ id: string } & NotificationRec>('inbox_items', enabled ? { filter: 'status = "new" || status = "awaiting_second"' } : { filter: 'id = "__none__"' });
  const overdue = useCollection<{ id: string } & NotificationRec>('deadlines', enabled ? { filter: `status = "open" && due_date < "${toPb(today())}"` } : { filter: 'id = "__none__"' });
  return { inbox: enabled ? inbox.records.length : 0, overdue: enabled ? overdue.records.length : 0 };
}

export function Sidebar({ page }: { page: Page }): React.JSX.Element {
  const { settings, vocab, can, role, me } = useApp();
  const { logout, email } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const counts = useNavCounts(can.read);
  const org = settings?.org_name || 'IP Manager';

  const groups: NavGroup[] = useMemo(() => {
    if (role === 'inventor') {
      return [
        { label: null, items: [{ page: 'inventions', label: 'My inventions', icon: FlaskConical, match: ['invention'] }] },
        { label: null, items: [{ page: 'settings', label: 'My account', icon: Settings }] },
      ];
    }
    return [
      {
        label: 'Work',
        items: [
          { page: 'today', label: 'Today', icon: Home },
          { page: 'inbox', label: 'Inbox', icon: Inbox, count: counts.inbox, countTone: 'accent' },
          { page: 'deadlines', label: 'Deadlines', icon: CalendarClock, count: counts.overdue, countTone: 'bad' },
          { page: 'renewals', label: 'Renewals', icon: RefreshCcw },
        ],
      },
      {
        label: 'Portfolio',
        items: [
          { page: 'properties', label: vocab.properties, icon: Layers, match: ['property'] },
          { page: 'patents', label: 'Patents', icon: Lightbulb },
          { page: 'trademarks', label: 'Trademarks', icon: TagIcon },
          { page: 'designs', label: 'Designs', icon: Shapes },
          { page: 'copyrights', label: 'Copyrights', icon: Copyright },
          { page: 'works', label: vocab.works, icon: BookOpen, match: ['work'] },
          { page: 'inventions', label: 'Inventions', icon: FlaskConical, match: ['invention'] },
        ],
      },
      {
        label: 'Deals',
        items: [
          { page: 'agreements', label: 'Agreements', icon: FileSignature, match: ['agreement'] },
          { page: 'rights', label: 'Rights explorer', icon: Globe2 },
          { page: 'approvals', label: 'Product approvals', icon: PackageCheck },
        ],
      },
      {
        label: 'Protect',
        items: [{ page: 'enforcement', label: 'Watch and disputes', icon: ShieldAlert }],
      },
      {
        label: 'Organization',
        items: [
          { page: 'people', label: 'People and companies', icon: Users },
          { page: 'reports', label: 'Reports', icon: BarChart3 },
          { page: 'settings', label: 'Settings', icon: Settings },
        ],
      },
    ];
  }, [role, vocab, counts.inbox, counts.overdue]);

  const current = (item: NavItem): boolean => {
    if (item.page === page) return true;
    if (item.match?.includes(page)) return true;
    return false;
  };

  const list = (onPick?: () => void): ReactNode => (
    <nav className="flex flex-col gap-4" aria-label="Main navigation">
      {groups.map((g, gi) => (
        <div key={g.label ?? `g${gi}`} className="flex flex-col gap-px">
          {g.label !== null && (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--agent-app-muted)]/80">{g.label}</p>
          )}
          {g.items.map((item) => {
            const Icon = item.icon;
            const active = current(item);
            return (
              <button
                key={item.page}
                type="button"
                onClick={() => {
                  onPick?.();
                  navigate(item.page);
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-8 items-center gap-2.5 px-3 text-[13px] transition-colors',
                  active ? 'font-medium text-[var(--agent-app-accent)]' : 'text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30 hover:text-[var(--agent-app-text)]',
                )}
              >
                {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 bg-[var(--agent-app-accent)]" />}
                <Icon size={15} aria-hidden className={active ? '' : 'text-[var(--agent-app-muted)]'} />
                <span className="flex-1 truncate text-left">{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span
                    className={cn(
                      'min-w-5 px-1 text-center text-[10.5px] font-semibold tabular-nums',
                      item.countTone === 'bad' ? 'bg-red-500/15 text-red-700 dark:text-red-400' : 'bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)]',
                    )}
                  >
                    {item.count > 99 ? '99+' : item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const block = 'border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]';
  const brand = (
    <>
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center bg-[var(--agent-app-accent)] text-white">
        <Gem size={15} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-4">{org}</p>
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--agent-app-muted)]">IP Manager</p>
      </div>
    </>
  );
  const footer = (
    <div className="flex items-center gap-2.5">
      <IdentityChip name={me?.name || email || '?'} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">{me?.name || email}</p>
        <p className="truncate text-[10.5px] text-[var(--agent-app-muted)]">{role !== '' ? ROLE_LABEL[role] : ''}</p>
      </div>
      <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={logout}>
        Sign out
      </Button>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-2.5 p-2.5 md:flex">
        <div className={cn('flex items-center gap-2.5 px-4 py-3.5', block)}>{brand}</div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-1.5 py-3', block)}>{list()}</div>
        <div className={cn('px-3 py-3', block)}>{footer}</div>
      </aside>
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3 py-2 md:hidden">
        <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu size={18} />
        </Button>
        <p className="truncate text-sm font-semibold">{org}</p>
        <span className="w-9" aria-hidden />
      </div>
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} side="left" title={org}>
        <div className="flex h-full flex-col gap-4">
          {list(() => setMobileOpen(false))}
          <div className="mt-auto border-t border-[var(--agent-app-border)] pt-3">{footer}</div>
        </div>
      </Drawer>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

export function TopBar(): React.JSX.Element {
  const { can, me } = useApp();
  const [palette, setPalette] = useState(false);
  const [ask, setAsk] = useState(false);
  const [notes, setNotes] = useState(false);
  useHotkey('ctrl+k', () => setPalette(true));
  const unread = useCollection<NotificationRec>('notifications', me !== null ? { filter: `user = "${me.id}" && read = false` } : { filter: 'id = "__none__"' });
  return (
    <div className="mb-5 flex items-center justify-end gap-2">
      {can.read && (
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2.5 text-[13px] text-[var(--agent-app-muted)] hover:border-[var(--agent-app-accent)]/40 sm:max-w-xs"
        >
          <Search size={14} className="shrink-0" aria-hidden />
          <span className="flex-1 truncate text-left">
            <span className="sm:hidden">Search</span>
            <span className="hidden sm:inline">Search records or numbers</span>
          </span>
          <span className="hidden sm:inline-flex">
            <Kbd>Ctrl K</Kbd>
          </span>
        </button>
      )}
      {can.read && (
        <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setAsk(true)} aria-label="Ask CraftBot">
          <Sparkles size={14} aria-hidden />
          <span className="hidden sm:inline">Ask CraftBot</span>
        </Button>
      )}
      <button
        type="button"
        onClick={() => setNotes(true)}
        className="relative flex size-8 shrink-0 items-center justify-center border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]"
        aria-label={`Notifications${unread.records.length ? `, ${unread.records.length} unread` : ''}`}
      >
        <Bell size={15} />
        {unread.records.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-4 bg-[var(--agent-app-accent)] px-1 text-center text-[9.5px] font-semibold leading-4 text-[var(--agent-app-accent-contrast)]">
            {unread.records.length > 99 ? '99+' : unread.records.length}
          </span>
        )}
      </button>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      <AskCraftBot open={ask} onClose={() => setAsk(false)} />
      {notes && <NotificationsDrawer onClose={() => setNotes(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

const JUMPS: { label: string; page: Page }[] = [
  { label: 'Today', page: 'today' },
  { label: 'Inbox', page: 'inbox' },
  { label: 'Deadlines', page: 'deadlines' },
  { label: 'Renewals', page: 'renewals' },
  { label: 'Patents', page: 'patents' },
  { label: 'Trademarks', page: 'trademarks' },
  { label: 'Designs', page: 'designs' },
  { label: 'Copyrights', page: 'copyrights' },
  { label: 'Agreements', page: 'agreements' },
  { label: 'Rights explorer', page: 'rights' },
  { label: 'Inventions', page: 'inventions' },
  { label: 'Reports', page: 'reports' },
  { label: 'Settings', page: 'settings' },
];

export function CommandPalette({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const [liveTick, setLiveTick] = useState(0);
  const seenTick = useRef(0);
  useLiveReload(['matters', 'families', 'agreements', 'works', 'properties', 'disclosures', 'parties'], () => setLiveTick((t) => t + 1), q.trim().length >= 2);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const fromLive = seenTick.current !== liveTick;
    seenTick.current = liveTick;
    const t = setTimeout(() => {
      op<{ results: SearchResult[] }>('search', { q, limit: 20 })
        .then((r) => {
          if (!cancelled) {
            setResults(r.results);
            if (!fromLive) setIdx(0);
          }
        })
        .catch(() => undefined);
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, liveTick]);
  const jumps = JUMPS.filter((j) => q.trim() === '' || j.label.toLowerCase().includes(q.toLowerCase()));
  const items: { key: string; title: string; subtitle: string; go: () => void }[] = [
    ...results.map((r) => ({ key: `${r.type}${r.id}`, title: r.title, subtitle: r.subtitle, go: () => (window.location.hash = r.link) })),
    ...jumps.map((j) => ({ key: `jump-${j.page}`, title: j.label, subtitle: 'Go to page', go: () => navigate(j.page) })),
  ];
  const pick = (i: number): void => {
    const it = items[i];
    if (it === undefined) return;
    it.go();
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--agent-app-border)] px-3">
          <Search size={15} className="text-[var(--agent-app-muted)]" />
          <input
            ref={inputRef}
            className="h-11 w-full bg-transparent text-sm outline-none"
            placeholder="Search by title, reference, or any application, publication or registration number"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(items.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter') pick(idx);
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--agent-app-muted)]">No matches</div>
          ) : (
            items.map((it, i) => (
              <button
                key={it.key}
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(i)}
                className={cn('flex w-full items-center justify-between gap-3 px-4 py-2 text-left', i === idx && 'bg-[var(--agent-app-accent)]/10')}
              >
                <span className="truncate text-sm">{it.title}</span>
                <span className="shrink-0 text-xs capitalize text-[var(--agent-app-muted)]">{it.subtitle}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function NotificationsDrawer({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { me } = useApp();
  const list = useCollection<NotificationRec>('notifications', me !== null ? { filter: `user = "${me.id}"`, sort: '-created' } : { filter: 'id = "__none__"' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const markAll = async (): Promise<void> => {
    for (const n of list.records.filter((x) => !x.read)) {
      try {
        await updateRecord('notifications', n.id, { read: true });
      } catch {
        /* ignore */
      }
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title="Notifications"
      width={460}
      footer={
        list.records.some((n) => !n.read) ? (
          <Button variant="outline" size="sm" onClick={() => void markAll()}>
            Mark all as read
          </Button>
        ) : undefined
      }
    >
      {list.records.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--agent-app-muted)]">No notifications yet. Reminders, digests and Inbox alerts arrive here.</p>
      ) : (
        <div className="flex flex-col">
          {list.records.slice(0, 80).map((n) => (
            <div key={n.id} className={cn('border-b border-[var(--agent-app-border)] py-2.5', !n.read && 'bg-[var(--agent-app-accent)]/5')}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() => {
                  if (!n.read) void updateRecord('notifications', n.id, { read: true }).catch(() => undefined);
                  setExpanded(expanded === n.id ? null : n.id);
                }}
              >
                <div className="flex items-start justify-between gap-2 px-1">
                  <span className={cn('text-[13px]', !n.read && 'font-semibold')}>{n.title}</span>
                  <span className="shrink-0 text-[11px] text-[var(--agent-app-muted)]">{ago(n.created)}</span>
                </div>
              </button>
              {expanded === n.id && (
                <div className="mt-1.5 px-1">
                  {n.body !== '' && <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-[var(--agent-app-text)]/85">{n.body}</pre>}
                  {n.link !== '' && (
                    <a
                      href={n.link}
                      className="mt-1.5 inline-block text-xs font-medium text-[var(--agent-app-accent)] hover:underline"
                      onClick={onClose}
                    >
                      Open →
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
