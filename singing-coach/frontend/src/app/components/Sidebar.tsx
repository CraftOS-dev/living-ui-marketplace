/**
 * The sidebar: the app's mark, "Practice" (today's plan, or where you left
 * off), the places (Today, Learn, Train, Library, Reference, Coach), today's
 * minutes and voice use against the cap, and at the foot the coach with what
 * it is doing and Settings. On the practice screen, in a lesson and in a
 * drill it folds to a rail.
 */
import type { LucideIcon } from 'lucide-react';
import { BookMarked, Sparkle, Dumbbell, Gauge, GraduationCap, Library, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, Play, Settings, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { href } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { Count } from './ui.tsx';

/** The app's mark: the voice dial in miniature, a voice on its note. */
export function Mark({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <path d="M2.5 15.5 A7.5 7.5 0 0 1 17.5 15.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1.5" y1="15.5" x2="18.5" y2="15.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8.6" y1="4.6" x2="8.9" y2="7.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="11.4" y1="4.6" x2="11.1" y2="7.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="8" r="2.4" fill="var(--sc-voice)" />
      <path d="M10 15.5 L10 10.6" stroke="var(--sc-voice)" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

function NavRow({ icon: Icon, label, to, active, count, collapsed, strong, onClick }: { icon: LucideIcon; label: string; to?: string; active?: boolean; count?: number; collapsed: boolean; strong?: boolean; onClick?: () => void }): React.JSX.Element {
  const cls = cn(
    'sc-focus group relative flex h-9 w-full items-center gap-2.5 rounded-[var(--sc-radius-sm)] px-2.5 text-[13.5px] transition-colors',
    strong === true ? 'bg-[var(--sc-ink)] font-semibold text-[var(--sc-page)] hover:brightness-125 dark:hover:brightness-90' : active === true ? 'bg-[var(--sc-active)] font-semibold text-[var(--sc-ink)]' : 'text-[var(--sc-ink)] hover:bg-[var(--sc-hover)]',
    collapsed && 'justify-center px-0',
  );
  const inner = (
    <>
      {active === true && strong !== true && <span aria-hidden className="absolute left-0 top-2 h-5 w-[2px] rounded-full bg-[var(--sc-ink)]" />}
      <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {!collapsed && count !== undefined && <Count n={count} tone="coach" />}
      {collapsed && count !== undefined && count > 0 && <span aria-hidden className="absolute right-2 top-1.5 size-1.5 rounded-full bg-[var(--sc-coach)]" />}
    </>
  );
  if (to !== undefined)
    return (
      <a href={to} title={collapsed ? label : undefined} aria-current={active === true ? 'page' : undefined} className={cls}>
        {inner}
      </a>
    );
  return (
    <button type="button" title={collapsed ? label : undefined} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function Sidebar({ page, collapsed, onCollapse, onPractice, drawer }: { page: Page; collapsed: boolean; onCollapse: (v: boolean) => void; onPractice: () => void; drawer?: boolean }): React.JSX.Element {
  const app = useApp();
  const st = app.state;
  const pending = st?.pending ?? 0;
  const working = pending > 0 && st?.agent_active === true;
  const line = working ? 'Working on your request' : pending > 0 ? `${pending} waiting for CraftBot` : (st?.new_songs ?? 0) > 0 ? `${st?.new_songs} new song${st?.new_songs === 1 ? '' : 's'} for you` : 'Ready';
  const goal = st?.today.goal ?? 20;
  const mins = st?.today.minutes ?? 0;
  const voiced = st?.today.voiced ?? 0;
  const cap = st?.today.cap ?? 20;
  return (
    <nav
      aria-label="Main"
      onClick={drawer === true ? (e) => (e.target as HTMLElement).closest('a') !== null && app.setMenu(false) : undefined}
      className={cn('flex h-full shrink-0 flex-col bg-[var(--sc-side)] transition-[width] duration-200', drawer === true ? 'w-full' : cn('border-r border-[var(--sc-line)]', collapsed ? 'w-[60px]' : 'w-[232px]'))}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2 px-3.5', collapsed && 'justify-center px-0')}>
        {!collapsed && (
          <>
            <span className="text-[var(--sc-ink)]">
              <Mark />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-[-0.01em]">Singing Coach</span>
          </>
        )}
        {drawer === true ? (
          <button type="button" aria-label="Close the menu" onClick={() => app.setMenu(false)} className="sc-focus flex size-9 items-center justify-center rounded-[var(--sc-radius-sm)] text-[var(--sc-muted)] hover:bg-[var(--sc-hover)] hover:text-[var(--sc-ink)]">
            <X size={18} aria-hidden />
          </button>
        ) : (
          <button type="button" aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} title={collapsed ? 'Expand' : 'Collapse'} onClick={() => onCollapse(!collapsed)} className="sc-focus flex size-7 items-center justify-center rounded-[var(--sc-radius-sm)] text-[var(--sc-muted)] hover:bg-[var(--sc-hover)] hover:text-[var(--sc-ink)]">
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        )}
      </div>

      <div className="sc-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 pb-2">
        <NavRow icon={Play} label="Practice" strong active={page === 'practice'} collapsed={collapsed} onClick={onPractice} />
        <div className="h-2" />
        <NavRow icon={Gauge} label="Today" to={href('today')} active={page === 'today'} collapsed={collapsed} />
        <NavRow icon={GraduationCap} label="Learn" to={href('learn')} active={page === 'learn'} collapsed={collapsed} />
        <NavRow icon={Dumbbell} label="Train" to={href('train')} active={page === 'train'} collapsed={collapsed} />
        <NavRow icon={Library} label="Library" to={href('library')} active={page === 'library'} collapsed={collapsed} count={st?.new_songs ?? 0} />
        <NavRow icon={BookMarked} label="Reference" to={href('reference')} active={page === 'reference'} collapsed={collapsed} />
        <NavRow icon={MessageSquare} label="Coach" to={href('coach')} active={page === 'coach'} collapsed={collapsed} count={app.unread} />

        {!collapsed && st !== null && (
          <div className="mt-4 flex flex-col gap-3 px-2.5">
            <div>
              <div className="sc-label mb-1.5 flex items-center justify-between">
                <span>Today</span>
                <span className="sc-num">
                  {Math.round(mins)}/{goal} min
                </span>
              </div>
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--sc-line)]">
                <div className="h-full rounded-full bg-[var(--sc-ink)] transition-[width] duration-700" style={{ width: `${Math.min(100, (mins / Math.max(1, goal)) * 100)}%` }} />
              </div>
            </div>
            <div title="Minutes your voice sounded today, against your session cap">
              <div className="sc-label mb-1.5 flex items-center justify-between">
                <span>Voice</span>
                <span className="sc-num">
                  {Math.round(voiced)}/{cap} min
                </span>
              </div>
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--sc-line)]">
                <div className={cn('h-full rounded-full transition-[width] duration-700', voiced >= cap ? 'bg-[var(--sc-warn)]' : 'bg-[var(--sc-voice)]')} style={{ width: `${Math.min(100, (voiced / Math.max(1, cap)) * 100)}%` }} />
              </div>
            </div>
            {(st.health.rest || st.health.light) && (
              <div className="flex items-center gap-2 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] px-2 py-1.5 text-[12px] text-[var(--sc-ink-2)]">
                <Moon size={13} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--sc-muted)]" />
                <span className="truncate">{st.health.rest ? 'Rest day for the voice' : 'A light day today'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--sc-hair)] px-2 py-2">
        <a href={href('coach')} title={collapsed ? `Coach · ${line}` : undefined} className={cn('sc-focus mb-1 flex items-center gap-2.5 rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-panel)] transition-colors hover:bg-[var(--sc-hover)]', collapsed ? 'mx-auto size-10 justify-center border-0 bg-transparent' : 'px-2.5 py-2')}>
          <span className="relative shrink-0">
            <span className="flex size-7 items-center justify-center rounded-[8px] bg-[var(--sc-coach)] text-[var(--sc-coach-ink)]">
              <Sparkle size={16} strokeWidth={2} aria-hidden />
            </span>
            <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--sc-panel)]', working ? 'sc-pulse bg-[var(--sc-good)]' : pending > 0 ? 'bg-[var(--sc-warn)]' : 'bg-[var(--sc-faint)]')} />
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[13px] font-semibold">Coach</span>
              <span className="block truncate text-[11.5px] text-[var(--sc-muted)]">{line}</span>
            </span>
          )}
        </a>
        <NavRow icon={Settings} label="Settings" to={href('settings')} active={page === 'settings'} collapsed={collapsed} />
      </div>
    </nav>
  );
}
