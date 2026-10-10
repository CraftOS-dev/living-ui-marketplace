/**
 * App frame: a warm canvas holding one rounded shell. On wide screens a
 * slim icon rail on the left (labels appear on hover, counts sit on the
 * icons that have work waiting); on phones a floating bottom bar with the
 * stock change button in the middle.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Boxes, ClipboardCheck, FileUp, History, House, Menu, Plus, QrCode, ScanBarcode, Settings, ShoppingCart, Store, Truck, Warehouse } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { SECTION, navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { useStockChange } from './StockChange.tsx';
import { Popover } from './ui.tsx';

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

const GROUPS: NavItem[][] = [
  [
    { page: 'home', label: 'Home', icon: House },
    { page: 'items', label: 'Items', icon: Boxes },
    { page: 'locations', label: 'Locations', icon: Warehouse },
    { page: 'activity', label: 'Activity', icon: History },
  ],
  [
    { page: 'scan', label: 'Scan', icon: ScanBarcode },
    { page: 'reorder', label: 'Reorder', icon: ShoppingCart },
    { page: 'orders', label: 'Purchase orders', icon: Truck },
    { page: 'counts', label: 'Stock counts', icon: ClipboardCheck },
  ],
  [
    { page: 'suppliers', label: 'Suppliers', icon: Store },
    { page: 'labels', label: 'Labels', icon: QrCode },
    { page: 'data', label: 'Import and export', icon: FileUp },
    { page: 'settings', label: 'Settings', icon: Settings },
  ],
];

/** The app's mark: three stacked boxes, the top one in the accent. */
export function Mark({ size = 40 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="iv-on-ink">
      <circle cx="20" cy="20" r="20" fill="var(--iv-ink)" />
      <rect x="9.5" y="20.5" width="9.5" height="9.5" rx="2.4" fill="var(--iv-shell)" />
      <rect x="21" y="20.5" width="9.5" height="9.5" rx="2.4" fill="var(--iv-shell)" />
      <rect x="15.25" y="9.5" width="9.5" height="9.5" rx="2.4" fill="var(--iv-accent)" />
    </svg>
  );
}

/** Work waiting per page (counts on the rail icons). */
function useBadges(): Partial<Record<Page, number>> {
  const d = useLive(() => api.dashboard(), ['items', 'stock', 'orders', 'order_lines', 'counts', 'documents'], []);
  const s = d.data;
  if (s === null) return {};
  return {
    reorder: s.reorder,
    orders: s.incoming.counts.late + s.documents.failed,
    counts: s.counting,
  };
}

function Badge({ n }: { n: number | undefined }): React.JSX.Element | null {
  if (n === undefined || n <= 0) return null;
  return (
    <span className="num absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--iv-accent)] px-1 text-[12px] font-bold leading-none text-[var(--iv-on-accent)] ring-2 ring-[var(--iv-card)]">
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
        'group relative flex size-11 shrink-0 items-center justify-center rounded-full transition-colors [@media(max-height:840px)]:size-9',
        active ? 'bg-[var(--iv-solid)] text-[var(--iv-on-solid)]' : 'text-[var(--iv-muted)] hover:bg-[var(--iv-row)] hover:text-[var(--iv-ink)]',
      )}
    >
      <Icon size={19} strokeWidth={active ? 2.2 : 1.9} />
      <Badge n={badge} />
      <span className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-full bg-[var(--iv-ink)] px-3 py-1.5 text-[12px] font-semibold text-[var(--iv-shell)] opacity-0 transition-opacity group-hover:opacity-100">
        {item.label}
      </span>
    </button>
  );
}

function Rail({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const section = SECTION[page];
  return (
    <aside className="sticky top-4 z-20 hidden h-[calc(100vh-32px)] w-[96px] shrink-0 flex-col items-center gap-4 py-7 md:flex [@media(max-height:840px)]:gap-3 [@media(max-height:840px)]:py-4">
      <button type="button" onClick={() => navigate('home')} className="flex flex-col items-center gap-1.5" aria-label="Home">
        <Mark size={40} />
        <span className="text-[12px] font-bold [@media(max-height:740px)]:hidden">Inventory</span>
      </button>
      {GROUPS.slice(0, 2).map((g, i) => (
        <nav key={i} className="flex flex-col items-center gap-1.5 rounded-full bg-[var(--iv-card)] p-1.5" aria-label={i === 0 ? 'Main' : 'Work'}>
          {g.map((it) => (
            <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
          ))}
        </nav>
      ))}
      <span className="flex-1" />
      <nav className="flex flex-col items-center gap-1.5 rounded-full bg-[var(--iv-card)] p-1.5" aria-label="Setup">
        {(GROUPS[2] ?? []).map((it) => (
          <RailButton key={it.page} item={it} active={it.page === section} badge={badges[it.page]} />
        ))}
      </nav>
    </aside>
  );
}

function MobileBar({ page, badges }: { page: Page; badges: Partial<Record<Page, number>> }): React.JSX.Element {
  const change = useStockChange();
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
        className={cn('relative flex size-11 items-center justify-center rounded-full', active ? 'bg-[var(--iv-solid)] text-[var(--iv-on-solid)]' : 'text-[var(--iv-muted)]')}
      >
        <Icon size={19} />
        <Badge n={badges[it.page]} />
      </button>
    );
  };
  const pinned: Page[] = ['home', 'items', 'scan'];
  const inMore = !pinned.includes(section);
  const moreCount = all.filter((it) => !pinned.includes(it.page)).reduce((s, it) => s + (badges[it.page] ?? 0), 0);
  return (
    <div className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-full bg-[var(--iv-card)] px-3 py-2 shadow-[0_18px_40px_-18px_rgba(29,28,26,0.55)] md:hidden">
      {tab(all[0] as NavItem)}
      {tab(all[1] as NavItem)}
      <button
        type="button"
        aria-label="Stock change"
        onClick={(e) => change.open(e.currentTarget)}
        className="-mt-8 flex size-14 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)] shadow-[0_14px_30px_-12px_rgba(29,28,26,0.7)] active:scale-95"
      >
        <Plus size={24} strokeWidth={2.4} />
      </button>
      {tab(all[4] as NavItem)}
      <div className="relative">
        <button
          type="button"
          aria-label="More pages"
          onClick={() => setMore((m) => !m)}
          className={cn('relative flex size-11 items-center justify-center rounded-full', inMore ? 'bg-[var(--iv-solid)] text-[var(--iv-on-solid)]' : 'text-[var(--iv-muted)]')}
        >
          <Menu size={19} />
          <Badge n={moreCount} />
        </button>
        <Popover open={more} onClose={() => setMore(false)} align="right" className="bottom-[calc(100%+12px)] top-auto max-h-[70vh] w-60 overflow-y-auto">
          {all
            .filter((it) => !pinned.includes(it.page))
            .map((it) => {
              const Icon = it.icon;
              const n = badges[it.page];
              return (
                <button
                  key={it.page}
                  type="button"
                  onClick={() => {
                    setMore(false);
                    navigate(it.page);
                  }}
                  className={cn('flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-[var(--iv-row)]', it.page === section && 'bg-[var(--iv-row)]')}
                >
                  <Icon size={17} className="text-[var(--iv-ink-2)]" />
                  <span className="flex-1">{it.label}</span>
                  {n !== undefined && n > 0 && <span className="num rounded-full bg-[var(--iv-accent)] px-2 text-[12px] font-bold text-[var(--iv-on-accent)]">{n}</span>}
                </button>
              );
            })}
        </Popover>
      </div>
    </div>
  );
}

export function Frame({ page, children }: { page: Page; children: ReactNode }): React.JSX.Element {
  const badges = useBadges();
  return (
    <div className="min-h-screen bg-[var(--iv-canvas)] md:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1440px] bg-[var(--iv-shell)] md:min-h-[calc(100vh-32px)] md:rounded-[36px]">
        <Rail page={page} badges={badges} />
        <main className="min-w-0 flex-1 px-4 pb-32 pt-6 md:py-8 md:pl-2 md:pr-8">{children}</main>
      </div>
      <MobileBar page={page} badges={badges} />
    </div>
  );
}
