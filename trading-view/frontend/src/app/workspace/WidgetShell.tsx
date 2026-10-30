/**
 * The frame every widget sits in: a 28px header (drag handle) with the link
 * channel dot, the widget's own title and controls, maximize and a menu
 * (link channel, duplicate, remove); the body fills the rest.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Ellipsis, Link2, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { IconBtn, LinkDot, MenuList, Popover } from '../components/ui.tsx';
import type { MenuEntry } from '../components/ui.tsx';
import { useApp } from '../lib/store.tsx';
import type { Widget } from '../lib/types.ts';

const CHANNELS = ['1', '2', '3', '4', '5', '6'];
const LINKABLE = new Set(['chart', 'chartgrid', 'watchlist', 'details', 'news', 'analyst', 'screener', 'heatmap', 'ticker', 'alerts']);

export function WidgetShell({
  w,
  title,
  actions,
  menu = [],
  children,
  className,
  strip = false,
}: {
  w: Widget;
  title: ReactNode;
  actions?: ReactNode;
  menu?: MenuEntry[];
  children: ReactNode;
  className?: string;
  /** A one-line widget (the ticker): a slim grip on the left instead of a header. */
  strip?: boolean;
}): React.JSX.Element {
  const app = useApp();
  const [linkOpen, setLinkOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const linkRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const max = app.maximized === w.id;
  const focused = app.focused === w.id;
  const items: MenuEntry[] = [
    ...menu,
    ...(menu.length > 0 ? (['divider'] as MenuEntry[]) : []),
    { label: max ? 'Restore size' : 'Maximize', icon: max ? Minimize2 : Maximize2, onClick: () => app.setMaximized(max ? '' : w.id) },
    {
      label: 'Duplicate',
      icon: Copy,
      onClick: () => void app.addWidget(w.type, { link: w.link, config: w.config, w: w.w, h: w.h }),
    },
    { label: 'Remove widget', icon: Trash2, danger: true, onClick: () => app.removeWidget(w) },
  ];
  const channelItems: MenuEntry[] = [
    { heading: 'Link channel' },
    ...CHANNELS.map((c) => ({
      label: 'Channel ' + c + (app.ws?.links[c] !== undefined ? ' · ' + (app.ws.links[c]?.symbol ?? '').replace('BINANCE:', '') : ''),
      swatch: `var(--tv-link-${c})`,
      checked: w.link === c,
      onClick: () => app.configure(w, w.link === '' ? {} : { symbol: app.shows(w).symbol, interval: app.shows(w).interval }, c),
    })),
    'divider',
    {
      label: 'Not linked (own symbol)',
      icon: Link2,
      checked: w.link === '',
      onClick: () => {
        const s = app.shows(w);
        app.configure(w, { symbol: s.symbol, interval: s.interval }, '');
      },
    },
  ];
  const linkButton = LINKABLE.has(w.type) && (
    <span ref={linkRef} className="tv-nodrag inline-flex">
      <button type="button" aria-label={w.link === '' ? 'Not linked: pick a link channel' : 'Link channel ' + w.link} title={w.link === '' ? 'Not linked' : 'Link channel ' + w.link} onClick={() => setLinkOpen((o) => !o)} className="flex size-5 items-center justify-center rounded-[4px] hover:bg-[var(--tv-row)]">
        <LinkDot link={w.link} />
      </button>
      <Popover open={linkOpen} onClose={() => setLinkOpen(false)} anchor={linkRef}>
        <MenuList items={channelItems} onPicked={() => setLinkOpen(false)} />
      </Popover>
    </span>
  );
  const menuButton = (
    <span ref={menuRef} className="tv-nodrag inline-flex">
      <IconBtn icon={Ellipsis} label="Widget menu" size={strip ? 20 : 24} active={menuOpen} onClick={() => setMenuOpen((o) => !o)} />
      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchor={menuRef} align="right">
        <MenuList items={items} onPicked={() => setMenuOpen(false)} />
      </Popover>
    </span>
  );
  if (strip)
    return (
      <section className={cn('flex h-full min-h-0 w-full min-w-0 bg-[var(--tv-card)]', className)} onPointerDownCapture={() => !focused && app.setFocused(w.id)} aria-label={w.type}>
        <div className="tv-drag flex w-[22px] shrink-0 flex-col items-center justify-center gap-0.5 border-r border-[var(--tv-hair)]">
          {linkButton}
          {menuButton}
        </div>
        <div className="relative min-w-0 flex-1">{children}</div>
        {actions !== undefined && <div className="tv-nodrag flex shrink-0 items-center border-l border-[var(--tv-hair)] px-0.5">{actions}</div>}
      </section>
    );
  return (
    <section
      className={cn('flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--tv-card)]', className)}
      onPointerDownCapture={() => {
        if (!focused) app.setFocused(w.id);
      }}
      aria-label={w.type}
    >
      <header className={cn('tv-drag flex h-7 shrink-0 items-center gap-1 border-b border-[var(--tv-hair)] pl-1.5 pr-0.5', focused && 'shadow-[inset_0_2px_0_var(--tv-ink)]')} onDoubleClick={(e) => (e.target as HTMLElement).closest('button,input,select') === null && app.setMaximized(max ? '' : w.id)}>
        {linkButton}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">{title}</div>
        <div className="tv-nodrag flex shrink-0 items-center gap-px">
          {actions}
          {menuButton}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** A compact title: bold name and muted detail. */
export function Title({ children, detail }: { children: ReactNode; detail?: ReactNode }): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 truncate">
      <span className="truncate text-[12px] font-bold">{children}</span>
      {detail !== undefined && <span className="truncate text-[11px] font-semibold text-[var(--tv-muted)]">{detail}</span>}
    </span>
  );
}
