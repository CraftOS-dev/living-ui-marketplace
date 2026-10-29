/**
 * App frame: a full-height app. On wide screens a slim icon rail on the left
 * (labels appear on hover, counts sit on the icons that have something
 * waiting) beside the page; on phones a bottom bar with the import button
 * in the middle. The image workspace fills the whole page area.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileDown, History, Images, Inbox, Layers, Menu, Plus, Settings } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { SECTION, navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { useImporter } from './Importer.tsx';
import { Popover, menuItem } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

const GROUPS: NavItem[][] = [
  [
    { page: 'home', label: 'Library', icon: Images },
    { page: 'batches', label: 'Batches', icon: Layers },
    { page: 'requests', label: 'Requests to your AI agent', icon: Inbox },
  ],
  [
    { page: 'activity', label: 'Activity', icon: History },
    { page: 'exports', label: 'Exports', icon: FileDown },
  ],
  [{ page: 'settings', label: 'Settings', icon: Settings }],
];

/** The app's mark: a framed picture (accent sun over two hills) on an ink tile. */
export function Mark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="iu-on-ink shrink-0">
      <rect width="40" height="40" rx="9" fill="var(--iu-ink)" />
      <rect x="9" y="11" width="22" height="18" rx="2.5" fill="none" stroke="var(--iu-shell)" strokeWidth="2" />
      <circle cx="25.5" cy="16.5" r="2.6" fill="var(--iu-accent)" />
      <path d="M10.5 27.5 L17 20 L21.5 24.5 L24 22 L29.5 27.5 Z" fill="var(--iu-shell)" />
    </svg>
  );
}

function useBadges(): Partial<Record<Page, number>> {
  const { status } = useApp();
  if (status === null) return {};
  return {
    home: status.proposals,
    requests: status.open_requests,
    batches: status.batches_running,
  };
}

function Count({ n }: { n: number | undefined }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return (
    <span className="num absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--iu-accent)] px-1 text-[12px] font-bold leading-none text-[var(--iu-on-accent)] ring-2 ring-[var(--iu-card)]">
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
        'group relative flex size-9 shrink-0 items-center justify-center rounded-[var(--iu-r)] transition-colors',
        active ? 'bg-[var(--iu-row-hover)] text-[var(--iu-ink)]' : 'text-[var(--iu-muted)] hover:bg-[var(--iu-row)] hover:text-[var(--iu-ink)]',
      )}
    >
      {active && <span aria-hidden className="absolute -left-2 top-2 bottom-2 w-0.5 rounded-r bg-[var(--iu-accent)]" />}
      <Icon size={18} strokeWidth={active ? 2.2 : 1.9} />
      <Count n={badge} />
      <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-[var(--iu-r)] bg-[var(--iu-ink)] px-2 py-1 text-[12px] font-semibold text-[var(--iu-shell)] opacity-0 shadow-[var(--iu-shadow)] transition-opacity group-hover:opacity-100">
        {item.label}
      </span>
    </button>
  );
}

function Rail({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const section = SECTION[page];
  const imp = useImporter();
  return (
    <aside className="sticky top-0 z-30 hidden h-screen w-[52px] shrink-0 flex-col items-center gap-1 border-r border-[var(--iu-line)] bg-[var(--iu-card)] py-2 md:flex">
      <button type="button" onClick={() => navigate('home')} className="mb-1 flex size-9 items-center justify-center" aria-label="Library">
        <Mark size={28} />
      </button>
      <button
        type="button"
        aria-label="Import images"
        title="Import images (or drop them anywhere)"
        onClick={() => imp.open()}
        className="flex size-9 shrink-0 items-center justify-center rounded-[var(--iu-r)] bg-[var(--iu-accent)] text-[var(--iu-on-accent)] transition-opacity hover:opacity-90"
      >
        <Plus size={18} strokeWidth={2.4} />
      </button>
      {GROUPS.slice(0, 2).map((g, i) => (
        <nav key={i} className="flex flex-col items-center gap-1 border-t border-[var(--iu-hair)] pt-1" aria-label={i === 0 ? 'Main' : 'History'}>
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
  const imp = useImporter();
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
        className={cn('relative flex size-10 items-center justify-center rounded-[var(--iu-r)]', active ? 'bg-[var(--iu-row-hover)] text-[var(--iu-ink)]' : 'text-[var(--iu-muted)]')}
      >
        <Icon size={19} />
        <Count n={badges[it.page]} />
      </button>
    );
  };
  const pinned: Page[] = ['home', 'batches', 'requests'];
  const inMore = !pinned.includes(section);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-[var(--iu-line)] bg-[var(--iu-card)] px-2 md:hidden">
      {tab(all[0] as NavItem)}
      {tab(all[1] as NavItem)}
      <button type="button" aria-label="Import images" onClick={() => imp.open()} className="flex size-10 items-center justify-center rounded-[var(--iu-r-md)] bg-[var(--iu-accent)] text-[var(--iu-on-accent)] active:opacity-90">
        <Plus size={20} strokeWidth={2.4} />
      </button>
      {tab(all[2] as NavItem)}
      <div className="relative">
        <button
          type="button"
          aria-label="More pages"
          onClick={() => setMore((m) => !m)}
          className={cn('relative flex size-10 items-center justify-center rounded-[var(--iu-r)]', inMore ? 'bg-[var(--iu-row-hover)] text-[var(--iu-ink)]' : 'text-[var(--iu-muted)]')}
        >
          <Menu size={19} />
        </button>
        <Popover open={more} onClose={() => setMore(false)} align="right" className="bottom-[calc(100%+8px)] top-auto w-56">
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
                  className={cn(menuItem, it.page === section && 'bg-[var(--iu-row)]')}
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
    <div className="flex min-h-screen bg-[var(--iu-shell)]">
      <Rail page={page} badges={badges} />
      <main className={cn('min-w-0 flex-1', wide ? 'h-[calc(100dvh-56px)] overflow-hidden md:h-screen' : 'px-3 pb-20 pt-4 md:px-6 md:pb-8 md:pt-5')}>
        {wide ? children : <div className="mx-auto w-full max-w-[1440px]">{children}</div>}
      </main>
      <MobileBar page={page} badges={badges} />
    </div>
  );
}
