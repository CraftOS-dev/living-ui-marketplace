/**
 * App chrome: the floating sidebar, the top bar (search, language, Ask
 * CraftBot, notifications), the command palette (Ctrl/Cmd+K) and the
 * notifications drawer. Nav items follow the organization's modules and the
 * person's role; external accounts see only their portal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BadgeCheck,
  BarChart3,
  Bell,
  BookMarked,
  CalendarClock,
  Clapperboard,
  FileSignature,
  Film,
  Gavel,
  Home,
  Inbox,
  Landmark,
  Languages,
  Menu,
  Mic2,
  Music,
  Package,
  ReceiptJapaneseYen,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Stamp,
  Tag as TagIcon,
  Users,
  UserRound,
} from 'lucide-react';
import { Button, Drawer, cn, useAuth, useHotkey } from '../../kit/index.ts';
import { useCollection, useLiveReload } from '../lib/live.ts';
import { op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, today, toPb } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { NotificationRec } from '../lib/records.ts';
import type { ModuleKey, SearchHit } from '../lib/shapes.ts';
import { AskCraftBot } from './craftbot.tsx';
import { IdentityChip, Kbd } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: typeof Home;
  module?: ModuleKey | undefined;
  count?: number | undefined;
  countTone?: 'bad' | 'accent' | undefined;
  match?: Page[] | undefined;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

function useNavCounts(enabled: boolean): { inbox: number; overdue: number; approvals: number } {
  const none = { filter: 'id = "__none__"' };
  const inbox = useCollection<NotificationRec>('inbox_items', enabled ? { filter: 'status = "new" || status = "awaiting_second"' } : none);
  const overdue = useCollection<NotificationRec>('deadlines', enabled ? { filter: `status = "open" && due_date < "${toPb(today())}"` } : none);
  const approvals = useCollection<NotificationRec>('approvals', enabled ? { filter: '(status = "submitted" || status = "in_review") && due_date < "' + toPb(today()) + '"' } : none);
  return { inbox: enabled ? inbox.records.length : 0, overdue: enabled ? overdue.records.length : 0, approvals: enabled ? approvals.records.length : 0 };
}

/** Every internal nav group (the plan's navigation), before module and role filtering. */
function internalGroups(counts: { inbox: number; overdue: number; approvals: number }): NavGroup[] {
  return [
    {
      label: t('Work'),
      items: [
        { page: 'today', label: t('Today'), icon: Home },
        { page: 'inbox', label: t('Inbox'), icon: Inbox, count: counts.inbox, countTone: 'accent' },
        { page: 'deadlines', label: t('Deadlines'), icon: CalendarClock, count: counts.overdue, countTone: 'bad' },
        { page: 'approvals', label: t('Approvals'), icon: Stamp, module: 'approvals', count: counts.approvals, countTone: 'bad' },
      ],
    },
    {
      label: t('IP'),
      items: [
        { page: 'franchises', label: t('Franchises'), icon: Clapperboard, module: 'franchises', match: ['franchise'] },
        { page: 'characters', label: t('Characters'), icon: UserRound, match: ['character'] },
        { page: 'talents', label: t('Talents'), icon: Mic2, module: 'talents', match: ['talent'] },
        { page: 'titles', label: t('Titles'), icon: Film, module: 'titles', match: ['title'] },
        { page: 'music', label: t('Music'), icon: Music, module: 'music', match: ['song', 'recording'] },
      ],
    },
    {
      label: t('Rights'),
      items: [
        { page: 'canwe', label: t('Can we?'), icon: Scale },
        { page: 'committees', label: t('Committees'), icon: Landmark, module: 'committees', match: ['committee'] },
        { page: 'agreements', label: t('Agreements'), icon: FileSignature, match: ['agreement'] },
        { page: 'permissions', label: t('Third-party permissions'), icon: BadgeCheck, module: 'permissions' },
      ],
    },
    {
      label: t('Licensing'),
      items: [
        { page: 'products', label: t('Products'), icon: Package, module: 'products', match: ['product'] },
        { page: 'royalties', label: t('Royalties and seals'), icon: ReceiptJapaneseYen, module: 'royalties' },
      ],
    },
    {
      label: t('Protect'),
      items: [
        { page: 'trademarks', label: t('Trademarks and designs'), icon: TagIcon, match: ['matter', 'family', 'renewals'] },
        { page: 'enforcement', label: t('Enforcement'), icon: ShieldAlert, match: ['case'] },
        { page: 'guidelines', label: t('Guidelines and fans'), icon: BookMarked, module: 'guidelines' },
      ],
    },
    {
      label: t('Organization|nav group'),
      items: [
        { page: 'people', label: t('People and companies'), icon: Users },
        { page: 'reports', label: t('Reports'), icon: BarChart3 },
        { page: 'settings', label: t('Settings'), icon: Settings },
      ],
    },
  ];
}

export function Sidebar({ page }: { page: Page }): React.JSX.Element {
  const { settings, can, role, me, on } = useApp();
  const { logout, email } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const counts = useNavCounts(can.read);
  const org = settings?.org_name || t('Entertainment IP Manager');

  const groups: NavGroup[] = useMemo(() => {
    if (can.external) {
      return [
        { label: null, items: [{ page: 'portal', label: t('My portal'), icon: Home }] },
        { label: null, items: [{ page: 'settings', label: t('My account'), icon: Settings }] },
      ];
    }
    return internalGroups(counts)
      .map((g) => ({ ...g, items: g.items.filter((i) => i.module === undefined || on(i.module)) }))
      .filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can.external, on, counts.inbox, counts.overdue, counts.approvals]);

  const current = (item: NavItem): boolean => item.page === page || (item.match?.includes(page) ?? false);

  const list = (onPick?: () => void): ReactNode => (
    <nav className="flex flex-col gap-4" aria-label={t('Main navigation')}>
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
        <Gavel size={15} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-4">{org}</p>
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Entertainment IP Manager')}</p>
      </div>
    </>
  );
  const footer = (
    <div className="flex items-center gap-2.5">
      <IdentityChip name={me?.name || email || '?'} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">{me?.name || email}</p>
        <p className="truncate text-[10.5px] text-[var(--agent-app-muted)]">{role !== '' ? enumLabel('users.role', role) : ''}</p>
      </div>
      <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={logout}>
        {t('Sign out')}
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
        <Button variant="ghost" size="icon" aria-label={t('Open navigation')} onClick={() => setMobileOpen(true)}>
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

export function LanguageSwitch(): React.JSX.Element {
  const { lang, changeLang } = useApp();
  return (
    <button
      type="button"
      onClick={() => changeLang(lang === 'ja' ? 'en' : 'ja')}
      className="flex h-8 shrink-0 items-center gap-1.5 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 text-[12px] font-medium text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]"
      aria-label={lang === 'ja' ? 'Switch to English' : '日本語に切り替え'}
      title={lang === 'ja' ? 'Switch to English' : '日本語に切り替え'}
    >
      <Languages size={14} aria-hidden />
      {lang === 'ja' ? 'EN' : '日本語'}
    </button>
  );
}

export function TopBar(): React.JSX.Element {
  const { can, me } = useApp();
  const [palette, setPalette] = useState(false);
  const [ask, setAsk] = useState(false);
  const [notes, setNotes] = useState(false);
  useHotkey('ctrl+k', () => {
    if (can.read) setPalette(true);
  });
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
            <span className="sm:hidden">{t('Search')}</span>
            <span className="hidden sm:inline">{t('Search names, codes or numbers')}</span>
          </span>
          <span className="hidden sm:inline-flex">
            <Kbd>Ctrl K</Kbd>
          </span>
        </button>
      )}
      <LanguageSwitch />
      {can.read && (
        <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setAsk(true)} aria-label={t('Ask CraftBot')}>
          <Sparkles size={14} aria-hidden />
          <span className="hidden sm:inline">{t('Ask CraftBot')}</span>
        </Button>
      )}
      <button
        type="button"
        onClick={() => setNotes(true)}
        className="relative flex size-8 shrink-0 items-center justify-center border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]"
        aria-label={unread.records.length ? t('Notifications, {n} unread', { n: unread.records.length }) : t('Notifications')}
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

function jumps(): { label: string; page: Page; module?: ModuleKey }[] {
  return [
    { label: t('Today'), page: 'today' },
    { label: t('Inbox'), page: 'inbox' },
    { label: t('Deadlines'), page: 'deadlines' },
    { label: t('Franchises'), page: 'franchises', module: 'franchises' },
    { label: t('Characters'), page: 'characters' },
    { label: t('Talents'), page: 'talents', module: 'talents' },
    { label: t('Titles'), page: 'titles', module: 'titles' },
    { label: t('Music'), page: 'music', module: 'music' },
    { label: t('Can we?'), page: 'canwe' },
    { label: t('Agreements'), page: 'agreements' },
    { label: t('Committees'), page: 'committees', module: 'committees' },
    { label: t('Products'), page: 'products', module: 'products' },
    { label: t('Approvals'), page: 'approvals', module: 'approvals' },
    { label: t('Royalties and seals'), page: 'royalties', module: 'royalties' },
    { label: t('Trademarks and designs'), page: 'trademarks' },
    { label: t('Renewals'), page: 'renewals' },
    { label: t('Enforcement'), page: 'enforcement' },
    { label: t('Reports'), page: 'reports' },
    { label: t('Settings'), page: 'settings' },
  ];
}

const SEARCH_SOURCES = ['franchises', 'titles', 'characters', 'talents', 'songs', 'recordings', 'matters', 'agreements', 'products', 'enforcement_cases', 'parties'];

export function CommandPalette({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { on } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const [liveTick, setLiveTick] = useState(0);
  const seenTick = useRef(0);
  useLiveReload(SEARCH_SOURCES, () => setLiveTick((x) => x + 1), q.trim().length >= 2);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const fromLive = seenTick.current !== liveTick;
    seenTick.current = liveTick;
    const timer = setTimeout(() => {
      op<{ results: SearchHit[] }>('search', { q, limit: 20 })
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
      clearTimeout(timer);
    };
  }, [q, liveTick]);
  const pages = jumps().filter((j) => (j.module === undefined || on(j.module)) && (q.trim() === '' || j.label.toLowerCase().includes(q.toLowerCase())));
  const items: { key: string; title: string; subtitle: string; go: () => void }[] = [
    ...results.map((r) => ({ key: `${r.type}${r.id}`, title: r.title, subtitle: searchTypeLabel(r.type), go: () => (window.location.hash = r.link) })),
    ...pages.map((j) => ({ key: `jump-${j.page}`, title: j.label, subtitle: t('Go to page'), go: () => navigate(j.page) })),
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
            placeholder={t('Search names in any script, ISRC, ISWC, JAN or any trademark number')}
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
            <div className="px-4 py-6 text-center text-sm text-[var(--agent-app-muted)]">{t('No matches')}</div>
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
                <span className="shrink-0 text-xs text-[var(--agent-app-muted)]">{it.subtitle}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Search result type ("character", "product", ...) in words. */
export function searchTypeLabel(type: string): string {
  return (
    {
      franchise: t('Franchise'),
      title: t('Title'),
      work: t('Title'),
      character: t('Character'),
      talent: t('Talent'),
      song: t('Song'),
      recording: t('Recording'),
      matter: t('Trademark or design'),
      trademark: t('Trademark'),
      design: t('Design'),
      family: t('Mark family'),
      agreement: t('Agreement'),
      product: t('Product'),
      case: t('Case'),
      party: t('Person or company'),
    }[type] ?? type
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
      title={t('Notifications')}
      width={460}
      footer={
        list.records.some((n) => !n.read) ? (
          <Button variant="outline" size="sm" onClick={() => void markAll()}>
            {t('Mark all as read')}
          </Button>
        ) : undefined
      }
    >
      {list.records.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--agent-app-muted)]">{t('No notifications yet. Reminders, digests and Inbox alerts arrive here.')}</p>
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
                    <a href={n.link} className="mt-1.5 inline-block text-xs font-medium text-[var(--agent-app-accent)] hover:underline" onClick={onClose}>
                      {t('Open|action')}
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
