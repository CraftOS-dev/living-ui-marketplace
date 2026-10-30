/**
 * The frame every page shares: a grey canvas holding one rounded frame; the
 * sidebar (main menu with live counts, then your shops as a tree with an
 * inline "+", then Settings); a top bar with search, today's date, the bell
 * (what needs you), "Ask your AI agent" and the business avatar.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, ListChecks, Menu as MenuIcon, MessageSquare, Package, Plus, Search, Settings as SettingsIcon, Sparkles, Store, Tag, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useStore } from '../lib/store.tsx';
import { go, href, type Page, type Route } from '../lib/router.ts';
import type { Shop } from '../lib/types.ts';
import { PlatformMark } from './PlatformMark.tsx';
import { Avatar, Button, IconButton, Menu, Tip } from './ui.tsx';

/* ------------------------------------------------- app-wide open signals */

type Listener = () => void;
const listeners: Record<string, Set<Listener>> = { addShop: new Set(), agent: new Set(), search: new Set() };
let agentTab: 'chat' | 'tasks' | 'activity' = 'chat';

/** Open the add-shop dialog from anywhere. */
export function openAddShop(): void {
  for (const fn of listeners.addShop ?? []) fn();
}

/** Open the panel where you talk to your AI agent. */
export function openAgent(tab: 'chat' | 'tasks' | 'activity' = 'chat'): void {
  agentTab = tab;
  for (const fn of listeners.agent ?? []) fn();
}

export function openSearch(): void {
  for (const fn of listeners.search ?? []) fn();
}

export function useOpenSignal(name: 'addShop' | 'agent' | 'search', fn: Listener): void {
  useEffect(() => {
    listeners[name]?.add(fn);
    return () => {
      listeners[name]?.delete(fn);
    };
  }, [name, fn]);
}

export function currentAgentTab(): 'chat' | 'tasks' | 'activity' {
  return agentTab;
}

/* ---------------------------------------------------------------- sidebar */

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
  count?: number;
  alert?: boolean;
  also?: Page[];
}

function NavLink({ item, active, collapsed, onNavigate }: { item: NavItem; active: boolean; collapsed: boolean; onNavigate: () => void }): React.JSX.Element {
  const Icon = item.icon;
  const link = (
    <a
      href={href(item.page)}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'so-press relative flex h-10 items-center gap-3 rounded-full text-[14px] font-medium',
        collapsed ? 'w-10 justify-center' : 'px-3',
        active ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]',
      )}
    >
      <Icon size={18} strokeWidth={2} aria-hidden className="shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {item.count !== undefined && item.count > 0 && (
        <span
          className={cn(
            'num flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
            collapsed && 'absolute -right-1 -top-1 ring-2 ring-[var(--so-frame)]',
            item.alert ? 'bg-[var(--so-red)] text-white' : active ? 'bg-white/20 text-[var(--so-on-primary)]' : 'bg-[var(--so-card)] text-[var(--so-ink-2)]',
          )}
        >
          {item.count > 99 ? '99+' : item.count}
        </span>
      )}
    </a>
  );
  return collapsed ? <Tip text={item.label}>{link}</Tip> : link;
}

function shopDot(s: Shop): { cls: string; tip: string } {
  if (s.task && (s.task.state === 'working' || s.task.state === 'asked' || s.task.state === 'queued')) return { cls: 'bg-[var(--so-accent)] so-breathe', tip: 'Your AI agent is working on it' };
  if (s.late > 0) return { cls: 'bg-[var(--so-red)]', tip: s.late + ' late to ship' };
  if (s.status === 'setting_up') return { cls: 'bg-[var(--so-amber)]', tip: 'Setting up: ' + s.setup.done + ' of ' + s.setup.total + ' done' };
  if (s.status === 'paused') return { cls: 'bg-[var(--so-faint)]', tip: 'Paused' };
  return { cls: 'bg-[var(--so-green)]', tip: 'Active' };
}

function ShopTree({ route, collapsed, onNavigate }: { route: Route; collapsed: boolean; onNavigate: () => void }): React.JSX.Element {
  const { shops } = useStore();
  const [open, setOpen] = useState(true);
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        {shops.map((s) => {
          const dot = shopDot(s);
          return (
            <Tip key={s.id} text={s.name + ': ' + dot.tip}>
              <a href={href('shop', s.id)} onClick={onNavigate} className={cn('relative flex size-10 items-center justify-center rounded-full hover:bg-[var(--so-tile-hover)]', route.page === 'shop' && route.sub === s.id && 'bg-[var(--so-card)]')}>
                <PlatformMark platform={s.platform} size={28} onCard={false} />
                <span className={cn('absolute bottom-1.5 right-1.5 size-2 rounded-full ring-2 ring-[var(--so-frame)]', dot.cls)} />
              </a>
            </Tip>
          );
        })}
        <Tip text="Add a shop">
          <button type="button" aria-label="Add a shop" onClick={openAddShop} className="flex size-10 items-center justify-center rounded-full text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]">
            <Plus size={18} />
          </button>
        </Tip>
      </div>
    );
  }
  return (
    <div>
      <div className="flex h-8 items-center gap-1 pl-3 pr-1">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 rounded-full text-[12px] font-medium text-[var(--so-muted)] hover:text-[var(--so-ink)]">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Shops</span>
        </button>
        <a href={href('shops')} onClick={onNavigate} className="rounded-full px-2 py-1 text-[12px] font-medium text-[var(--so-muted)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]">
          All
        </a>
        <Tip text="Add a shop">
          <button type="button" aria-label="Add a shop" onClick={openAddShop} className="hit flex size-7 items-center justify-center rounded-full text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]">
            <Plus size={16} />
          </button>
        </Tip>
      </div>
      {open && (
        <div className="mt-1 space-y-0.5">
          {shops.map((s) => {
            const active = route.page === 'shop' && route.sub === s.id;
            const dot = shopDot(s);
            return (
              <a
                key={s.id}
                href={href('shop', s.id)}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn('flex h-10 items-center gap-2.5 rounded-full pl-1.5 pr-3 text-[14px] font-medium', active ? 'bg-[var(--so-card)] text-[var(--so-ink)] shadow-[inset_0_0_0_1px_var(--so-border)]' : 'text-[var(--so-ink-2)] hover:bg-[var(--so-tile-hover)] hover:text-[var(--so-ink)]')}
              >
                <PlatformMark platform={s.platform} size={28} onCard={false} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {s.to_ship > 0 && <span className="num text-[12px] font-semibold text-[var(--so-muted)]">{s.to_ship}</span>}
                <Tip text={dot.tip}>
                  <span aria-label={dot.tip} className={cn('size-2 rounded-full', dot.cls)} />
                </Tip>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Sidebar({ route, collapsed, onCollapse, onNavigate, phone }: { route: Route; collapsed: boolean; onCollapse: () => void; onNavigate: () => void; phone: boolean }): React.JSX.Element {
  const { settings, attention } = useStore();
  const a = attention;
  const items: NavItem[] = [
    { page: 'overview', label: 'Overview', icon: LayoutGrid },
    { page: 'orders', label: 'Orders', icon: Package, count: a?.to_ship ?? 0, alert: (a?.late ?? 0) > 0 },
    { page: 'products', label: 'Products', icon: Tag, also: ['product'] },
    { page: 'inbox', label: 'Inbox', icon: MessageSquare, count: a?.messages_open ?? 0, alert: (a?.messages_overdue ?? 0) > 0 },
    { page: 'customers', label: 'Customers', icon: Users },
    { page: 'approvals', label: 'Approvals', icon: ListChecks, count: a?.approvals ?? 0, alert: (a?.approvals ?? 0) > 0 },
  ];
  return (
    <nav aria-label="Main" className={cn('flex h-full flex-col gap-5 py-5', collapsed ? 'w-[76px] items-center px-2' : 'w-[248px] px-4')}>
      <div className={cn('flex items-center gap-2.5', collapsed ? 'flex-col' : 'pl-1')}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--so-primary)] text-[var(--so-on-primary)]">
          <Store size={18} strokeWidth={2} aria-hidden />
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold leading-5">Store OS</span>
            <span className="block truncate text-[12px] leading-4 text-[var(--so-muted)]">{settings?.business_name || 'Your store'}</span>
          </span>
        )}
        {!phone && <IconButton icon={collapsed ? ChevronRight : ChevronLeft} label={collapsed ? 'Expand menu' : 'Collapse menu'} variant="card" size={28} onClick={onCollapse} />}
      </div>
      <div className={cn('flex flex-col gap-1', collapsed && 'items-center')}>
        {!collapsed && <p className="mb-1 pl-3 text-[12px] font-medium text-[var(--so-muted)]">Main menu</p>}
        {items.map((it) => (
          <NavLink key={it.page} item={it} active={route.page === it.page || (it.also ?? []).includes(route.page)} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <ShopTree route={route} collapsed={collapsed} onNavigate={onNavigate} />
      </div>
      <div className={cn('flex flex-col gap-1', collapsed && 'items-center')}>
        <NavLink item={{ page: 'settings', label: 'Settings', icon: SettingsIcon }} active={route.page === 'settings'} collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------------- top bar */

function TopBar({ onMenu }: { onMenu: () => void }): React.JSX.Element {
  const { settings, attention } = useStore();
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const bell = (attention?.approvals ?? 0) + (attention?.messages_overdue ?? 0) + (attention?.late ?? 0);
  const working = attention?.tasks_open ?? 0;
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-4 lg:px-6">
      <IconButton icon={MenuIcon} label="Menu" variant="card" className="lg:hidden" onClick={onMenu} />
      <button type="button" onClick={openSearch} className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-[var(--so-card)] px-3.5 text-left text-[14px] text-[var(--so-faint)] shadow-[inset_0_0_0_1px_var(--so-border)] hover:bg-[var(--so-row-hover)] sm:max-w-[360px]">
        <Search size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
        <span className="min-w-0 flex-1 truncate sm:hidden">Search</span>
        <span className="hidden min-w-0 flex-1 truncate sm:inline">Search orders, products, buyers</span>
        <kbd className="hidden rounded-[6px] bg-[var(--so-tile)] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-[var(--so-muted)] sm:inline">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden h-10 items-center gap-2 rounded-full bg-[var(--so-card)] px-3.5 text-[13px] font-semibold shadow-[inset_0_0_0_1px_var(--so-border)] md:inline-flex">
          <CalendarDays size={16} className="text-[var(--so-muted)]" aria-hidden />
          {today}
        </span>
        <IconButton icon={Bell} label="What needs you" variant="card" size={40} badge={bell} onClick={() => go('approvals', 'pending')} />
        <Button icon={Sparkles} onClick={() => openAgent('chat')} aria-label="Ask your AI agent" className="relative">
          <span className="hidden sm:inline">Ask your AI agent</span>
          {working > 0 && <span aria-label={working + ' tasks in progress'} className="so-breathe absolute right-1 top-1 size-2 rounded-full bg-[var(--so-accent)]" />}
        </Button>
        <Menu
          label="Store menu"
          variant="card"
          size={40}
          trigger={
            <>
              <Avatar name={settings?.business_name || settings?.owner_name || 'Store'} size={32} />
              <ChevronDown size={16} aria-hidden />
            </>
          }
          items={[
            { label: 'Settings', icon: SettingsIcon, onSelect: () => go('settings') },
            { label: 'All shops', icon: Store, onSelect: () => go('shops') },
            { label: 'Your AI agent’s tasks', icon: Sparkles, onSelect: () => openAgent('tasks') },
          ]}
        />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ frame */

export function Frame({ route, children }: { route: Route; children: ReactNode }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('so-nav-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [phoneOpen, setPhoneOpen] = useState(false);
  const collapse = (): void => {
    const v = !collapsed;
    setCollapsed(v);
    try {
      window.localStorage.setItem('so-nav-collapsed', v ? '1' : '0');
    } catch {
      /* the menu still works */
    }
  };
  useEffect(() => {
    setPhoneOpen(false);
  }, [route.page, route.sub, route.id]);
  return (
    <div className="so-app min-h-screen bg-[var(--so-canvas)] lg:p-3">
      <div className="flex min-h-screen bg-[var(--so-frame)] lg:min-h-[calc(100vh-24px)] lg:rounded-[28px]">
        <aside className="sticky top-3 hidden h-[calc(100vh-24px)] shrink-0 lg:block">
          <Sidebar route={route} collapsed={collapsed} onCollapse={collapse} onNavigate={() => undefined} phone={false} />
        </aside>
        {phoneOpen && (
          <div className="so-portal fixed inset-0 z-50 flex bg-[var(--so-overlay)] lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setPhoneOpen(false)}>
            <div className="so-drawer relative h-full bg-[var(--so-frame)] shadow-2xl">
              <div className="absolute right-3 top-5">
                <IconButton icon={X} label="Close menu" variant="card" size={32} onClick={() => setPhoneOpen(false)} />
              </div>
              <Sidebar route={route} collapsed={false} onCollapse={() => undefined} onNavigate={() => setPhoneOpen(false)} phone />
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setPhoneOpen(true)} />
          <main className="mx-auto w-full min-w-0 max-w-[1480px] flex-1 px-4 pb-10 pt-2 lg:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
