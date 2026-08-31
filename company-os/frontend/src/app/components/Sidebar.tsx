/**
 * Navigation, grouped by job (Overview / Work / Company) the way Linear and
 * Stripe group by user jobs. Static order, items appear only when their
 * module is active. Active item: accent text + left accent bar, no pill.
 * Desktop: fixed rail. Mobile: top bar + slide-over drawer.
 */
import { useState } from 'react';
import {
  BookOpen,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  Compass,
  FolderArchive,
  FolderKanban,
  Home,
  Megaphone,
  Menu,
  NotebookPen,
  Settings,
  Target,
  Users,
  Wrench,
} from 'lucide-react';
import { Button, Drawer, cn, useAuth } from '../../kit/index.ts';
import type { ModuleKey, Page, Stage, Vocab } from '../lib/types.ts';
import { STAGE_LABELS } from '../lib/types.ts';
import { initialsOf } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: typeof Home;
  module?: ModuleKey | undefined;
  ownerOnly?: boolean | undefined;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

function navGroups(vocab: Vocab): NavGroup[] {
  return [
    {
      label: null,
      items: [
        { page: 'home', label: 'Home', icon: Home },
        { page: 'journey', label: 'Journey', icon: Compass },
      ],
    },
    {
      label: 'Work',
      items: [
        { page: 'customers', label: vocab.customer_many, icon: Users, module: 'customers' },
        { page: 'kanban', label: 'Kanban', icon: FolderKanban, module: 'kanban' },
        { page: 'money', label: 'Money', icon: CircleDollarSign, module: 'money', ownerOnly: true },
        { page: 'goals', label: 'Goals', icon: Target, module: 'goals' },
        { page: 'meetings', label: 'Meetings', icon: CalendarCheck, module: 'meetings' },
        { page: 'marketing', label: 'Marketing', icon: Megaphone, module: 'marketing' },
      ],
    },
    {
      label: 'Company',
      items: [
        { page: 'team', label: 'Team', icon: Building2, module: 'team' },
        { page: 'processes', label: 'Processes', icon: Wrench, module: 'processes' },
        { page: 'notes', label: 'Notes', icon: NotebookPen },
        { page: 'files', label: 'Files', icon: FolderArchive },
        { page: 'profile', label: 'Profile', icon: BookOpen },
        { page: 'settings', label: 'Settings', icon: Settings, ownerOnly: true },
      ],
    },
  ];
}

export interface SidebarProps {
  page: Page;
  onNavigate: (page: Page) => void;
  activeKeys: ReadonlySet<ModuleKey>;
  /** Owner or admin: unlocks admin-only pages (Money, Settings). */
  isAdmin: boolean;
  companyName: string;
  stage: Stage;
  vocab: Vocab;
}

function NavList({
  groups,
  page,
  onNavigate,
}: {
  groups: NavGroup[];
  page: Page;
  onNavigate: (page: Page) => void;
}): React.JSX.Element {
  return (
    <nav className="flex flex-col gap-4" aria-label="Main navigation">
      {groups.map((group, gi) => (
        <div key={group.label ?? `g${gi}`} className="flex flex-col gap-px">
          {group.label !== null && (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--lui-muted)]/80">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = page === item.page;
            return (
              <button
                key={item.page}
                type="button"
                onClick={() => onNavigate(item.page)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-8 items-center gap-2.5 px-3 text-[13px] transition-colors',
                  active
                    ? 'font-medium text-[var(--lui-accent)]'
                    : 'text-[var(--lui-text)]/80 hover:bg-[var(--lui-border)]/30 hover:text-[var(--lui-text)]',
                )}
              >
                {active && (
                  <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 bg-[var(--lui-accent)]" />
                )}
                <Icon size={15} aria-hidden className={active ? '' : 'text-[var(--lui-muted)]'} />
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({
  page,
  onNavigate,
  activeKeys,
  isAdmin,
  companyName,
  stage,
  vocab,
}: SidebarProps): React.JSX.Element {
  const { logout, email } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = navGroups(vocab)
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        if (item.ownerOnly === true && !isAdmin) return false;
        if (item.module !== undefined && !activeKeys.has(item.module)) {
          // Owners/admins can always reach Team (it hosts access management).
          if (item.page === 'team' && isAdmin) return true;
          return false;
        }
        return true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  const brandInner = (
    <>
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center bg-[var(--lui-accent)] text-[11px] font-bold text-white"
      >
        {initialsOf(companyName)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-4">{companyName}</p>
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">
          {STAGE_LABELS[stage]} stage
        </p>
      </div>
    </>
  );

  const footerInner = (
    <>
      <p className="truncate text-[11px] text-[var(--lui-muted)]">{email ?? ''}</p>
      <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={logout}>
        Sign out
      </Button>
    </>
  );

  // Every floating block shares this look: a sharp-cornered surface card that
  // sits on the page background, detached from the viewport edges by the
  // aside's padding (the Command Center rail pattern).
  const block = 'border border-[var(--lui-border)] bg-[var(--lui-surface)]';

  return (
    <>
      {/* Desktop rail — floating, detached blocks (Command Center style) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-2.5 p-2.5 md:flex">
        <div className={cn('flex items-center gap-2.5 px-4 py-3.5', block)}>{brandInner}</div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-1.5 py-3', block)}>
          <NavList groups={groups} page={page} onNavigate={onNavigate} />
        </div>
        <div className={cn('px-4 py-3', block)}>{footerInner}</div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-[var(--lui-border)] bg-[var(--lui-surface)] px-3 py-2 md:hidden">
        <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu size={18} />
        </Button>
        <p className="truncate text-sm font-semibold">{companyName}</p>
        <span className="w-9" aria-hidden />
      </div>
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} side="left" title={companyName}>
        <div className="flex h-full flex-col">
          <NavList
            groups={groups}
            page={page}
            onNavigate={(p) => {
              setMobileOpen(false);
              onNavigate(p);
            }}
          />
          <div className="mt-auto border-t border-[var(--lui-border)] px-4 py-3">{footerInner}</div>
        </div>
      </Drawer>
    </>
  );
}
