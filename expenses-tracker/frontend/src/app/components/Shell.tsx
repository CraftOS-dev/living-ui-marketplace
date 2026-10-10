/**
 * App frame: a warm canvas holding one rounded shell. On wide screens a
 * slim icon rail on the left (labels appear on hover); on phones a floating
 * bottom bar with the add button in the middle.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChartPie, FileUp, House, LayoutList, Menu, Plus, Repeat, ScanLine, Settings, Shapes, Target } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { useEntry } from './Entry.tsx';
import { Popover } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

const GROUPS: NavItem[][] = [
  [
    { page: 'home', label: 'Home', icon: House },
    { page: 'expenses', label: 'Expenses', icon: LayoutList },
    { page: 'insights', label: 'Insights', icon: ChartPie },
    { page: 'budgets', label: 'Budgets', icon: Target },
  ],
  [
    { page: 'recurring', label: 'Recurring', icon: Repeat },
    { page: 'receipts', label: 'Receipts', icon: ScanLine },
    { page: 'import', label: 'Import and export', icon: FileUp },
  ],
  [
    { page: 'categories', label: 'Categories', icon: Shapes },
    { page: 'settings', label: 'Settings', icon: Settings },
  ],
];

export function Mark({ size = 40 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="et-on-ink">
      <circle cx="20" cy="20" r="20" fill="var(--et-ink)" />
      <circle cx="20" cy="20" r="9.5" fill="none" stroke="var(--et-shell)" strokeWidth="5" strokeDasharray="40 19.7" strokeDashoffset="-17" transform="rotate(-90 20 20)" />
      <circle cx="20" cy="20" r="9.5" fill="none" stroke="var(--et-accent)" strokeWidth="5" strokeDasharray="14 45.7" transform="rotate(-90 20 20)" />
    </svg>
  );
}

function RailButton({ item, active }: { item: NavItem; active: boolean }): React.JSX.Element {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => navigate(item.page)}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex size-11 items-center justify-center rounded-full transition-colors',
        active ? 'bg-[var(--et-solid)] text-[var(--et-on-solid)]' : 'text-[var(--et-muted)] hover:bg-[var(--et-row)] hover:text-[var(--et-ink)]',
      )}
    >
      <Icon size={19} strokeWidth={active ? 2.2 : 1.9} />
      <span className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-full bg-[var(--et-ink)] px-3 py-1.5 text-[12px] font-semibold text-[var(--et-shell)] opacity-0 transition-opacity group-hover:opacity-100">
        {item.label}
      </span>
    </button>
  );
}

function Rail({ page }: { page: Page }): React.JSX.Element {
  return (
    <aside className="sticky top-0 z-20 hidden h-[calc(100vh-32px)] w-[96px] shrink-0 flex-col items-center gap-5 py-7 md:flex">
      <button type="button" onClick={() => navigate('home')} className="flex flex-col items-center gap-1.5" aria-label="Home">
        <Mark size={40} />
        <span className="text-[12px] font-bold">Expenses</span>
      </button>
      {GROUPS.slice(0, 2).map((g, i) => (
        <nav key={i} className="flex flex-col items-center gap-1.5 rounded-full bg-[var(--et-card)] p-1.5" aria-label={i === 0 ? 'Main' : 'Tools'}>
          {g.map((it) => (
            <RailButton key={it.page} item={it} active={it.page === page} />
          ))}
        </nav>
      ))}
      <span className="flex-1" />
      <nav className="flex flex-col items-center gap-1.5 rounded-full bg-[var(--et-card)] p-1.5" aria-label="Setup">
        {(GROUPS[2] ?? []).map((it) => (
          <RailButton key={it.page} item={it} active={it.page === page} />
        ))}
      </nav>
    </aside>
  );
}

function MobileBar({ page }: { page: Page }): React.JSX.Element {
  const entry = useEntry();
  const [more, setMore] = useState(false);
  const all = GROUPS.flat();
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
        className={cn('flex size-11 items-center justify-center rounded-full', active ? 'bg-[var(--et-solid)] text-[var(--et-on-solid)]' : 'text-[var(--et-muted)]')}
      >
        <Icon size={19} />
      </button>
    );
  };
  const inMore = !['home', 'expenses', 'insights'].includes(page);
  return (
    <div className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-full bg-[var(--et-card)] px-3 py-2 shadow-[0_18px_40px_-18px_rgba(29,28,26,0.55)] md:hidden">
      {tab(all[0] as NavItem)}
      {tab(all[1] as NavItem)}
      <button
        type="button"
        aria-label="Add expense"
        onClick={(e) => entry.add(e.currentTarget)}
        className="-mt-8 flex size-14 items-center justify-center rounded-full bg-[var(--et-solid)] text-[var(--et-on-solid)] shadow-[0_14px_30px_-12px_rgba(29,28,26,0.7)] active:scale-95"
      >
        <Plus size={24} strokeWidth={2.4} />
      </button>
      {tab(all[2] as NavItem)}
      <div className="relative">
        <button
          type="button"
          aria-label="More pages"
          onClick={() => setMore((m) => !m)}
          className={cn('flex size-11 items-center justify-center rounded-full', inMore ? 'bg-[var(--et-solid)] text-[var(--et-on-solid)]' : 'text-[var(--et-muted)]')}
        >
          <Menu size={19} />
        </button>
        <Popover open={more} onClose={() => setMore(false)} align="right" className="bottom-[calc(100%+12px)] top-auto w-56">
          {all.slice(3).map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.page}
                type="button"
                onClick={() => {
                  setMore(false);
                  navigate(it.page);
                }}
                className={cn('flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-[var(--et-row)]', it.page === page && 'bg-[var(--et-row)]')}
              >
                <Icon size={17} className="text-[var(--et-ink-2)]" />
                {it.label}
              </button>
            );
          })}
        </Popover>
      </div>
    </div>
  );
}

export function Frame({ page, children }: { page: Page; children: ReactNode }): React.JSX.Element {
  return (
    <div className="min-h-screen bg-[var(--et-canvas)] md:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1440px] bg-[var(--et-shell)] md:min-h-[calc(100vh-32px)] md:rounded-[36px]">
        <Rail page={page} />
        <main className="min-w-0 flex-1 px-4 pb-32 pt-6 md:py-8 md:pl-2 md:pr-8">{children}</main>
      </div>
      <MobileBar page={page} />
    </div>
  );
}
