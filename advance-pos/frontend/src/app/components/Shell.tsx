/**
 * App frame: a full-height app. On wide screens a slim icon rail on the left
 * (labels on hover, counts on the icons that have something waiting, the
 * signed-in person at the bottom with the lock); on phones a bottom bar.
 * Pages a role cannot use are not in the rail. The sell screen fills the
 * whole page area.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BadgePercent, Boxes, ChartColumn, Clock, History, Inbox, KeyRound, Lock, Menu, MonitorSmartphone, Package, ReceiptText, Settings, ShoppingBag, Users, UsersRound, Wallet } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { SECTION, href, navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import type { PermKey } from '../lib/types.ts';
import { Avatar } from './common.tsx';
import { ChangePin } from './ChangePin.tsx';
import { Popover, menuItem } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
  need?: PermKey;
}

const GROUPS: NavItem[][] = [
  [
    { page: 'home', label: 'Sell', icon: ShoppingBag },
    { page: 'orders', label: 'Sales', icon: ReceiptText },
    { page: 'customers', label: 'Customers', icon: Users },
  ],
  [
    { page: 'products', label: 'Products', icon: Package },
    { page: 'stock', label: 'Stock', icon: Boxes },
    { page: 'promotions', label: 'Promotions and gift cards', icon: BadgePercent },
  ],
  [
    { page: 'drawer', label: 'Cash drawer', icon: Wallet },
    { page: 'reports', label: 'Reports', icon: ChartColumn, need: 'view_reports' },
    { page: 'team', label: 'Team', icon: UsersRound, need: 'manage_staff' },
    { page: 'activity', label: 'Activity', icon: History, need: 'view_reports' },
    { page: 'requests', label: 'Requests to your AI agent', icon: Inbox },
  ],
  [{ page: 'settings', label: 'Settings', icon: Settings, need: 'manage_settings' }],
];

/** The app's mark: a receipt with a torn edge, accent on an ink tile. */
export function Mark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="ps-on-ink shrink-0">
      <rect width="40" height="40" rx="9" fill="var(--ps-ink)" />
      <path d="M12 9 H28 V31 L25.3 29 L22.7 31 L20 29 L17.3 31 L14.7 29 L12 31 Z" fill="var(--ps-accent)" />
      <rect x="15.5" y="14" width="9" height="2" rx="1" fill="var(--ps-ink)" />
      <rect x="15.5" y="19" width="6" height="2" rx="1" fill="var(--ps-ink)" />
    </svg>
  );
}

function useBadges(): Partial<Record<Page, number>> {
  const { status } = useStore();
  if (status === null) return {};
  return { requests: status.open_requests, stock: status.low_stock };
}

function Count({ n }: { n: number | undefined }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return (
    <span className="num absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ps-accent)] px-1 text-[12px] font-bold leading-none text-[var(--ps-on-accent)] ring-2 ring-[var(--ps-card)]">
      {n > 99 ? '99+' : n}
    </span>
  );
}

function RailButton({ item, active, badge }: { item: NavItem; active: boolean; badge: number | undefined }): React.JSX.Element {
  const Icon = item.icon;
  return (
    <a
      href={href(item.page)}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex size-11 shrink-0 items-center justify-center rounded-[var(--ps-r)] transition-colors',
        active ? 'bg-[var(--ps-row-hover)] text-[var(--ps-ink)]' : 'text-[var(--ps-muted)] hover:bg-[var(--ps-row)] hover:text-[var(--ps-ink)]',
      )}
    >
      {active && <span aria-hidden className="absolute -left-2 bottom-2 top-2 w-0.5 rounded-r bg-[var(--ps-accent)]" />}
      <Icon size={18} strokeWidth={active ? 2.2 : 1.9} />
      <Count n={badge} />
      <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-[var(--ps-r)] bg-[var(--ps-ink)] px-2 py-1 text-[12px] font-semibold text-[var(--ps-shell)] opacity-0 shadow-[var(--ps-shadow)] transition-opacity group-hover:opacity-100">
        {item.label}
      </span>
    </a>
  );
}

/** The signed-in person: who, where, and the account actions. */
function Account({ placement }: { placement: 'rail' | 'bar' }): React.JSX.Element {
  const { staff, register, lock } = useSession();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  if (staff === null) return <span />;
  const clock = async (): Promise<void> => {
    setOpen(false);
    try {
      const r = await api.clock(undefined, 'toggle');
      toast.success(r.staff.name + (r.action === 'in' ? ' clocked in' : ' clocked out'));
    } catch {
      // Shown by the transport.
    }
  };
  return (
    <div className="relative">
      <button ref={btn} type="button" aria-label={'Signed in: ' + staff.name} title={staff.name} onClick={() => setOpen((o) => !o)} className="flex size-11 shrink-0 items-center justify-center rounded-[var(--ps-r)] hover:bg-[var(--ps-row)]">
        <Avatar name={staff.name} color={staff.color} size={28} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} className={cn('w-60', placement === 'rail' ? 'bottom-0 left-[calc(100%+8px)] top-auto' : 'bottom-[calc(100%+8px)] right-0 top-auto left-auto')}>
        <div className="flex items-center gap-2 px-2 pb-2 pt-1">
          <Avatar name={staff.name} color={staff.color} size={32} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold">{staff.name}</p>
            <p className="truncate text-[12px] capitalize text-[var(--ps-muted)]">
              {staff.role}
              {register !== null ? ' · ' + register.name : ''}
            </p>
          </div>
        </div>
        <div className="border-t border-[var(--ps-hair)] pt-1">
          <button type="button" className={menuItem} onClick={() => void clock()}>
            <Clock size={15} />
            Clock in or out
          </button>
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              setOpen(false);
              setPin(true);
            }}
          >
            <KeyRound size={15} />
            Change my PIN
          </button>
          {register !== null && (
            <a className={menuItem} href={href('display', { register: register.id })} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              <MonitorSmartphone size={15} />
              Open the customer display
            </a>
          )}
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              setOpen(false);
              lock();
            }}
          >
            <Lock size={15} />
            Lock the register
          </button>
        </div>
      </Popover>
      <ChangePin open={pin} onClose={() => setPin(false)} />
    </div>
  );
}

function visible(items: NavItem[], can: (k: PermKey) => boolean): NavItem[] {
  return items.filter((it) => it.need === undefined || can(it.need));
}

function Rail({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const section = SECTION[page];
  const { can, lock } = useSession();
  const groups = GROUPS.map((g) => visible(g, can));
  return (
    <aside className="sticky top-0 z-30 hidden h-screen w-[60px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-[var(--ps-line)] bg-[var(--ps-card)] py-2 md:flex">
      <a href={href('home')} className="mb-1 flex size-11 shrink-0 items-center justify-center" aria-label="Sell">
        <Mark size={28} />
      </a>
      {groups.slice(0, 3).map(
        (g, i) =>
          g.length > 0 && (
            <nav key={i} className="flex flex-col items-center gap-1 border-t border-[var(--ps-hair)] pt-1" aria-label={['Selling', 'Catalog', 'Back office'][i]}>
              {g.map((it) => (
                <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
              ))}
            </nav>
          ),
      )}
      <span className="flex-1" />
      <nav className="flex flex-col items-center gap-1" aria-label="Store">
        {(groups[3] ?? []).map((it) => (
          <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
        ))}
        <button type="button" onClick={lock} aria-label="Lock the register" title="Lock the register" className="group relative flex size-11 shrink-0 items-center justify-center rounded-[var(--ps-r)] text-[var(--ps-muted)] hover:bg-[var(--ps-row)] hover:text-[var(--ps-ink)]">
          <Lock size={17} />
        </button>
        <Account placement="rail" />
      </nav>
    </aside>
  );
}

function MobileBar({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const section = SECTION[page];
  const { can } = useSession();
  const all = visible(GROUPS.flat(), can);
  const pinned: Page[] = ['home', 'orders', 'customers', 'products'];
  const inMore = !pinned.includes(section);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-[var(--ps-line)] bg-[var(--ps-card)] px-2 md:hidden">
      {all
        .filter((it) => pinned.includes(it.page))
        .map((it) => {
          const Icon = it.icon;
          const active = it.page === section;
          return (
            <a key={it.page} href={href(it.page)} aria-label={it.label} aria-current={active ? 'page' : undefined} className={cn('relative flex size-11 items-center justify-center rounded-[var(--ps-r)]', active ? 'bg-[var(--ps-row-hover)] text-[var(--ps-ink)]' : 'text-[var(--ps-muted)]')}>
              <Icon size={19} />
              <Count n={badges[it.page]} />
            </a>
          );
        })}
      <div className="relative">
        <button ref={moreBtn} type="button" aria-label="More pages" onClick={() => setMore((m) => !m)} className={cn('relative flex size-11 items-center justify-center rounded-[var(--ps-r)]', inMore ? 'bg-[var(--ps-row-hover)] text-[var(--ps-ink)]' : 'text-[var(--ps-muted)]')}>
          <Menu size={19} />
        </button>
        <Popover open={more} onClose={() => setMore(false)} keep={moreBtn} align="right" className="bottom-[calc(100%+8px)] top-auto w-56">
          {all
            .filter((it) => !pinned.includes(it.page))
            .map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.page}
                  type="button"
                  onClick={() => {
                    setMore(false);
                    navigate(it.page);
                  }}
                  className={cn(menuItem, it.page === section && 'bg-[var(--ps-row)]')}
                >
                  <Icon size={15} />
                  <span className="flex-1">{it.label}</span>
                  {(badges[it.page] ?? 0) > 0 && <span className="num text-[12px] font-bold text-[var(--ps-accent-text)]">{badges[it.page]}</span>}
                </button>
              );
            })}
        </Popover>
      </div>
      <Account placement="bar" />
    </div>
  );
}

export function Frame({ page, children, wide = false }: { page: Page; children: ReactNode; wide?: boolean }): React.JSX.Element {
  const badges = useBadges();
  return (
    <div className="flex min-h-screen bg-[var(--ps-shell)]">
      <Rail page={page} badges={badges} />
      <main className={cn('min-w-0 flex-1', wide ? 'h-[calc(100dvh-56px)] overflow-hidden md:h-screen' : 'px-3 pb-20 pt-4 md:px-6 md:pb-8 md:pt-5')}>
        {wide ? children : <div className="mx-auto w-full max-w-[1280px]">{children}</div>}
      </main>
      <MobileBar page={page} badges={badges} />
    </div>
  );
}
