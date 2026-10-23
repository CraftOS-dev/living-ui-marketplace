/**
 * App frame: a full-height app. On wide screens a slim icon rail on the left
 * (labels appear on hover, counts sit on the icons that have something
 * waiting) beside the page; on phones a bottom bar with the new-part button
 * in the middle. The part workspace fills the whole page area.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Boxes, FileDown, History, House, Inbox, Menu, Plus, Settings } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { SECTION, navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { useNewPart } from './NewPart.tsx';
import { Popover, menuItem } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

const GROUPS: NavItem[][] = [
  [
    { page: 'home', label: 'Home', icon: House },
    { page: 'parts', label: 'Parts', icon: Boxes },
    { page: 'requests', label: 'Requests to your AI agent', icon: Inbox },
  ],
  [
    { page: 'activity', label: 'Activity', icon: History },
    { page: 'exports', label: 'Exports', icon: FileDown },
  ],
  [{ page: 'settings', label: 'Settings', icon: Settings }],
];

/** The app's mark: an isometric block with its top face in the accent, on an ink tile. */
export function Mark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="cw-on-ink shrink-0">
      <rect width="40" height="40" rx="9" fill="var(--cw-ink)" />
      <path d="M20 9.5 L30 15 L20 20.5 L10 15 Z" fill="var(--cw-accent)" />
      <path d="M10 15 L20 20.5 L20 31 L10 25.5 Z" fill="var(--cw-shell)" />
      <path d="M30 15 L20 20.5 L20 31 L30 25.5 Z" fill="var(--cw-track)" />
    </svg>
  );
}

function useBadges(): Partial<Record<Page, number>> {
  const { status } = useApp();
  if (status === null) return {};
  return {
    requests: status.open_requests,
    parts: status.parts_by_status.failed ?? 0,
  };
}

function Count({ n }: { n: number | undefined }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return (
    <span className="num absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--cw-accent)] px-1 text-[12px] font-bold leading-none text-[var(--cw-on-accent)] ring-2 ring-[var(--cw-card)]">
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
        'group relative flex size-9 shrink-0 items-center justify-center rounded-[var(--cw-r)] transition-colors',
        active ? 'bg-[var(--cw-row-hover)] text-[var(--cw-ink)]' : 'text-[var(--cw-muted)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]',
      )}
    >
      {active && <span aria-hidden className="absolute -left-2 top-2 bottom-2 w-0.5 rounded-r bg-[var(--cw-accent)]" />}
      <Icon size={18} strokeWidth={active ? 2.2 : 1.9} />
      <Count n={badge} />
      <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-[var(--cw-r)] bg-[var(--cw-ink)] px-2 py-1 text-[12px] font-semibold text-[var(--cw-shell)] opacity-0 shadow-[var(--cw-shadow)] transition-opacity group-hover:opacity-100">
        {item.label}
      </span>
    </button>
  );
}

function Rail({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const section = SECTION[page];
  const np = useNewPart();
  return (
    <aside className="sticky top-0 z-30 hidden h-screen w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--cw-line)] bg-[var(--cw-card)] py-2 md:flex">
      <button type="button" onClick={() => navigate('home')} className="mb-1 flex size-9 items-center justify-center" aria-label="Home">
        <Mark size={28} />
      </button>
      <button
        type="button"
        aria-label="New part"
        title="New part"
        onClick={(e) => np.open(e.currentTarget)}
        className="flex size-9 shrink-0 items-center justify-center rounded-[var(--cw-r)] bg-[var(--cw-accent)] text-[var(--cw-on-accent)] transition-opacity hover:opacity-90"
      >
        <Plus size={18} strokeWidth={2.4} />
      </button>
      {GROUPS.slice(0, 2).map((g, i) => (
        <nav key={i} className="flex flex-col items-center gap-1 border-t border-[var(--cw-hair)] pt-1" aria-label={i === 0 ? 'Main' : 'History'}>
          {g.map((it) => (
            <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
          ))}
        </nav>
      ))}
      <span className="flex-1" />
      <nav className="flex flex-col items-center gap-1" aria-label="Setup">
        {(GROUPS[2] ?? []).map((it) => (
          <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
        ))}
      </nav>
    </aside>
  );
}

function MobileBar({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const np = useNewPart();
  const [more, setMore] = useState(false);
  const section = SECTION[page];
  const all = GROUPS.flat();
  const tab = (it: NavItem): React.JSX.Element => {
    const Icon = it.icon;
    const active = it.page === section;
    return (
      <button
        key={it.page}
        type="button"
        onClick={() => navigate(it.page)}
        aria-label={it.label}
        aria-current={active ? 'page' : undefined}
        className={cn('relative flex size-10 items-center justify-center rounded-[var(--cw-r)]', active ? 'bg-[var(--cw-row-hover)] text-[var(--cw-ink)]' : 'text-[var(--cw-muted)]')}
      >
        <Icon size={19} />
        <Count n={badges[it.page]} />
      </button>
    );
  };
  const pinned: Page[] = ['home', 'parts', 'requests'];
  const inMore = !pinned.includes(section);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-[var(--cw-line)] bg-[var(--cw-card)] px-2 md:hidden">
      {tab(all[0] as NavItem)}
      {tab(all[1] as NavItem)}
      <button
        type="button"
        aria-label="New part"
        onClick={(e) => np.open(e.currentTarget)}
        className="flex size-10 items-center justify-center rounded-[var(--cw-r-md)] bg-[var(--cw-accent)] text-[var(--cw-on-accent)] active:opacity-90"
      >
        <Plus size={20} strokeWidth={2.4} />
      </button>
      {tab(all[2] as NavItem)}
      <div className="relative">
        <button
          type="button"
          aria-label="More pages"
          onClick={() => setMore((m) => !m)}
          className={cn('relative flex size-10 items-center justify-center rounded-[var(--cw-r)]', inMore ? 'bg-[var(--cw-row-hover)] text-[var(--cw-ink)]' : 'text-[var(--cw-muted)]')}
        >
          <Menu size={19} />
        </button>
        <Popover open={more} onClose={() => setMore(false)} align="right" className="bottom-[calc(100%+8px)] top-auto w-52">
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
                  className={cn(menuItem, it.page === section && 'bg-[var(--cw-row)]')}
                >
                  <Icon size={15} />
                  {it.label}
                </button>
              );
            })}
        </Popover>
      </div>
    </div>
  );
}

export function Frame({ page, children, wide = false }: { page: Page; children: ReactNode; wide?: boolean }): React.JSX.Element {
  const badges = useBadges();
  return (
    <div className="flex min-h-screen bg-[var(--cw-shell)]">
      <Rail page={page} badges={badges} />
      <main className={cn('min-w-0 flex-1', wide ? 'h-[calc(100dvh-56px)] overflow-hidden md:h-screen' : 'px-3 pb-20 pt-4 md:px-6 md:pb-8 md:pt-5')}>
        {wide ? children : <div className="mx-auto w-full max-w-[1440px]">{children}</div>}
      </main>
      <MobileBar page={page} badges={badges} />
    </div>
  );
}
