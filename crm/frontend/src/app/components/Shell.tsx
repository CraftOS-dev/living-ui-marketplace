/**
 * App frame in the Company OS language. On wide screens a sidebar of
 * floating blocks on the cream page: the workspace, the navigation grouped
 * by job (counts where something waits, the active page in orange with a
 * bar), and the AI agent's state. Then the page: a header (icon, title, a
 * line about the page, the page's own actions, status, search, Ask AI, undo
 * and redo) over the view, which sits in a block of its own; Home lays out
 * its own blocks. On phones a compact header and a bottom bar with the new
 * button in the middle.
 */
import { createContext, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Building2, CalendarCheck, ChartColumn, ClipboardCheck, FileUp, History, Kanban, LayoutDashboard, ListTodo, Mail, Menu as MenuIcon, MessageSquarePlus, Plus, Redo2, Search, Settings, Sparkles, Undo2, UserPlus, Users, Waypoints } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { initials } from '../lib/format.ts';
import { go, type View } from '../lib/router.ts';
import { useApp } from '../lib/store.tsx';
import { useDialogs } from './dialogs.tsx';
import { AskPanel } from './AskPanel.tsx';
import { Chip, IconBtn, Kbd, MenuList, Popover } from './ui.tsx';
import type { MenuEntry } from './ui.tsx';

export interface NavItem {
  view: View;
  label: string;
  icon: LucideIcon;
  /** The line under the page title. */
  sub: string;
}

export const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { view: 'home', label: 'Home', icon: LayoutDashboard, sub: '' },
      { view: 'today', label: 'Today', icon: CalendarCheck, sub: 'What needs doing, by when it is due' },
    ],
  },
  {
    label: 'Relationships',
    items: [
      { view: 'people', label: 'People', icon: Users, sub: 'Everyone you know, and how warm each relationship is' },
      { view: 'companies', label: 'Companies', icon: Building2, sub: 'The organizations behind your people and deals' },
      { view: 'network', label: 'Network', icon: Waypoints, sub: 'How your people, companies and deals connect' },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { view: 'deals', label: 'Deals', icon: Kanban, sub: 'Every pipeline, stage by stage' },
      { view: 'reports', label: 'Reports', icon: ChartColumn, sub: 'The numbers, with the formula behind each one' },
    ],
  },
  {
    label: 'AI agent',
    items: [
      { view: 'review', label: 'Review', icon: ClipboardCheck, sub: 'What your AI agent proposed, for you to decide' },
      { view: 'activity', label: 'Activity', icon: History, sub: "Every change with its undo, and your AI agent's runs" },
    ],
  },
  {
    label: 'Workspace',
    items: [{ view: 'setup', label: 'Setup', icon: Settings, sub: "Workspace, pipelines, fields and your AI agent's policy" }],
  },
];

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** The app's mark: two overlapping circles (two people, one connection) on an orange tile. */
export function Mark({ size = 28 }: { size?: number | undefined }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <rect width="40" height="40" fill="var(--cr-accent)" />
      <circle cx="15.5" cy="20" r="7.5" fill="var(--cr-on-accent)" />
      <circle cx="24.5" cy="20" r="7.5" fill="none" stroke="var(--cr-on-accent)" strokeWidth="2.6" />
    </svg>
  );
}

/* --------------------------------------------- the page's own header actions */

const HeaderSlot = createContext<HTMLElement | null>(null);

/** Puts a view's actions (filters, ranges, buttons) into the page header. */
export function HeaderActions({ children }: { children: ReactNode }): React.JSX.Element | null {
  const el = useContext(HeaderSlot);
  return el === null ? null : createPortal(children, el);
}

function useBadges(): Partial<Record<View, number>> {
  const { summary } = useApp();
  if (summary === null) return {};
  return {
    today: summary.tasks_overdue + summary.tasks_today,
    review: summary.proposals + summary.emails_failed,
    people: summary.keep_in_touch,
  };
}

export function useNewMenu(): MenuEntry[] {
  const d = useDialogs();
  return [
    { heading: 'Add' },
    { label: 'Person', icon: UserPlus, onClick: () => d.openNew('person'), hint: 'P' },
    { label: 'Company', icon: Building2, onClick: () => d.openNew('company') },
    { label: 'Deal', icon: Kanban, onClick: () => d.openNew('deal'), hint: 'D' },
    { heading: 'Capture' },
    { label: 'Log an interaction', icon: MessageSquarePlus, onClick: () => d.openLog(), hint: 'L' },
    { label: 'Task', icon: ListTodo, onClick: () => d.openTask(), hint: 'T' },
    { label: 'Email', icon: Mail, onClick: () => d.openEmail() },
    'divider',
    { label: 'Import from CSV', icon: FileUp, onClick: () => d.openImport() },
  ];
}

function NewButton({ wide = false }: { wide?: boolean | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const items = useNewMenu();
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="New"
        title="New"
        onClick={() => setOpen((o) => !o)}
        className={cn('flex shrink-0 items-center justify-center gap-1.5 bg-[var(--cr-accent)] text-[13px] font-semibold text-[var(--cr-on-accent)] transition-opacity hover:opacity-90', wide ? 'h-8 flex-1 px-3' : 'size-10')}
      >
        <Plus size={wide ? 15 : 18} strokeWidth={2.4} />
        {wide && 'New'}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="w-56">
        <MenuList items={items} onPicked={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function Count({ n, accent }: { n: number | undefined; accent: boolean }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return accent ? (
    <span className="num ml-auto flex h-4 min-w-4 items-center justify-center bg-[var(--cr-accent)] px-1 text-[10.5px] font-semibold leading-none text-[var(--cr-on-accent)]">{n > 99 ? '99+' : n}</span>
  ) : (
    <span className="num ml-auto text-[11.5px] text-[var(--cr-muted)]">{n > 99 ? '99+' : n}</span>
  );
}

function NavList({ view, badges, onPick }: { view: View; badges: Partial<Record<View, number>>; onPick?: (() => void) | undefined }): React.JSX.Element {
  return (
    <nav className="flex flex-col gap-4" aria-label="Main navigation">
      {NAV_GROUPS.map((g, gi) => (
        <div key={g.label ?? 'g' + gi} className="flex flex-col gap-px">
          {g.label !== null && <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--cr-muted)]">{g.label}</p>}
          {g.items.map((it) => {
            const Icon = it.icon;
            const active = it.view === view;
            return (
              <button
                key={it.view}
                type="button"
                onClick={() => {
                  go(it.view);
                  onPick?.();
                }}
                aria-current={active ? 'page' : undefined}
                className={cn('relative flex h-8 items-center gap-2.5 px-3 text-[13px] transition-colors', active ? 'font-medium text-[var(--cr-accent-text)]' : 'text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)] hover:text-[var(--cr-ink)]')}
              >
                {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 bg-[var(--cr-accent)]" />}
                <Icon size={15} aria-hidden className={active ? '' : 'text-[var(--cr-muted)]'} />
                {it.label}
                <Count n={badges[it.view]} accent={it.view === 'review'} />
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function AgentBlock(): React.JSX.Element {
  const { summary } = useApp();
  const working = summary?.agent_working ?? 0;
  const waiting = summary?.agent_waiting ?? 0;
  const proposals = summary?.proposals ?? 0;
  return (
    <div className="cr-block px-3.5 py-3">
      <p className="cr-label flex items-center gap-1.5">
        <Sparkles size={11} className="text-[var(--cr-accent-text)]" /> AI agent
      </p>
      <p className="mt-1.5 flex items-center gap-2 text-[12.5px]">
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', working > 0 ? 'cr-pulse bg-[var(--cr-accent)]' : waiting > 0 ? 'bg-[var(--cr-warn)]' : 'bg-[var(--cr-pos)]')} />
        {working > 0 ? working + ' job' + (working === 1 ? '' : 's') + ' in hand' : waiting > 0 ? waiting + ' waiting to start' : 'Ready for work'}
      </p>
      {proposals > 0 && (
        <button type="button" onClick={() => go('review')} className="mt-1 text-left text-[12px] font-medium text-[var(--cr-accent-text)] hover:underline">
          {proposals} change{proposals === 1 ? '' : 's'} to review
        </button>
      )}
    </div>
  );
}

function Sidebar({ view, badges }: { view: View; badges: Partial<Record<View, number>> }): React.JSX.Element {
  const app = useApp();
  const ws = app.settings?.workspace || 'CRM';
  return (
    <aside className="hidden h-full w-[236px] shrink-0 flex-col gap-2.5 py-2.5 pl-2.5 md:flex">
      <button type="button" onClick={() => go('home')} className="cr-block flex items-center gap-2.5 px-3.5 py-3 text-left" aria-label="CRM home">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center bg-[var(--cr-accent)] text-[11.5px] font-bold text-[var(--cr-on-accent)]">
          {initials(ws)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-4">{ws}</span>
          <span className="mt-0.5 block truncate text-[10px] font-medium uppercase tracking-wider text-[var(--cr-muted)]">CRM{app.settings?.owner_name ? ' · ' + app.settings.owner_name : ''}</span>
        </span>
      </button>
      <div className="cr-block flex min-h-0 flex-1 flex-col">
        <div className="flex p-2">
          <NewButton wide />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-1">
          <NavList view={view} badges={badges} />
        </div>
      </div>
      <AgentBlock />
    </aside>
  );
}

function MobileBar({ view, badges }: { view: View; badges: Partial<Record<View, number>> }): React.JSX.Element {
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const pinned: View[] = ['home', 'today', 'people'];
  const tab = (v: View): React.JSX.Element => {
    const it = NAV.find((x) => x.view === v) as NavItem;
    const Icon = it.icon;
    const active = it.view === view;
    const n = badges[it.view];
    return (
      <button key={it.view} type="button" onClick={() => go(it.view)} aria-label={it.label} aria-current={active ? 'page' : undefined} className={cn('relative flex size-10 items-center justify-center', active ? 'text-[var(--cr-accent-text)]' : 'text-[var(--cr-muted)]')}>
        {active && <span aria-hidden className="absolute inset-x-2 top-0 h-0.5 bg-[var(--cr-accent)]" />}
        <Icon size={19} />
        {n !== undefined && n > 0 && <span className="num absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center bg-[var(--cr-ink)] px-1 text-[10px] font-semibold text-[var(--cr-card)]">{n > 99 ? '99+' : n}</span>}
      </button>
    );
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-[var(--cr-line)] bg-[var(--cr-card)] px-2 md:hidden">
      {tab('home')}
      {tab('today')}
      <NewButton />
      {tab('people')}
      <button ref={ref} type="button" aria-label="More" onClick={() => setMore((m) => !m)} className={cn('relative flex size-10 items-center justify-center', !pinned.includes(view) ? 'text-[var(--cr-accent-text)]' : 'text-[var(--cr-muted)]')}>
        <MenuIcon size={19} />
        {(badges.review ?? 0) > 0 && <span className="num absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center bg-[var(--cr-accent)] px-1 text-[10px] font-semibold text-[var(--cr-on-accent)]">{badges.review}</span>}
      </button>
      <Popover open={more} onClose={() => setMore(false)} anchor={ref} align="right" className="w-52">
        <MenuList items={NAV.filter((it) => !pinned.includes(it.view)).map((it) => ({ label: it.label + (badges[it.view] ? ' (' + badges[it.view] + ')' : ''), icon: it.icon, onClick: () => go(it.view), checked: it.view === view }))} onPicked={() => setMore(false)} />
      </Popover>
    </div>
  );
}

function StatusChips(): React.JSX.Element | null {
  const { summary } = useApp();
  if (summary === null) return null;
  const chips: ReactNode[] = [];
  if (summary.emails_failed > 0)
    chips.push(
      <button key="ef" type="button" onClick={() => go('review', { tab: 'emails' })}>
        <Chip tone="neg">{summary.emails_failed} email{summary.emails_failed === 1 ? '' : 's'} not sent</Chip>
      </button>,
    );
  if (summary.tasks_overdue > 0)
    chips.push(
      <button key="od" type="button" onClick={() => go('today')}>
        <Chip tone="warn">{summary.tasks_overdue} overdue</Chip>
      </button>,
    );
  if (chips.length === 0) return null;
  return <div className="hidden min-w-0 items-center gap-1.5 2xl:flex">{chips}</div>;
}

function today(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function Header({ view, onPalette, setSlot }: { view: View; onPalette: () => void; setSlot: (el: HTMLElement | null) => void }): React.JSX.Element {
  const app = useApp();
  const [ask, setAsk] = useState(false);
  const askRef = useRef<HTMLButtonElement | null>(null);
  const it = NAV.find((x) => x.view === view) as NavItem;
  const Icon = it.icon;
  const title = view === 'home' ? app.settings?.workspace || 'Home' : it.label;
  const sub = view === 'home' ? today() : it.sub;
  const undo = (): void => {
    api
      .undo()
      .then((r) => toast.success('Undone: ' + r.entry.summary))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const redo = (): void => {
    api
      .redo()
      .then((r) => toast.success('Redone: ' + r.entry.summary))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 px-1 pb-3 pt-1 md:px-2 md:pt-2">
      <span className="md:hidden">
        <Mark size={26} />
      </span>
      <div className="min-w-[150px] flex-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon size={20} aria-hidden className="hidden shrink-0 text-[var(--cr-muted)] md:block" />
          <h1 className="truncate text-[20px] font-semibold leading-7 tracking-tight">{title}</h1>
        </div>
        {sub !== '' && <p className="mt-0.5 hidden truncate text-[13px] text-[var(--cr-muted)] sm:block">{sub}</p>}
      </div>
      <div ref={setSlot} className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden max-md:order-last max-md:w-full" />
      <StatusChips />
      <button type="button" onClick={onPalette} className="cr-block hidden h-8 items-center gap-2 px-2.5 text-[12.5px] text-[var(--cr-muted)] transition-colors hover:text-[var(--cr-ink)] sm:inline-flex" aria-label="Search and commands">
        <Search size={13} /> Search
        <Kbd>Ctrl K</Kbd>
      </button>
      <IconBtn icon={Search} label="Search" className="sm:hidden" onClick={onPalette} />
      <button ref={askRef} type="button" onClick={() => setAsk((a) => !a)} aria-expanded={ask} className={cn('inline-flex h-8 items-center gap-1.5 border px-2.5 text-[12.5px] font-semibold transition-colors', ask ? 'border-[var(--cr-accent)] bg-[var(--cr-accent)] text-[var(--cr-on-accent)]' : 'border-[var(--cr-line)] bg-[var(--cr-card)] text-[var(--cr-accent-text)] hover:border-[var(--cr-accent)]')}>
        <Sparkles size={13} strokeWidth={2.2} /> <span className="hidden sm:inline">Ask AI</span>
      </button>
      <Popover open={ask} onClose={() => setAsk(false)} anchor={askRef} align="right" className="w-[min(94vw,420px)] p-0">
        <AskPanel onClose={() => setAsk(false)} />
      </Popover>
      <div className="cr-block hidden h-8 items-center px-0.5 sm:flex">
        <IconBtn icon={Undo2} label="Undo (Ctrl+Z)" onClick={undo} />
        <IconBtn icon={Redo2} label="Redo (Ctrl+Y)" onClick={redo} />
      </div>
    </header>
  );
}

export function Frame({ view, onPalette, plain = false, children }: { view: View; onPalette: () => void; plain?: boolean | undefined; children: ReactNode }): React.JSX.Element {
  const badges = useBadges();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlot.Provider value={slot}>
      <div className="flex h-dvh min-h-0 overflow-hidden bg-[var(--cr-page)] text-[var(--cr-ink)]">
        <Sidebar view={view} badges={badges} />
        <div className="flex min-w-0 flex-1 flex-col px-2 pb-16 pt-1.5 md:px-2.5 md:pb-2.5 md:pt-2.5">
          <Header view={view} onPalette={onPalette} setSlot={setSlot} />
          <main className={cn('relative min-h-0 flex-1 overflow-hidden', !plain && 'cr-block')}>{children}</main>
        </div>
        <MobileBar view={view} badges={badges} />
      </div>
    </HeaderSlot.Provider>
  );
}
