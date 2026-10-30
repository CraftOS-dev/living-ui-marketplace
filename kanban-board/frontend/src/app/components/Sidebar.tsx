/**
 * The sidebar, laid out like CraftBot's: the app's name and a collapse
 * button, a highlighted "New card" (like "New Task"), the views, the
 * folding Boards section, and at the foot the agent (its live status and
 * the switch that lets it work) and Settings.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity, ChevronDown, ChevronRight, Eye, Inbox, LayoutGrid, PanelLeftClose, PanelLeftOpen, Plus, Settings, SquareKanban, SquarePen, TrendingUp, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { href } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import { AgentAvatar, Count, Kbd, Toggle } from './ui.tsx';

function NavRow({ icon: Icon, label, to, active, count, countTone, collapsed, onClick, strong }: { icon: LucideIcon; label: string; to?: string; active?: boolean; count?: number; countTone?: 'neutral' | 'accent'; collapsed: boolean; onClick?: () => void; strong?: boolean }): React.JSX.Element {
  const cls = cn(
    'kb-focus group flex h-9 w-full items-center gap-2.5 rounded-[var(--kb-radius-sm)] px-2.5 text-[13.5px] transition-colors',
    active === true ? 'bg-[var(--kb-active)] font-semibold text-[var(--kb-ink)]' : strong === true ? 'bg-[var(--kb-accent)] font-semibold text-[var(--kb-accent-ink)] shadow-[var(--kb-shadow-card)] hover:brightness-[1.06] active:brightness-95' : 'text-[var(--kb-ink)] hover:bg-[var(--kb-hover)]',
    collapsed && 'justify-center px-0',
  );
  const inner = (
    <>
      <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {!collapsed && count !== undefined && <Count n={count} tone={countTone ?? 'neutral'} />}
      {collapsed && count !== undefined && count > 0 && <span aria-hidden className="absolute ml-5 mt-[-14px] size-1.5 rounded-full bg-[var(--kb-accent)]" />}
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

function SectionHead({ icon: Icon, label, open, onToggle, onAdd, addLabel, collapsed }: { icon: LucideIcon; label: string; open: boolean; onToggle: () => void; onAdd: () => void; addLabel: string; collapsed: boolean }): React.JSX.Element | null {
  if (collapsed) return <div className="mx-2 my-2 h-px bg-[var(--kb-hair)]" />;
  return (
    <div className="group flex h-9 items-center gap-1 px-1.5">
      <button type="button" onClick={onToggle} aria-expanded={open} className="kb-focus flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--kb-radius-sm)] px-1 text-[13.5px] text-[var(--kb-ink)] hover:bg-[var(--kb-hover)]">
        {open ? <ChevronDown size={14} aria-hidden className="text-[var(--kb-muted)]" /> : <ChevronRight size={14} aria-hidden className="text-[var(--kb-muted)]" />}
        <Icon size={16} strokeWidth={1.8} aria-hidden />
        <span className="truncate">{label}</span>
      </button>
      <button type="button" aria-label={addLabel} title={addLabel} onClick={onAdd} className="kb-focus flex size-7 items-center justify-center rounded-[var(--kb-radius-sm)] text-[var(--kb-muted)] hover:bg-[var(--kb-hover)] hover:text-[var(--kb-ink)]">
        <Plus size={15} aria-hidden />
      </button>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  working: 'bg-[var(--kb-green)] kb-pulse',
  waiting: 'bg-[var(--kb-amber)]',
  idle: 'bg-[var(--kb-faint)]',
  paused: 'bg-[var(--kb-faint)]',
};

/** One line on what the agent is doing now. */
function agentLine(status: string, working: number, queued: number): string {
  if (status === 'paused') return queued > 0 ? `Paused · ${queued} waiting` : 'Paused';
  if (status === 'working') return `Working on ${working}` + (queued > 0 ? ` · ${queued} queued` : '');
  if (status === 'waiting') return `${queued} card${queued === 1 ? '' : 's'} waiting`;
  return 'Idle';
}

export function Sidebar({ page, boardId, collapsed, onCollapse, onNewBoard, drawer }: { page: Page; boardId: string; collapsed: boolean; onCollapse: (v: boolean) => void; onNewBoard: () => void; drawer?: boolean }): React.JSX.Element {
  const app = useApp();
  const [boardsOpen, setBoardsOpen] = useState(true);
  const paused = app.paused;
  const pause = app.setPaused;
  const status = paused ? 'paused' : (app.agent?.status ?? 'idle');
  const line = agentLine(status, app.agent?.working ?? 0, app.agent?.queued ?? 0);
  return (
    <nav
      aria-label="Main"
      // In the phone drawer, following a link closes the drawer.
      onClick={drawer === true ? (e) => (e.target as HTMLElement).closest('a') !== null && app.setMenu(false) : undefined}
      className={cn('flex h-full shrink-0 flex-col bg-[var(--kb-side)] transition-[width] duration-150', drawer === true ? 'w-full' : cn('border-r border-[var(--kb-line)]', collapsed ? 'w-[60px]' : 'w-[268px]'))}
    >
      <div className={cn('flex h-12 shrink-0 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        {!collapsed && (
          <>
            <SquareKanban size={18} strokeWidth={2} aria-hidden className="text-[var(--kb-accent)]" />
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em]">
              Kanban<span className="text-[var(--kb-accent)]">Board</span>
            </span>
          </>
        )}
        {drawer === true ? (
          <button type="button" aria-label="Close the menu" onClick={() => app.setMenu(false)} className="kb-focus flex size-9 items-center justify-center rounded-[var(--kb-radius-sm)] text-[var(--kb-muted)] hover:bg-[var(--kb-hover)] hover:text-[var(--kb-ink)]">
            <X size={18} aria-hidden />
          </button>
        ) : (
          <button type="button" aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} onClick={() => onCollapse(!collapsed)} className="kb-focus flex size-7 items-center justify-center rounded-[var(--kb-radius-sm)] text-[var(--kb-muted)] hover:bg-[var(--kb-hover)] hover:text-[var(--kb-ink)]">
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        )}
      </div>

      <div className="kb-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2 pb-2">
        <div className="flex flex-col gap-0.5">
          <NavRow icon={SquarePen} label="New card" strong collapsed={collapsed} onClick={() => (app.setMenu(false), app.setCompose({ board: boardId }))} />
          <NavRow icon={Inbox} label="Inbox" to={href('inbox')} active={page === 'inbox'} count={app.needsYou - app.reviews} countTone="accent" collapsed={collapsed} />
          <NavRow icon={Eye} label="Review" to={href('review')} active={page === 'review'} count={app.reviews} countTone="accent" collapsed={collapsed} />
          <NavRow icon={TrendingUp} label="Insights" to={href('insights')} active={page === 'insights'} collapsed={collapsed} />
          <NavRow icon={Activity} label="Activity" to={href('activity')} active={page === 'activity'} collapsed={collapsed} />
        </div>

        <div className="my-2 h-px shrink-0 bg-[var(--kb-hair)]" />
        <SectionHead icon={LayoutGrid} label="Boards" open={boardsOpen} onToggle={() => setBoardsOpen((o) => !o)} onAdd={onNewBoard} addLabel="New board" collapsed={collapsed} />
        {(boardsOpen || collapsed) && (
          <div className="flex flex-col gap-0.5">
            {app.boards.map((b) => {
              const active = page === 'board' && b.id === boardId;
              const working = b.stats?.working ?? 0;
              const needs = b.stats?.needs_you ?? 0;
              return (
                <a
                  key={b.id}
                  href={href('board', { id: b.id })}
                  title={collapsed ? b.name : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={cn('kb-focus flex h-9 items-center gap-2.5 rounded-[var(--kb-radius-sm)] text-[13.5px] transition-colors', collapsed ? 'justify-center' : 'pl-[30px] pr-2', active ? 'bg-[var(--kb-active)] font-semibold' : 'hover:bg-[var(--kb-hover)]')}
                >
                  {collapsed ? (
                    <span className={cn('flex size-7 items-center justify-center rounded-[var(--kb-radius-sm)] text-[11px] font-bold', active ? 'bg-[var(--kb-main)]' : 'bg-[var(--kb-card)]')}>{b.key.slice(0, 2)}</span>
                  ) : (
                    <>
                      <SquareKanban size={14} strokeWidth={1.8} aria-hidden className={cn('shrink-0', b.frozen ? 'text-[var(--kb-blue)]' : 'text-[var(--kb-muted)]')} />
                      <span className="min-w-0 flex-1 truncate">{b.name}</span>
                      {working > 0 && <span title={`The agent is working on ${working} card${working === 1 ? '' : 's'} here`} className="kb-pulse size-1.5 shrink-0 rounded-full bg-[var(--kb-green)]" />}
                      {needs > 0 && <Count n={needs} />}
                    </>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--kb-hair)] px-2 py-2">
        {collapsed ? (
          <button
            type="button"
            aria-label={paused ? 'Resume the agent' : 'Pause the agent'}
            title={`Agent · ${line}. Click to ${paused ? 'resume' : 'pause'} it.`}
            onClick={() => pause(!paused)}
            className="kb-focus relative mx-auto mb-1 flex size-9 items-center justify-center rounded-[var(--kb-radius-sm)] hover:bg-[var(--kb-hover)]"
          >
            <AgentAvatar size={26} paused={paused} />
            <span aria-hidden className={cn('absolute bottom-1 right-1 size-2 rounded-full ring-2 ring-[var(--kb-side)]', STATUS_DOT[status])} />
          </button>
        ) : (
          <div className={cn('mb-1 flex items-center gap-2.5 rounded-[var(--kb-radius)] border px-2.5 py-2 transition-colors', paused ? 'border-[var(--kb-amber-line)] bg-[var(--kb-amber-soft)]' : 'border-[var(--kb-line)] bg-[var(--kb-main)]')}>
            <span className="relative shrink-0">
              <AgentAvatar size={28} paused={paused} />
              <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2', paused ? 'ring-[var(--kb-amber-soft)]' : 'ring-[var(--kb-main)]', STATUS_DOT[status])} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[13.5px] font-semibold">Agent</span>
              <span className={cn('block truncate text-[12px]', paused ? 'text-[var(--kb-amber)]' : 'text-[var(--kb-muted)]')}>{line}</span>
            </span>
            <span title={paused ? 'Resume the agent' : 'Pause the agent'}>
              <Toggle checked={!paused} onChange={(on) => pause(!on)} label="Agent on" />
            </span>
          </div>
        )}
        <NavRow icon={Settings} label="Settings" to={href('settings')} active={page === 'settings'} collapsed={collapsed} />
        {!collapsed && drawer !== true && (
          <div className="mt-1 flex items-center gap-1.5 px-2.5 text-[11.5px] text-[var(--kb-muted)]">
            <Kbd>C</Kbd> new card <span className="mx-1">·</span> <Kbd>/</Kbd> search
          </div>
        )}
      </div>
    </nav>
  );
}
