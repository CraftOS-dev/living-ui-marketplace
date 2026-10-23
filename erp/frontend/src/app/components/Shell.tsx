/**
 * The app frame: a warm canvas holding one rounded shell.
 *
 * Wide screens: a labelled sidebar on the left. Modules expand as trees
 * (chevron and an inline "+" on the parent row, the pages flush under it);
 * counts sit on the entries with work waiting. The sidebar folds into an
 * icon rail. Search (Ctrl K) sits at the top.
 *
 * Phones: a floating bottom bar (Home, Needs you, the raised "+", Search,
 * Menu); Menu opens the whole tree as a sheet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronsLeft, ChevronsRight, CircleUser, House, Inbox, LogOut, Menu as MenuIcon, Plus, Search, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { READS, useLive } from '../lib/live.ts';
import { useMe } from '../lib/me.ts';
import { SETTINGS_ENTRY, buildNav, groupOf } from '../lib/nav.ts';
import type { NavEntry, NavGroup, NavItem, NavSingle } from '../lib/nav.ts';
import { baseSection, navigate, useSectionOverride } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';
import { signOut } from '../lib/session.ts';
import { useCreate } from './Create.tsx';
import { usePalette } from './Palette.tsx';
import { Avatar, CountBadge, MenuRow, Popover } from './ui.tsx';

/* ----------------------------------------------------------------- data */

interface NeedCounts {
  counts: Record<string, number>;
}

interface BankBrief {
  id: string;
  name: string;
  unmatched: number;
  archived: boolean;
}

function useBadges(): { counts: Record<string, number>; banks: BankBrief[] } {
  const me = useMe();
  const needs = useLive(() => op<NeedCounts>('home.needs', {}, { quiet: true }), [...READS.agent, ...READS.docs, 'bank_lines', 'leave_requests', 'expense_claims', 'timesheets', 'inbox'], []);
  const canBank = me.levels.banking !== 'none' && me.modules.banking !== false;
  const banks = useLive(() => (canBank ? op<{ banks: BankBrief[] }>('banks.list', {}, { quiet: true }) : Promise.resolve({ banks: [] as BankBrief[] })), ['banks', 'bank_lines'], [canBank]);
  const counts: Record<string, number> = { ...(needs.data?.counts ?? {}) };
  const list = (banks.data?.banks ?? []).filter((b) => !b.archived);
  for (const b of list) counts[`bank:${b.id}`] = b.unmatched;
  return { counts, banks: list };
}

/* ------------------------------------------------------------- the mark */

/** The app's mark: a ledger page with an accent corner. */
export function Mark({ size = 36 }: { size?: number | undefined }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="erp-on-ink shrink-0">
      <circle cx="20" cy="20" r="20" fill="var(--erp-ink)" />
      <rect x="11" y="10" width="18" height="20" rx="3.5" fill="var(--erp-shell)" />
      <rect x="14.5" y="15" width="11" height="2.2" rx="1.1" fill="var(--erp-ink)" />
      <rect x="14.5" y="19.4" width="8" height="2.2" rx="1.1" fill="var(--erp-ink)" />
      <circle cx="27" cy="27" r="5.5" fill="var(--erp-accent)" />
    </svg>
  );
}

/* ---------------------------------------------------------------- state */

const OPEN_KEY = 'erp.nav.open';
const FOLD_KEY = 'erp.nav.folded';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, v: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* kept for this tab */
  }
}

function go(x: { page: NavEntry['page']; query?: NavEntry['query'] | undefined }): void {
  navigate(x.page, x.query);
}

/* -------------------------------------------------------------- sidebar */

function SingleRow({ item, active, badge, folded, after }: { item: NavSingle; active: boolean; badge: number; folded: boolean; after?: (() => void) | undefined }): React.JSX.Element {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => {
        go(item);
        after?.();
      }}
      aria-current={active ? 'page' : undefined}
      title={folded ? item.label : undefined}
      className={cn(
        'group relative flex h-11 w-full items-center gap-3 rounded-full text-left text-[14px] font-semibold transition-colors',
        folded ? 'justify-center px-0' : 'px-1.5',
        active ? 'bg-[var(--erp-card)] text-[var(--erp-ink)] shadow-[0_8px_20px_-16px_rgba(29,28,26,0.5)]' : 'text-[var(--erp-ink-2)] hover:bg-[var(--erp-card)]/70 hover:text-[var(--erp-ink)]',
      )}
    >
      <span className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-full', active ? 'bg-[var(--erp-solid)] text-[var(--erp-on-solid)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)]')}>
        <Icon size={16} strokeWidth={2} aria-hidden />
        {folded && <CountBadge n={badge} />}
      </span>
      {!folded && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!folded && badge > 0 && <span className="num mr-1.5 rounded-full bg-[var(--erp-accent)] px-2 text-[12px] font-bold leading-5 text-[var(--erp-on-accent)]">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

function GroupRows({
  group,
  open,
  onToggle,
  active,
  counts,
  folded,
  after,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  active: string;
  counts: Record<string, number>;
  folded: boolean;
  after?: (() => void) | undefined;
}): React.JSX.Element {
  const Icon = group.icon;
  const has = group.entries.some((x) => x.key === active);
  const total = group.entries.reduce((s, x) => s + (x.badge !== undefined ? (counts[x.badge] ?? 0) : 0), 0);
  const [flyout, setFlyout] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  if (folded) {
    return (
      <div className="relative">
        <button
          ref={btn}
          type="button"
          onClick={() => setFlyout((f) => !f)}
          title={group.label}
          aria-label={group.label}
          aria-expanded={flyout}
          className={cn('relative flex h-11 w-full items-center justify-center rounded-full transition-colors', has ? 'bg-[var(--erp-card)]' : 'hover:bg-[var(--erp-card)]/70')}
        >
          <span className={cn('relative flex size-8 items-center justify-center rounded-full', has ? 'bg-[var(--erp-solid)] text-[var(--erp-on-solid)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)]')}>
            <Icon size={16} aria-hidden />
            <CountBadge n={total} />
          </span>
        </button>
        {flyout && (
          <Popover open onClose={() => setFlyout(false)} keep={btn} side="right" className="w-60">
            <p className="px-3 pb-1 pt-1.5 text-[12px] font-bold text-[var(--erp-muted)]">{group.label}</p>
            {group.entries.map((x) => (
              <MenuRow
                key={x.key}
                label={x.label}
                active={x.key === active}
                hint={x.badge !== undefined && (counts[x.badge] ?? 0) > 0 ? String(counts[x.badge]) : undefined}
                onClick={() => {
                  setFlyout(false);
                  go(x);
                }}
              />
            ))}
            {group.create !== undefined && (
              <MenuRow
                icon={Plus}
                label={group.create.label}
                onClick={() => {
                  setFlyout(false);
                  if (group.create !== undefined) go(group.create);
                }}
              />
            )}
          </Popover>
        )}
      </div>
    );
  }
  return (
    <div>
      <div className={cn('group flex h-11 items-center gap-1 rounded-full pr-1 transition-colors', !open && has ? 'bg-[var(--erp-card)]' : 'hover:bg-[var(--erp-card)]/70')}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex h-full min-w-0 flex-1 items-center gap-3 pl-1.5 text-left text-[14px] font-semibold text-[var(--erp-ink)]">
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', has ? 'bg-[var(--erp-solid)] text-[var(--erp-on-solid)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)]')}>
            <Icon size={16} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate">{group.label}</span>
          {!open && total > 0 && <span className="num rounded-full bg-[var(--erp-accent)] px-2 text-[12px] font-bold leading-5 text-[var(--erp-on-accent)]">{total > 99 ? '99+' : total}</span>}
          <ChevronDown size={15} aria-hidden className={cn('shrink-0 text-[var(--erp-muted)] transition-transform', open ? 'rotate-0' : '-rotate-90')} />
        </button>
        {group.create !== undefined && (
          <button
            type="button"
            aria-label={group.create.label}
            title={group.create.label}
            onClick={() => {
              if (group.create !== undefined) go(group.create);
              after?.();
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--erp-ink-2)] hover:bg-[var(--erp-row)] hover:text-[var(--erp-ink)]"
          >
            <Plus size={15} strokeWidth={2.4} />
          </button>
        )}
      </div>
      {open && (
        <div className="mb-1 mt-0.5 flex flex-col gap-0.5">
          {group.entries.map((x) => {
            const on = x.key === active;
            const n = x.badge !== undefined ? (counts[x.badge] ?? 0) : 0;
            return (
              <button
                key={x.key}
                type="button"
                onClick={() => {
                  go(x);
                  after?.();
                }}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex h-9 w-full items-center gap-3 rounded-full pl-[18px] pr-2 text-left text-[13px] font-semibold transition-colors',
                  on ? 'bg-[var(--erp-card)] text-[var(--erp-ink)] shadow-[0_8px_20px_-16px_rgba(29,28,26,0.5)]' : 'text-[var(--erp-ink-2)] hover:bg-[var(--erp-card)]/70 hover:text-[var(--erp-ink)]',
                )}
              >
                <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', on ? 'bg-[var(--erp-accent)]' : 'bg-[var(--erp-line)]')} />
                <span className="min-w-0 flex-1 truncate">{x.label}</span>
                {n > 0 && <span className="num rounded-full bg-[var(--erp-row)] px-2 text-[12px] font-bold leading-5 text-[var(--erp-ink)]">{n > 99 ? '99+' : n}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavTree({ nav, active, counts, folded, onPick }: { nav: NavItem[]; active: string; counts: Record<string, number>; folded: boolean; onPick?: (() => void) | undefined }): React.JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>(() => readJSON(OPEN_KEY, { sales: true }));
  const current = groupOf(nav, active);
  useEffect(() => {
    if (current !== null && open[current] !== true) {
      setOpen((o) => {
        const next = { ...o, [current]: true };
        writeJSON(OPEN_KEY, next);
        return next;
      });
    }
    // Open the group of the page shown, once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  // Keep the current page's entry in view in a long, scrolling menu.
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }), 60);
    return () => clearTimeout(t);
  }, [active, open]);
  const toggle = (k: string): void =>
    setOpen((o) => {
      const next = { ...o, [k]: o[k] !== true };
      writeJSON(OPEN_KEY, next);
      return next;
    });
  return (
    <nav ref={navRef} aria-label="Main" className="flex flex-col gap-0.5">
      {nav.map((n) =>
        n.kind === 'single' ? (
          <SingleRow key={n.item.key} item={n.item} active={n.item.key === active} badge={n.item.badge !== undefined ? (counts[n.item.badge] ?? 0) : 0} folded={folded} after={onPick} />
        ) : (
          <GroupRows key={n.group.key} group={n.group} open={open[n.group.key] === true} onToggle={() => toggle(n.group.key)} active={active} counts={counts} folded={folded} after={onPick} />
        ),
      )}
    </nav>
  );
}

function ProfileButton({ folded, after }: { folded: boolean; after?: (() => void) | undefined }): React.JSX.Element {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="You"
        className={cn('flex h-12 w-full items-center gap-3 rounded-full text-left transition-colors hover:bg-[var(--erp-card)]/70', folded ? 'justify-center' : 'px-1.5')}
      >
        <Avatar name={me.member.name} size={32} tone="ink" />
        {!folded && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold">{me.member.name}</span>
            <span className="block truncate text-[12px] text-[var(--erp-muted)]">{me.role.name}</span>
          </span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} up className="w-60">
        <MenuRow
          icon={CircleUser}
          label="Your profile"
          onClick={() => {
            setOpen(false);
            navigate('profile');
            after?.();
          }}
        />
        <MenuRow
          icon={LogOut}
          label="Sign out"
          onClick={() => {
            setOpen(false);
            void signOut();
          }}
        />
      </Popover>
    </div>
  );
}

function Sidebar({ nav, active, counts }: { nav: NavItem[]; active: string; counts: Record<string, number> }): React.JSX.Element {
  const me = useMe();
  const [folded, setFolded] = useState<boolean>(() => readJSON(FOLD_KEY, false));
  const palette = usePalette();
  const fold = (v: boolean): void => {
    setFolded(v);
    writeJSON(FOLD_KEY, v);
  };
  return (
    <aside className={cn('sticky top-4 z-20 hidden h-[calc(100vh-32px)] shrink-0 flex-col py-5 md:flex', folded ? 'w-[84px] px-3' : 'w-[264px] px-4')}>
      <div className={cn('mb-4 flex items-center gap-3', folded ? 'flex-col' : 'px-1')}>
        <button type="button" onClick={() => navigate('home')} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Home">
          <Mark size={36} />
          {!folded && (
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold">{me.company.name}</span>
              <span className="block text-[12px] text-[var(--erp-muted)]">ERP</span>
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => fold(!folded)}
          aria-label={folded ? 'Show the menu' : 'Fold the menu'}
          title={folded ? 'Show the menu' : 'Fold the menu'}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--erp-muted)] hover:bg-[var(--erp-card)] hover:text-[var(--erp-ink)]"
        >
          {folded ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
      <div className={cn('mb-4 flex', folded ? 'justify-center' : '')}>
        <button
          type="button"
          onClick={() => palette.open()}
          aria-label="Search"
          className={cn('flex h-11 items-center gap-2 rounded-full bg-[var(--erp-card)] text-[13px] font-semibold text-[var(--erp-muted)] transition-colors hover:text-[var(--erp-ink)]', folded ? 'w-11 justify-center' : 'min-w-0 flex-1 px-4')}
        >
          <Search size={16} aria-hidden />
          {!folded && <span className="min-w-0 flex-1 truncate text-left">Search</span>}
          {!folded && <kbd className="rounded-full bg-[var(--erp-row)] px-2 py-0.5 font-sans text-[12px] font-semibold text-[var(--erp-ink-2)]">Ctrl K</kbd>}
        </button>
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        <NavTree nav={nav} active={active} counts={counts} folded={folded} />
      </div>
      <div className="mt-2 flex flex-col gap-0.5 border-t border-[var(--erp-line)] pt-3">
        <SingleRow item={SETTINGS_ENTRY} active={active === 'settings'} badge={0} folded={folded} />
        <ProfileButton folded={folded} />
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------- phone */

function MobileBar({ nav, active, counts }: { nav: NavItem[]; active: string; counts: Record<string, number> }): React.JSX.Element {
  const [sheet, setSheet] = useState(false);
  const palette = usePalette();
  const create = useCreate();
  const tab = (key: string, label: string, Icon: typeof House, onClick: () => void, badge = 0): React.JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active === key ? 'page' : undefined}
      className={cn('relative flex size-11 items-center justify-center rounded-full', active === key ? 'bg-[var(--erp-solid)] text-[var(--erp-on-solid)]' : 'text-[var(--erp-ink-2)]')}
    >
      <Icon size={19} />
      <CountBadge n={badge} />
    </button>
  );
  const others = Object.entries(counts)
    .filter(([k]) => k !== 'total')
    .reduce((s, [, v]) => s + v, 0);
  return (
    <>
      <div className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-full bg-[var(--erp-card)] px-3 py-2 shadow-[0_18px_40px_-18px_rgba(29,28,26,0.55)] md:hidden">
        {tab('home', 'Home', House, () => navigate('home'))}
        {tab('needs', 'Needs you', Inbox, () => navigate('needs'), counts.total ?? 0)}
        <button
          type="button"
          aria-label="New"
          onClick={(e) => create.open(e.currentTarget)}
          className="-mt-8 flex size-14 items-center justify-center rounded-full bg-[var(--erp-solid)] text-[var(--erp-on-solid)] shadow-[0_14px_30px_-12px_rgba(29,28,26,0.7)] active:scale-95"
        >
          <Plus size={24} strokeWidth={2.4} />
        </button>
        {tab('search', 'Search', Search, () => palette.open())}
        {tab('menu', 'Menu', MenuIcon, () => setSheet(true), others > 0 && (counts.total ?? 0) === 0 ? others : 0)}
      </div>
      {sheet && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close the menu" className="absolute inset-0 bg-black/40" onClick={() => setSheet(false)} />
          <div className="erp-pop absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-[28px] bg-[var(--erp-shell)] px-4 pb-8 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-3">
                <Mark size={32} />
                <span className="text-[15px] font-bold">Menu</span>
              </span>
              <button type="button" onClick={() => setSheet(false)} aria-label="Close" className="flex size-10 items-center justify-center rounded-full bg-[var(--erp-row)]">
                <X size={16} />
              </button>
            </div>
            <NavTree nav={nav} active={active} counts={counts} folded={false} onPick={() => setSheet(false)} />
            <div className="mt-3 flex flex-col gap-0.5 border-t border-[var(--erp-line)] pt-3">
              <SingleRow item={SETTINGS_ENTRY} active={active === 'settings'} badge={0} folded={false} after={() => setSheet(false)} />
              <ProfileButton folded={false} after={() => setSheet(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- frame */

export function Frame({ route, children }: { route: Route; children: ReactNode }): React.JSX.Element {
  const me = useMe();
  const { counts, banks } = useBadges();
  const nav = useMemo(() => buildNav(me, banks), [me, banks]);
  const override = useSectionOverride(route.page);
  const active = override ?? baseSection(route);
  return (
    <div className="min-h-screen bg-[var(--erp-canvas)] md:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1560px] bg-[var(--erp-shell)] md:min-h-[calc(100vh-32px)] md:rounded-[36px]">
        <Sidebar nav={nav} active={active} counts={counts} />
        {/* A size container: pages lay out by the width they get (the sidebar, a narrow host panel), not by the window. */}
        <main className="@container min-w-0 flex-1 px-4 pb-32 pt-6 md:py-8 md:pl-2 md:pr-8">{children}</main>
      </div>
      <MobileBar nav={nav} active={active} counts={counts} />
    </div>
  );
}
