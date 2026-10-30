/**
 * App frame: a full-height app. On wide screens a slim icon rail on the left
 * (labels appear on hover, counts sit on the icons that have something
 * waiting), a title bar with the view's name, status chips, search, Ask AI,
 * undo and redo, then the view edge to edge. On phones a bottom bar with the
 * new button in the middle.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, CalendarCheck, ChartColumn, ClipboardCheck, FileUp, History, Kanban, LayoutDashboard, ListTodo, Mail, Menu as MenuIcon, MessageSquarePlus, Plus, Redo2, Search, Settings, Sparkles, Undo2, UserPlus, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { go, type View } from '../lib/router.ts';
import { useApp } from '../lib/store.tsx';
import { useDialogs } from './dialogs.tsx';
import { AskPanel } from './AskPanel.tsx';
import { Chip, IconBtn, Kbd, MenuList, Popover } from './ui.tsx';
import type { MenuEntry } from './ui.tsx';

interface NavItem {
  view: View;
  label: string;
  icon: LucideIcon;
}

const MAIN: NavItem[] = [
  { view: 'home', label: 'Home', icon: LayoutDashboard },
  { view: 'today', label: 'Today', icon: CalendarCheck },
  { view: 'people', label: 'People', icon: Users },
  { view: 'companies', label: 'Companies', icon: Building2 },
  { view: 'deals', label: 'Deals', icon: Kanban },
  { view: 'review', label: 'Review', icon: ClipboardCheck },
  { view: 'reports', label: 'Reports', icon: ChartColumn },
];
const FOOT: NavItem[] = [
  { view: 'activity', label: 'Activity', icon: History },
  { view: 'setup', label: 'Setup', icon: Settings },
];

export const VIEW_TITLE: Record<View, string> = {
  home: 'Home',
  today: 'Today',
  people: 'People',
  companies: 'Companies',
  deals: 'Deals',
  review: 'Review',
  reports: 'Reports',
  activity: 'Activity',
  setup: 'Setup',
};

/** The app's mark: two overlapping circles (two people, one connection) on an ink tile. */
export function Mark({ size = 28 }: { size?: number | undefined }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <rect width="40" height="40" rx="9" fill="var(--cr-ink)" />
      <circle cx="15.5" cy="20" r="7.5" fill="var(--cr-accent)" />
      <circle cx="24.5" cy="20" r="7.5" fill="none" stroke="var(--cr-card)" strokeWidth="2.6" />
    </svg>
  );
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

function Count({ n, tone = 'accent' }: { n: number | undefined; tone?: 'accent' | 'ink' | undefined }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return (
    <span className={cn('num absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10.5px] font-bold leading-none ring-2 ring-[var(--cr-card)]', tone === 'accent' ? 'bg-[var(--cr-accent)] text-[var(--cr-on-accent)]' : 'bg-[var(--cr-ink)] text-[var(--cr-card)]')}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function RailButton({ item, active, badge }: { item: NavItem; active: boolean; badge: number | undefined }): React.JSX.Element {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => go(item.view)}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn('group relative flex size-9 shrink-0 items-center justify-center rounded-[6px] transition-colors', active ? 'bg-[var(--cr-row-hover)] text-[var(--cr-ink)]' : 'text-[var(--cr-muted)] hover:bg-[var(--cr-row)] hover:text-[var(--cr-ink)]')}
    >
      {active && <span aria-hidden className="absolute -left-2 bottom-2 top-2 w-0.5 rounded-r bg-[var(--cr-accent)]" />}
      <Icon size={18} strokeWidth={active ? 2.2 : 1.9} />
      <Count n={badge} tone={item.view === 'review' ? 'accent' : 'ink'} />
      <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-[6px] bg-[var(--cr-tooltip)] px-2 py-1 text-[12px] font-semibold text-[var(--cr-on-tooltip)] opacity-0 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] transition-opacity group-hover:opacity-100">
        {item.label}
      </span>
    </button>
  );
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

function NewButton({ className, size = 36 }: { className?: string | undefined; size?: number | undefined }): React.JSX.Element {
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
        style={{ width: size, height: size }}
        className={cn('flex shrink-0 items-center justify-center rounded-[6px] bg-[var(--cr-accent)] text-[var(--cr-on-accent)] transition-opacity hover:opacity-90', className)}
      >
        <Plus size={18} strokeWidth={2.4} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} className="w-56">
        <MenuList items={items} onPicked={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function Rail({ view, badges }: { view: View; badges: Partial<Record<View, number>> }): React.JSX.Element {
  return (
    <aside className="z-30 hidden h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--cr-line)] bg-[var(--cr-card)] py-2 md:flex">
      <button type="button" onClick={() => go('home')} className="mb-1 flex size-9 items-center justify-center" aria-label="CRM home">
        <Mark size={28} />
      </button>
      <NewButton />
      <nav className="flex flex-col items-center gap-1 border-t border-[var(--cr-hair)] pt-1" aria-label="CRM">
        {MAIN.map((it) => (
          <RailButton key={it.view} item={it} active={it.view === view} badge={badges[it.view]} />
        ))}
      </nav>
      <span className="flex-1" />
      <nav className="flex flex-col items-center gap-1" aria-label="Setup">
        {FOOT.map((it) => (
          <RailButton key={it.view} item={it} active={it.view === view} badge={badges[it.view]} />
        ))}
      </nav>
    </aside>
  );
}

function MobileBar({ view, badges }: { view: View; badges: Partial<Record<View, number>> }): React.JSX.Element {
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const pinned: View[] = ['home', 'today', 'people'];
  const all = [...MAIN, ...FOOT];
  const tab = (v: View): React.JSX.Element => {
    const it = all.find((x) => x.view === v) as NavItem;
    const Icon = it.icon;
    const active = it.view === view;
    return (
      <button key={it.view} type="button" onClick={() => go(it.view)} aria-label={it.label} aria-current={active ? 'page' : undefined} className={cn('relative flex size-10 items-center justify-center rounded-[6px]', active ? 'bg-[var(--cr-row-hover)] text-[var(--cr-ink)]' : 'text-[var(--cr-muted)]')}>
        <Icon size={19} />
        <Count n={badges[it.view]} tone={it.view === 'review' ? 'accent' : 'ink'} />
      </button>
    );
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-[var(--cr-line)] bg-[var(--cr-card)] px-2 md:hidden">
      {tab('home')}
      {tab('today')}
      <NewButton size={40} />
      {tab('people')}
      <button ref={ref} type="button" aria-label="More" onClick={() => setMore((m) => !m)} className={cn('relative flex size-10 items-center justify-center rounded-[6px]', !pinned.includes(view) ? 'bg-[var(--cr-row-hover)] text-[var(--cr-ink)]' : 'text-[var(--cr-muted)]')}>
        <MenuIcon size={19} />
        <Count n={badges.review} />
      </button>
      <Popover open={more} onClose={() => setMore(false)} anchor={ref} align="right" className="w-52">
        <MenuList items={all.filter((it) => !pinned.includes(it.view)).map((it) => ({ label: it.label + (badges[it.view] ? ' (' + badges[it.view] + ')' : ''), icon: it.icon, onClick: () => go(it.view), checked: it.view === view }))} onPicked={() => setMore(false)} />
      </Popover>
    </div>
  );
}

function StatusChips(): React.JSX.Element | null {
  const { summary } = useApp();
  if (summary === null) return null;
  const chips: ReactNode[] = [];
  if (summary.agent_working + summary.agent_waiting > 0)
    chips.push(
      <Chip key="ai" tone="accent" title="Work your AI agent has in hand: research, meeting reviews, questions">
        <Sparkles size={10} className={summary.agent_working > 0 ? 'cr-pulse' : ''} /> AI {summary.agent_working > 0 ? 'working' : 'queued'} · {summary.agent_working + summary.agent_waiting}
      </Chip>,
    );
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
  return <div className="hidden min-w-0 items-center gap-1.5 overflow-hidden lg:flex">{chips}</div>;
}

function TitleBar({ view, title, onPalette }: { view: View; title?: ReactNode | undefined; onPalette: () => void }): React.JSX.Element {
  const app = useApp();
  const [ask, setAsk] = useState(false);
  const askRef = useRef<HTMLButtonElement | null>(null);
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
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--cr-line)] bg-[var(--cr-card)] px-3">
      <span className="md:hidden">
        <Mark size={24} />
      </span>
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="truncate text-[14px] font-bold">{title ?? VIEW_TITLE[view]}</h1>
        {app.settings !== null && app.settings.workspace !== '' && <span className="hidden truncate text-[12px] text-[var(--cr-muted)] sm:inline">{app.settings.workspace}</span>}
      </div>
      <span className="flex-1" />
      <StatusChips />
      <button type="button" onClick={onPalette} className="hidden h-7 items-center gap-2 rounded-[5px] border border-[var(--cr-line)] px-2 text-[12px] text-[var(--cr-muted)] transition-colors hover:bg-[var(--cr-row)] sm:inline-flex" aria-label="Search and commands">
        <Search size={13} /> Search
        <Kbd>Ctrl K</Kbd>
      </button>
      <IconBtn icon={Search} label="Search" className="sm:hidden" onClick={onPalette} />
      <button ref={askRef} type="button" onClick={() => setAsk((a) => !a)} aria-expanded={ask} className={cn('inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[12.5px] font-semibold transition-colors', ask ? 'bg-[var(--cr-accent)] text-[var(--cr-on-accent)]' : 'bg-[var(--cr-accent-soft)] text-[var(--cr-accent-text)] hover:opacity-90')}>
        <Sparkles size={13} strokeWidth={2.2} /> <span className="hidden sm:inline">Ask AI</span>
      </button>
      <Popover open={ask} onClose={() => setAsk(false)} anchor={askRef} align="right" className="w-[min(94vw,420px)] p-0">
        <AskPanel onClose={() => setAsk(false)} />
      </Popover>
      <span className="mx-0.5 hidden h-5 w-px bg-[var(--cr-hair)] sm:block" />
      <IconBtn icon={Undo2} label="Undo (Ctrl+Z)" onClick={undo} className="hidden sm:inline-flex" />
      <IconBtn icon={Redo2} label="Redo (Ctrl+Y)" onClick={redo} className="hidden sm:inline-flex" />
    </header>
  );
}

export function Frame({ view, title, onPalette, children }: { view: View; title?: ReactNode | undefined; onPalette: () => void; children: ReactNode }): React.JSX.Element {
  const badges = useBadges();
  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-[var(--cr-card)] text-[var(--cr-ink)]">
      <Rail view={view} badges={badges} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar view={view} title={title} onPalette={onPalette} />
        <main className="relative min-h-0 flex-1 overflow-hidden pb-14 md:pb-0">{children}</main>
      </div>
      <MobileBar view={view} badges={badges} />
    </div>
  );
}
