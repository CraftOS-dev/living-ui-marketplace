/**
 * App frame: a warm canvas holding one rounded shell. On wide screens a slim
 * rail on the left: the mark, then the pages in white pill groups (labels
 * appear on hover, counts sit on the icons that have something waiting) and
 * the person signed in at the bottom. On phones a floating bar with the sale
 * button raised in the middle. Pages a person's role cannot use are not
 * shown to them.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChartPie, ChefHat, KeyRound, Lock, Menu, Package, ReceiptText, Settings, ShoppingBag, Store, Users, Wallet } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useCart } from '../lib/cart.ts';
import { useApp } from '../lib/context.tsx';
import { ROLE_LABEL } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { saleSheet } from '../lib/saleSheet.ts';
import { session, useSession } from '../lib/session.ts';
import type { Action } from '../lib/types.ts';
import { ChangePin } from './ChangePin.tsx';
import { Avatar, Badge, Popover, menuItem } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
  /** Shown when the person may do any of these (empty: everyone). */
  needs: Action[];
  group: 'counter' | 'office' | 'setup';
}

const NAV: NavItem[] = [
  { page: 'register', label: 'Register', icon: Store, needs: [], group: 'counter' },
  { page: 'orders', label: 'Orders', icon: ReceiptText, needs: [], group: 'counter' },
  { page: 'kitchen', label: 'Kitchen', icon: ChefHat, needs: ['kitchen'], group: 'counter' },
  { page: 'products', label: 'Products', icon: Package, needs: ['catalog', 'stock'], group: 'office' },
  { page: 'customers', label: 'Customers', icon: Users, needs: [], group: 'office' },
  { page: 'shifts', label: 'Cash and shifts', icon: Wallet, needs: ['shift'], group: 'office' },
  { page: 'reports', label: 'Reports', icon: ChartPie, needs: ['reports'], group: 'office' },
  { page: 'settings', label: 'Settings', icon: Settings, needs: ['settings', 'staff'], group: 'setup' },
];

/** The app's mark: a receipt on an ink disc, its total line in the accent. */
export function Mark({ size = 40 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="ps-on-ink shrink-0">
      <circle cx="20" cy="20" r="20" fill="var(--ps-ink)" />
      <path d="M13 10h14v20l-2.33 -1.7 -2.34 1.7 -2.33 -1.7 -2.33 1.7 -2.34 -1.7 -2.33 1.7z" fill="var(--ps-shell)" />
      <rect x="16" y="14.5" width="8" height="1.8" rx="0.9" fill="var(--ps-ink)" opacity="0.28" />
      <rect x="16" y="18.2" width="5.5" height="1.8" rx="0.9" fill="var(--ps-ink)" opacity="0.28" />
      <rect x="16" y="22.4" width="8" height="2.8" rx="1.4" fill="var(--ps-accent)" />
    </svg>
  );
}

function visible(item: NavItem, perms: Action[], kitchen: boolean): boolean {
  if (item.page === 'kitchen' && !kitchen) return false;
  return item.needs.length === 0 || item.needs.some((a) => perms.includes(a));
}

function useBadges(): Partial<Record<Page, number>> {
  const s = useApp().status;
  if (s === null) return {};
  return { register: s.agent_tickets, kitchen: s.kitchen_open, products: s.drafts + s.low_stock };
}

function Dot({ n }: { n: number | undefined }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return (
    <span className="num absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--ps-accent-fill)] px-1 text-[12px] font-bold leading-none text-[var(--ps-on-accent)] ring-2 ring-[var(--ps-card)]">
      {n > 99 ? '99+' : n}
    </span>
  );
}

function RailButton({ item, active, badge }: { item: NavItem; active: boolean; badge: number | undefined }): React.JSX.Element {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => navigate(item.page)}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex size-11 shrink-0 items-center justify-center rounded-full transition-colors',
        active ? 'bg-[var(--ps-solid)] text-[var(--ps-on-solid)]' : 'text-[var(--ps-muted)] hover:bg-[var(--ps-row)] hover:text-[var(--ps-ink)]',
      )}
    >
      <Icon size={19} strokeWidth={active ? 2.2 : 1.9} />
      <Dot n={badge} />
      <span className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-full bg-[var(--ps-ink)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ps-shell)] opacity-0 transition-opacity group-hover:opacity-100">
        {item.label}
      </span>
    </button>
  );
}

/** The person signed in: their badge, and lock or change PIN. */
function Me({ placement }: { placement: 'rail' | 'bar' }): React.JSX.Element | null {
  const { session: s } = useSession();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  if (s === null) return null;
  const st = s.staff;
  const lock = (): void => {
    setOpen(false);
    void api.logout().finally(() => session.clear());
  };
  return (
    <div className="relative">
      <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)} aria-label={`${st.name}: lock or switch`} className="relative flex size-11 items-center justify-center rounded-full transition-transform active:scale-95">
        <Avatar name={st.name} color={st.color} size={placement === 'rail' ? 44 : 40} />
        {st.training && <span className="absolute bottom-0 right-0 size-3 rounded-full bg-[var(--ps-amber)] ring-2 ring-[var(--ps-card)]" aria-hidden />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={anchor} align={placement === 'rail' ? 'left' : 'right'} className={cn('w-64', placement === 'rail' ? 'bottom-0 left-[calc(100%+14px)] top-auto' : 'bottom-[calc(100%+14px)] top-auto')}>
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar name={st.name} color={st.color} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold">{st.name}</p>
            <p className="text-[12px] text-[var(--ps-muted)]">{ROLE_LABEL[st.role]}</p>
          </div>
        </div>
        {st.training && (
          <div className="px-2 pb-2">
            <Badge tone="warn">Training mode: sales are practice</Badge>
          </div>
        )}
        <button type="button" className={menuItem} onClick={lock}>
          <Lock size={16} /> Lock the register
        </button>
        <button
          type="button"
          className={menuItem}
          onClick={() => {
            setOpen(false);
            setPin(true);
          }}
        >
          <KeyRound size={16} /> Change my PIN
        </button>
      </Popover>
      {pin && <ChangePin onClose={() => setPin(false)} />}
    </div>
  );
}

function Rail({ page, badges, items }: { page: Page; badges: Partial<Record<Page, number>>; items: NavItem[] }): React.JSX.Element {
  const group = (g: NavItem['group'], label: string): React.JSX.Element | null => {
    const list = items.filter((it) => it.group === g);
    if (list.length === 0) return null;
    return (
      <nav className="flex flex-col items-center gap-1.5 rounded-full bg-[var(--ps-card)] p-1.5" aria-label={label}>
        {list.map((it) => (
          <RailButton key={it.page} item={it} active={it.page === page} badge={badges[it.page]} />
        ))}
      </nav>
    );
  };
  return (
    <aside className="sticky top-0 z-20 hidden h-[calc(100vh-32px)] w-[96px] shrink-0 flex-col items-center gap-5 py-7 md:flex">
      <button type="button" onClick={() => navigate('register')} className="flex flex-col items-center gap-1.5" aria-label="Register">
        <Mark size={40} />
        <span className="text-[12px] font-bold">POS</span>
      </button>
      {group('counter', 'Counter')}
      {group('office', 'Back office')}
      <span className="flex-1" />
      <div className="flex flex-col items-center gap-1.5 rounded-full bg-[var(--ps-card)] p-1.5">
        {items
          .filter((it) => it.group === 'setup')
          .map((it) => (
            <RailButton key={it.page} item={it} active={it.page === page} badge={badges[it.page]} />
          ))}
        <Me placement="rail" />
      </div>
    </aside>
  );
}

function MobileBar({ page, badges, items }: { page: Page; badges: Partial<Record<Page, number>>; items: NavItem[] }): React.JSX.Element {
  const [more, setMore] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const cart = useCart();
  const count = cart.lines.reduce((sum, l) => sum + l.qty, 0);
  const pinned = items.filter((it) => it.page === 'register' || it.page === 'orders');
  const rest = items.filter((it) => !pinned.includes(it));
  const inMore = rest.some((it) => it.page === page);
  const tab = (it: NavItem): React.JSX.Element => {
    const Icon = it.icon;
    const active = it.page === page;
    return (
      <button
        key={it.page}
        type="button"
        onClick={() => navigate(it.page)}
        aria-label={it.label}
        aria-current={active ? 'page' : undefined}
        className={cn('relative flex size-11 items-center justify-center rounded-full', active ? 'bg-[var(--ps-solid)] text-[var(--ps-on-solid)]' : 'text-[var(--ps-muted)]')}
      >
        <Icon size={19} />
        <Dot n={badges[it.page]} />
      </button>
    );
  };
  return (
    <div className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-full bg-[var(--ps-card)] px-3 py-2 shadow-[var(--ps-shadow-float)] md:hidden">
      {pinned.map(tab)}
      <button
        type="button"
        aria-label={count === 0 ? 'The sale' : count === 1 ? 'The sale: 1 item' : `The sale: ${count} items`}
        onClick={() => {
          saleSheet.request();
          if (page !== 'register') navigate('register');
        }}
        className="relative -mt-8 flex size-14 items-center justify-center rounded-full bg-[var(--ps-solid)] text-[var(--ps-on-solid)] shadow-[0_14px_30px_-12px_rgba(29,28,26,0.7)] active:scale-95"
      >
        <ShoppingBag size={22} strokeWidth={2.2} />
        <Dot n={count} />
      </button>
      <div className="relative">
        <button
          ref={anchor}
          type="button"
          aria-label="More pages"
          onClick={() => setMore((m) => !m)}
          className={cn('relative flex size-11 items-center justify-center rounded-full', inMore ? 'bg-[var(--ps-solid)] text-[var(--ps-on-solid)]' : 'text-[var(--ps-muted)]')}
        >
          <Menu size={19} />
          <Dot n={rest.reduce((sum, it) => sum + (badges[it.page] ?? 0), 0)} />
        </button>
        <Popover open={more} onClose={() => setMore(false)} keep={anchor} align="right" className="bottom-[calc(100%+14px)] top-auto w-60">
          {rest.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.page}
                type="button"
                onClick={() => {
                  setMore(false);
                  navigate(it.page);
                }}
                className={cn(menuItem, it.page === page && 'bg-[var(--ps-row)]')}
              >
                <Icon size={17} />
                <span className="flex-1">{it.label}</span>
                {(badges[it.page] ?? 0) > 0 && <span className="num flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--ps-accent-fill)] px-1.5 text-[12px] font-bold text-[var(--ps-on-accent)]">{badges[it.page]}</span>}
              </button>
            );
          })}
        </Popover>
      </div>
      <Me placement="bar" />
    </div>
  );
}

export function Frame({ page, children }: { page: Page; children: ReactNode }): React.JSX.Element {
  const badges = useBadges();
  const { settings } = useApp();
  const { session: s } = useSession();
  const perms = s?.staff.permissions ?? [];
  const items = NAV.filter((it) => visible(it, perms, settings?.kitchen_enabled === true));
  return (
    <div className="min-h-screen bg-[var(--ps-canvas)] md:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1680px] bg-[var(--ps-shell)] md:min-h-[calc(100vh-32px)] md:rounded-[36px]">
        <Rail page={page} badges={badges} items={items} />
        <main className="min-w-0 flex-1 px-4 pb-32 pt-6 md:py-8 md:pl-2 md:pr-8">{children}</main>
      </div>
      <MobileBar page={page} badges={badges} items={items} />
    </div>
  );
}

/** Pages a person may open (the router sends others to the register). */
export function canOpen(page: Page, perms: Action[], kitchen: boolean): boolean {
  const item = NAV.find((it) => it.page === page);
  return item === undefined ? true : visible(item, perms, kitchen);
}
