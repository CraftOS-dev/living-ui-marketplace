/**
 * The sidebar (SPEC 3): the app's name in plain text next to the lucide
 * Telescope; the fund scope as a tree row (only with more than one fund);
 * the one black action (Add deal, from intake's `primary`); the places from
 * the modules' `nav`, each with its count; at the foot your AI agent and
 * Settings. It folds to an icon rail only by its own toggle (always shown,
 * remembered in this browser); opening a page never folds it.
 *
 * Fix 5: when the firm has its own logo (Settings, Firm; auth.me carries
 * firm.logo_url, so it shows on first paint), the logo takes the place of
 * the app's name and icon: at most 28 px high and 160 px wide, never
 * enlarged past its own size (kept sharp), named and titled with the firm's
 * name; on the folded rail it sits fitted in a 32 px square above the
 * toggle. On the dark theme it sits on a small white plate (.vo-logo-plate:
 * most logos are dark ink). Without a logo nothing changes.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronRight, Layers, PanelLeftClose, PanelLeftOpen, Settings, Telescope, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { useImage } from '../../lib/images.ts';
import type { CountSource, NavItem } from '../../lib/contract.ts';
import { navigate, under, useRoute } from '../../lib/router.ts';
import { setUi, useUi } from '../../lib/store.ts';
import { navItems, primary } from '../../registry.ts';
import { Count } from '../ui.tsx';
import { AgentCard } from './AgentPanel.tsx';
import { useShellCounts } from './counts.ts';

function useCount(source: CountSource | undefined): number {
  const counts = useShellCounts();
  if (source === undefined || typeof source === 'function') return 0;
  return source.kinds.reduce((a, k) => a + (counts.byKind[k] ?? 0), 0);
}

/** A hook count source runs in its own component (hooks stay in order). */
function HookCount({ hook, collapsed }: { hook: () => number | null; collapsed: boolean }): React.JSX.Element | null {
  const n = hook() ?? 0;
  return <CountMark n={n} collapsed={collapsed} />;
}

function CountMark({ n, collapsed }: { n: number; collapsed: boolean }): React.JSX.Element | null {
  if (n <= 0) return null;
  if (collapsed) return <span aria-hidden className="absolute right-2 top-1.5 size-1.5 rounded-full bg-[var(--vo-ink)]" />;
  return <Count n={n} />;
}

function Row({ icon: Icon, label, to, active, collapsed, onClick, strong, count, title }: { icon: LucideIcon; label: string; to?: string | undefined; active?: boolean | undefined; collapsed: boolean; onClick?: (() => void) | undefined; strong?: boolean | undefined; count?: React.ReactNode; title?: string | undefined }): React.JSX.Element {
  const cls = cn(
    'vo-focus vo-tap group relative flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[var(--vo-radius-sm)] px-2.5 text-[13px] transition-colors duration-150',
    strong === true ? 'bg-[var(--vo-ink)] font-semibold text-[var(--vo-on-ink)] hover:brightness-[1.35] dark:hover:brightness-[0.82]' : active === true ? 'bg-[var(--vo-active)] font-semibold text-[var(--vo-ink)] hover:bg-[var(--vo-active-hover)]' : 'text-[var(--vo-ink)] hover:bg-[var(--vo-hover)]',
    collapsed && 'justify-center px-0',
  );
  const inner = (
    <>
      {active === true && strong !== true && <span aria-hidden className="absolute left-0 top-2 h-5 w-[2px] rounded-full bg-[var(--vo-ink)]" />}
      <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {count}
    </>
  );
  if (to !== undefined)
    return (
      <a href={'#' + to} title={collapsed ? label : title} aria-current={active === true ? 'page' : undefined} className={cls}>
        {inner}
      </a>
    );
  return (
    <button type="button" title={collapsed ? label : title} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function Place({ item, collapsed, path }: { item: NavItem; collapsed: boolean; path: string }): React.JSX.Element {
  const n = useCount(item.count);
  const here = under(path, item.path);
  const childHere = (item.children ?? []).some((c) => under(path, c.path));
  const count = typeof item.count === 'function' ? <HookCount hook={item.count} collapsed={collapsed} /> : <CountMark n={n} collapsed={collapsed} />;
  return (
    <>
      <Row icon={item.icon} label={item.label} to={item.path} active={here && !childHere} collapsed={collapsed} count={count} />
      {!collapsed && here && (item.children ?? []).length > 0 && (
        <div role="group" className="flex shrink-0 flex-col gap-0.5 pb-1">
          {(item.children ?? []).map((c) => {
            const on = under(path, c.path);
            return (
              <a key={c.key} href={'#' + c.path} role="treeitem" aria-current={on ? 'page' : undefined} className={cn('vo-focus vo-tap relative flex h-8 items-center rounded-[var(--vo-radius-sm)] pl-[37px] pr-2 text-[13px] transition-colors duration-150', on ? 'bg-[var(--vo-active)] font-medium text-[var(--vo-ink)] hover:bg-[var(--vo-active-hover)]' : 'text-[var(--vo-ink-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}>
                {on && <span aria-hidden className="absolute left-0 top-1.5 h-5 w-[2px] rounded-full bg-[var(--vo-ink)]" />}
                <span className="truncate">{c.label}</span>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

/** "All funds" or one fund, as a tree row that opens its children in place (never a select). */
function FundScope({ collapsed }: { collapsed: boolean }): React.JSX.Element | null {
  const me = useMe();
  const { fund } = useUi();
  const [open, setOpen] = useState(false);
  const funds = me.funds;
  // A remembered fund that no longer exists (or is no longer visible) falls back to all funds.
  useEffect(() => {
    if (fund !== '' && funds.length > 0 && !funds.some((f) => f.id === fund)) setUi({ fund: '' });
  }, [fund, funds]);
  if (funds.length < 2 || collapsed) return null;
  const cur = funds.find((f) => f.id === fund) ?? null;
  const pick = (id: string): void => {
    setUi({ fund: id });
    setOpen(false);
  };
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div role="tree" aria-label="Fund scope" className="flex shrink-0 flex-col gap-0.5 px-2 pb-2">
      <button type="button" role="treeitem" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="vo-focus vo-tap flex h-8 items-center gap-2 rounded-[var(--vo-radius-sm)] px-2.5 text-left text-[13px] text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
        <Layers size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{cur?.name ?? 'All funds'}</span>
        <Chevron size={14} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
      </button>
      {open && (
        <div role="group" className="flex flex-col gap-0.5">
          {[{ id: '', name: 'All funds' }, ...funds].map((f) => (
            <button key={f.id} type="button" role="treeitem" aria-selected={fund === f.id} onClick={() => pick(f.id)} className={cn('vo-focus vo-tap flex h-8 items-center rounded-[var(--vo-radius-sm)] pl-[34px] pr-2 text-left text-[13px] transition-colors duration-150', fund === f.id ? 'bg-[var(--vo-active)] font-medium text-[var(--vo-ink)] hover:bg-[var(--vo-active-hover)]' : 'text-[var(--vo-ink-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}>
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The firm's own logo in the sidebar's head (src undefined while it loads: an empty box of the same height, no flash of the app's name). */
function FirmLogo({ src, name, collapsed }: { src: string | undefined; name: string; collapsed: boolean }): React.JSX.Element {
  if (collapsed)
    return (
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden" title={name}>
        {src !== undefined && (
          <span data-square="" className="vo-logo-plate flex size-8 items-center justify-center">
            <img src={src} alt={name} draggable={false} className="block h-auto max-h-full w-auto max-w-full object-contain" />
          </span>
        )}
      </span>
    );
  return (
    <span className="flex min-h-7 min-w-0 flex-1 items-center" title={name}>
      {src !== undefined && (
        <span className="vo-logo-plate inline-flex max-w-full items-center">
          <img src={src} alt={name} draggable={false} className="block h-auto max-h-7 w-auto max-w-[160px] object-contain" />
        </span>
      )}
    </span>
  );
}

export function Sidebar({ collapsed, onCollapse, drawer, onCloseDrawer }: { collapsed: boolean; onCollapse: (v: boolean) => void; drawer?: boolean | undefined; onCloseDrawer?: (() => void) | undefined }): React.JSX.Element {
  const me = useMe();
  const { path } = useRoute();
  const places = navItems().filter((p) => allowed(me, p.perm));
  const main = primary();
  const showPrimary = main !== null && allowed(me, main.perm);
  const logoUrl = me.firm.logo_url ?? '';
  const logo = useImage(logoUrl);
  const firmLogo = logoUrl !== '' && logo !== null;
  const firmName = me.firm.name !== '' ? me.firm.name : 'Your firm';
  const rail = collapsed && drawer !== true;
  return (
    <nav
      aria-label="Main"
      onClick={drawer === true ? (e) => (e.target as HTMLElement).closest('a') !== null && onCloseDrawer?.() : undefined}
      className={cn('flex h-full shrink-0 flex-col bg-[var(--vo-side)] transition-[width] duration-200', drawer === true ? 'w-full' : cn('border-r border-[var(--vo-line)]', collapsed ? 'w-[60px]' : 'w-[232px]'))}
    >
      {firmLogo && rail && (
        <div className="flex h-14 shrink-0 items-center justify-center" data-vo-firm-logo="rail">
          <FirmLogo src={logo} name={firmName} collapsed />
        </div>
      )}
      <div className={cn('flex shrink-0 items-center gap-2 px-3.5', firmLogo && rail ? 'h-10' : 'h-14', collapsed && 'justify-center px-0')}>
        {!collapsed &&
          (firmLogo ? (
            <span data-vo-firm-logo="open" className="flex min-w-0 flex-1">
              <FirmLogo src={logo} name={firmName} collapsed={false} />
            </span>
          ) : (
            <>
              <Telescope size={18} strokeWidth={1.9} aria-hidden className="shrink-0 text-[var(--vo-ink)]" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">Venture OS</span>
            </>
          ))}
        {drawer === true ? (
          <button type="button" aria-label="Close menu" onClick={onCloseDrawer} className="vo-focus flex size-9 items-center justify-center rounded-[var(--vo-radius-sm)] text-[var(--vo-muted)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
            <X size={18} aria-hidden />
          </button>
        ) : (
          <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Fold sidebar'} title={collapsed ? 'Expand sidebar' : 'Fold sidebar'} onClick={() => onCollapse(!collapsed)} className="vo-focus vo-tap-sq flex size-7 items-center justify-center rounded-[var(--vo-radius-sm)] text-[var(--vo-muted)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        )}
      </div>
      <FundScope collapsed={collapsed} />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 pb-2">
        {showPrimary && main !== null && (
          <>
            <Row
              icon={main.icon}
              label={main.label}
              strong
              collapsed={collapsed}
              onClick={() => {
                if (main.run !== undefined) main.run();
                else if (main.to !== undefined) navigate(main.to);
                onCloseDrawer?.();
              }}
            />
            <div className="h-2" />
          </>
        )}
        {places.map((p) => (
          <Place key={p.key} item={p} collapsed={collapsed} path={path} />
        ))}
      </div>
      <div className="shrink-0 border-t border-[var(--vo-hair)] px-2 py-2">
        <AgentCard collapsed={collapsed} onOpen={onCloseDrawer} />
        <Row icon={Settings} label="Settings" to="/settings" active={under(path, '/settings')} collapsed={collapsed} />
      </div>
    </nav>
  );
}
