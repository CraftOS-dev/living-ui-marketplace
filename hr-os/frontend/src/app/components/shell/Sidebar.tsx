/**
 * The sidebar, in Piano Coach's form: the app's name as plain text next to a
 * lucide Users icon, the legal entity, one strong black action (payroll
 * admins: Run payroll; managers: Approvals; employees: Clock in), the places
 * (People and Payroll expand as trees with an inline "+"), and at the foot
 * your AI agent with what it is doing, then Settings. It folds to a rail and
 * back only by its own toggle (shown in both states, remembered per browser).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, ChevronDown, ChevronRight, ChevronsUpDown, ListChecks, PanelLeftClose, PanelLeftOpen, Plus, Settings, UserPlus, X } from 'lucide-react';
import { Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { allowed, can, isManager, useMe } from '../../lib/auth.tsx';
import type { NavTree, PrimaryAction } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';
import { navigate, under, useRoute } from '../../lib/router.ts';
import { setUi, useUi } from '../../lib/store.tsx';
import { MODULE_EXPORTS, navChildren, places } from '../../routes.tsx';
import type { Place } from '../../routes.tsx';
import { CompanyLogo, Count, MenuItem, MenuLabel, Popover } from '../ui.tsx';
import { AgentCard } from './AgentPanel.tsx';
import { useShellCounts } from './counts.ts';

const OPEN_KEY = 'hr.nav.open';

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function NavRow({ icon: Icon, label, to, active, count, collapsed, strong, onClick, busy, aside, countTone, title }: { icon: LucideIcon; label: string; to?: string | undefined; active?: boolean | undefined; count?: number | undefined; collapsed: boolean; strong?: boolean | undefined; onClick?: (() => void) | undefined; busy?: boolean | undefined; aside?: React.ReactNode; countTone?: 'agent' | 'neutral' | undefined; title?: string | undefined }): React.JSX.Element {
  const cls = cn(
    'hr-focus hr-tap group relative flex h-9 w-full shrink-0 items-center gap-2.5 rounded-[var(--hr-radius-sm)] px-2.5 text-[13px] transition-colors',
    strong === true ? 'bg-[var(--hr-ink)] font-semibold text-[var(--hr-on-ink)] hover:brightness-125 dark:hover:brightness-90' : active === true ? 'bg-[var(--hr-active)] font-semibold text-[var(--hr-ink)]' : 'text-[var(--hr-ink)] hover:bg-[var(--hr-hover)]',
    collapsed && 'justify-center px-0',
    busy === true && 'opacity-70',
  );
  const inner = (
    <>
      {active === true && strong !== true && <span aria-hidden className="absolute left-0 top-2 h-5 w-[2px] rounded-full bg-[var(--hr-ink)]" />}
      <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {!collapsed && count !== undefined && <Count n={count} tone={countTone ?? 'agent'} />}
      {collapsed && count !== undefined && count > 0 && <span aria-hidden className="absolute right-2 top-1.5 size-1.5 rounded-full bg-[var(--hr-agent)]" />}
    </>
  );
  const el =
    to !== undefined ? (
      <a href={'#' + to} title={collapsed ? label : undefined} aria-current={active === true ? 'page' : undefined} className={cls}>
        {inner}
      </a>
    ) : (
      <button type="button" title={collapsed ? (title ?? label) : title !== undefined && title !== label ? title : undefined} onClick={onClick} disabled={busy} className={cls}>
        {inner}
      </button>
    );
  if (aside === undefined || collapsed) return el;
  return (
    <div className="group/row relative shrink-0">
      {el}
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">{aside}</div>
    </div>
  );
}

/** A small square button on a nav row (expand, "+"). */
function RowButton({ icon: Icon, label, onClick, visible }: { icon: LucideIcon; label: string; onClick: () => void; visible?: boolean | undefined }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn('hr-focus hit flex size-6 items-center justify-center rounded-[4px] text-[var(--hr-muted)] transition-opacity hover:bg-[var(--hr-raised)] hover:text-[var(--hr-ink)] focus-visible:opacity-100 group-hover/row:opacity-100', visible === true ? 'opacity-100' : 'hover-only opacity-0')}
    >
      <Icon size={14} strokeWidth={1.9} aria-hidden />
    </button>
  );
}

function ChildRow({ label, to, active, count, onAdd, addLabel }: { label: string; to: string; active: boolean; count?: number | undefined; onAdd?: (() => void) | undefined; addLabel?: string | undefined }): React.JSX.Element {
  return (
    <div className="group/row relative shrink-0">
      <a href={'#' + to} aria-current={active ? 'page' : undefined} className={cn('hr-focus hr-tap relative flex h-8 w-full items-center gap-2 rounded-[var(--hr-radius-sm)] pl-[36px] text-[13px] transition-colors', onAdd !== undefined ? 'pr-9' : 'pr-2', active ? 'bg-[var(--hr-active)] font-medium text-[var(--hr-ink)]' : 'text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]')}>
        {active && <span aria-hidden className="absolute left-0 top-1.5 h-5 w-[2px] rounded-full bg-[var(--hr-ink)]" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 && <span className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">{count}</span>}
      </a>
      {onAdd !== undefined && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          <RowButton icon={Plus} label={addLabel ?? t('ui.add')} onClick={onAdd} />
        </div>
      )}
    </div>
  );
}

/** A place with child rows: static sub-pages (nav) and data rows (useNavTree). */
function PlaceRow({ place, collapsed, path, here, open, onToggle, count }: { place: Place; collapsed: boolean; path: string; here: string; open: boolean; onToggle: () => void; count?: number | undefined }): React.JSX.Element {
  const me = useMe();
  const mod = MODULE_EXPORTS[place.module];
  const useTree = mod.useNavTree ?? noTree;
  const tree = useTree();
  const kids = navChildren(place.module).filter((c) => allowed(me, c.perm));
  const hasKids = kids.length > 0 || (tree !== null && tree.children.length > 0);
  const childMatch = kids.some((c) => under(path, c.to)) || (tree?.children.some((c) => here === c.to) ?? false);
  const active = under(path, place.to) && !(open && childMatch);
  const aside =
    collapsed ? undefined : (
      <>
        {tree?.onAdd !== undefined && <RowButton icon={Plus} label={tree.addLabel ?? t('ui.add')} onClick={tree.onAdd} />}
        {hasKids && <RowButton icon={open ? ChevronDown : ChevronRight} label={open ? t('shell.collapse_group') : t('shell.expand_group')} onClick={onToggle} visible />}
      </>
    );
  return (
    <>
      <NavRow icon={place.icon} label={place.label} to={place.to} active={active} collapsed={collapsed} count={count} countTone="neutral" aside={aside} />
      {!collapsed && open && hasKids && (
        <div className="flex shrink-0 flex-col gap-0.5 pb-1">
          {kids.map((c) => (
            <ChildRow key={c.key} label={c.label} to={c.to} active={under(path, c.to)} />
          ))}
          {tree?.children.map((c) => (
            <ChildRow key={c.id} label={c.label} to={c.to} active={here === c.to} count={c.count} onAdd={tree.addTo !== undefined ? () => tree.addTo?.(c.id) : undefined} addLabel={tree.addToLabel} />
          ))}
        </div>
      )}
    </>
  );
}

function noTree(): NavTree | null {
  return null;
}

/** The one strong action at the top, chosen by role. */
function usePrimaryAction(): PrimaryAction | null {
  const me = useMe();
  const kind: 'payroll' | 'manager' | 'employee' | null = can(me, 'payroll', 'edit') ? 'payroll' : isManager(me) || can(me, 'people', 'edit') ? 'manager' : me.employee !== null ? 'employee' : null;
  const defs = useMemo(() => Object.values(MODULE_EXPORTS).flatMap((m) => m.primary ?? []), []);
  // Every primary hook runs on every render (stable order), so hooks stay in order.
  const actions = defs.map((d) => ({ for: d.for, action: d.usePrimary() }));
  // A company with nobody in it yet: the first thing to do is add people, not run payroll.
  const counts = useShellCounts();
  if (counts.people === 0 && can(me, 'people', 'edit')) return { label: t('start.first_people'), short: t('start.add_people_short'), icon: UserPlus, to: '/people/new' };
  if (kind === 'manager') return { label: t('shell.approvals'), icon: ListChecks, to: '/inbox?view=approvals' };
  return actions.find((a) => a.for === kind && a.action !== null)?.action ?? null;
}

function EntitySwitch(): React.JSX.Element | null {
  const me = useMe();
  const { entity } = useUi();
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const list = me.entities;
  const cur = list.find((e) => e.id === entity) ?? null;
  useEffect(() => {
    if (entity !== '' && cur === null) setUi({ entity: '' });
  }, [entity, cur]);
  if (list.length === 0) return null;
  const text = cur !== null ? `${cur.name} · ${cur.country}` : list.length === 1 ? `${list[0]?.name ?? ''} · ${list[0]?.country ?? ''}` : t('shell.all_entities', { n: list.length });
  if (list.length === 1)
    return (
      <div className="hr-label truncate px-3.5 pb-2 pt-0" title={text}>
        {text}
      </div>
    );
  return (
    <div className="px-2 pb-2">
      <button ref={ref} type="button" onClick={() => setOpen((v) => !v)} aria-label={t('shell.choose_entity')} className="hr-focus flex h-7 w-full items-center gap-1.5 rounded-[var(--hr-radius-sm)] px-1.5 text-left transition-colors hover:bg-[var(--hr-hover)]">
        <span className="hr-label min-w-0 flex-1 truncate">{text}</span>
        <ChevronsUpDown size={12} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
      </button>
      <Popover anchor={ref} open={open} onClose={close} width={260} label={t('shell.choose_entity')}>
        <MenuLabel>{t('shell.entities')}</MenuLabel>
        <MenuItem icon={Building2} selected={entity === ''} onClick={() => (setUi({ entity: '' }), close())}>
          {t('shell.all_entities', { n: list.length })}
        </MenuItem>
        {list.map((e) => (
          <MenuItem key={e.id} selected={entity === e.id} hint={`${e.country} · ${e.currency}`} onClick={() => (setUi({ entity: e.id }), close())}>
            {e.name}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}

export function Sidebar({ collapsed, onCollapse, drawer, onCloseDrawer }: { collapsed: boolean; onCollapse: (v: boolean) => void; drawer?: boolean | undefined; onCloseDrawer?: (() => void) | undefined }): React.JSX.Element {
  const me = useMe();
  const { path, query } = useRoute();
  const here = path + (query.toString() !== '' ? '?' + query.toString() : '');
  const counts = useShellCounts();
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(readOpen);
  const primary = usePrimaryAction();
  const [busy, setBusy] = useState(false);
  const shown = places().filter((p) => allowed(me, p.perm));
  // The place you are in shows its children; you can still fold it while there.
  // Other places keep the open or folded state you gave them.
  const current = shown.find((p) => under(path, p.to))?.module ?? '';
  const [foldedHere, setFoldedHere] = useState('');
  useEffect(() => setFoldedHere(''), [current]);
  const isOpen = (k: string, def: boolean): boolean => (k === current ? foldedHere !== k : (openMap[k] ?? def));
  const toggle = (k: string, def: boolean): void => {
    if (k === current) {
      setFoldedHere((f) => (f === k ? '' : k));
      return;
    }
    setOpenMap((m) => {
      const next = { ...m, [k]: !(m[k] ?? def) };
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* a convenience */
      }
      return next;
    });
  };
  const runPrimary = (): void => {
    if (primary === null) return;
    if (primary.to !== undefined) {
      const [p, q] = primary.to.split('?');
      navigate(p ?? '/', Object.fromEntries(new URLSearchParams(q ?? '')));
      return;
    }
    if (primary.run !== undefined) {
      setBusy(true);
      void Promise.resolve(primary.run()).finally(() => setBusy(false));
    }
  };
  return (
    <nav
      aria-label={t('shell.main')}
      onClick={drawer === true ? (e) => (e.target as HTMLElement).closest('a') !== null && onCloseDrawer?.() : undefined}
      className={cn('flex h-full shrink-0 flex-col bg-[var(--hr-side)] transition-[width] duration-200', drawer === true ? 'w-full' : cn('border-r border-[var(--hr-line)]', collapsed ? 'w-[60px]' : 'w-[232px]'))}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2 px-3.5', collapsed && 'justify-center px-0')}>
        {!collapsed &&
          // The company logo (20px tall) next to the company name; the plain icon and "HR OS" when there is none.
          (me.company.logo !== '' || me.company.logo_dark !== '' ? (
            <>
              <CompanyLogo light={me.company.logo} dark={me.company.logo_dark} height={20} alt="" className="max-w-[96px]" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{me.company.name !== '' ? me.company.name : 'HR OS'}</span>
            </>
          ) : (
            <>
              <Users size={19} strokeWidth={1.9} aria-hidden className="shrink-0 text-[var(--hr-ink)]" />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">HR OS</span>
            </>
          ))}
        {drawer === true ? (
          <button type="button" aria-label={t('shell.close_menu')} onClick={onCloseDrawer} className="hr-focus flex size-9 items-center justify-center rounded-[var(--hr-radius-sm)] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]">
            <X size={18} aria-hidden />
          </button>
        ) : (
          <button type="button" aria-label={collapsed ? t('shell.expand') : t('shell.collapse')} title={collapsed ? t('shell.expand') : t('shell.collapse')} onClick={() => onCollapse(!collapsed)} className="hr-focus flex size-7 items-center justify-center rounded-[var(--hr-radius-sm)] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]">
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        )}
      </div>
      {!collapsed && <EntitySwitch />}

      <div className="hr-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 pb-2">
        {primary !== null && (
          <>
            <NavRow icon={primary.icon} label={primary.short ?? primary.label} title={primary.label} strong collapsed={collapsed} onClick={runPrimary} busy={busy || primary.busy === true} />
            <div className="h-2" />
          </>
        )}
        {shown.map((p) => {
          // Only the place you are in shows its children (Piano Coach); a place you open yourself stays open.
          const def = false;
          return <PlaceRow key={p.module} place={p} collapsed={collapsed} path={path} here={here} open={isOpen(p.module, def)} onToggle={() => toggle(p.module, def)} count={p.module === 'inbox' ? counts.inbox : undefined} />;
        })}
      </div>

      <div className="shrink-0 border-t border-[var(--hr-hair)] px-2 py-2">
        <AgentCard collapsed={collapsed} />
        <NavRow icon={Settings} label={t('nav.settings')} to="/settings" active={under(path, '/settings')} collapsed={collapsed} />
      </div>
    </nav>
  );
}

