/**
 * The sidebar, laid out like CraftBot's: the app's name and a collapse
 * button, a highlighted "New card" (like "New Task"), the views (with what
 * needs you), the folding Boards section, then the team's agents (each
 * one's live status and its own switch, plus the brake that pauses them
 * all) and, at the foot, you: your settings, the team and signing out.
 */
import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity, Bot, ChevronDown, ChevronRight, Eye, Inbox, LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Settings, SquareKanban, SquarePen, TrendingUp, Users, X } from 'lucide-react';
import { cn, useAuth } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { href, navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { Agent } from '../lib/types.ts';
import { AgentAvatar, Count, Kbd, MenuItem, MenuSep, PersonAvatar, Popover, Toggle } from './ui.tsx';

function NavRow({ icon: Icon, label, to, active, count, countTone, collapsed, onClick, strong }: { icon: LucideIcon; label: string; to?: string; active?: boolean; count?: number | undefined; countTone?: 'neutral' | 'accent'; collapsed: boolean; onClick?: () => void; strong?: boolean }): React.JSX.Element {
  const cls = cn(
    'kb-focus group relative flex h-9 w-full items-center gap-2.5 rounded-[var(--kb-radius-sm)] px-2.5 text-[13.5px] transition-colors',
    active === true ? 'bg-[var(--kb-active)] font-semibold text-[var(--kb-ink)]' : strong === true ? 'bg-[var(--kb-accent)] font-semibold text-[var(--kb-accent-ink)] shadow-[var(--kb-shadow-card)] hover:brightness-[1.06] active:brightness-95' : 'text-[var(--kb-ink)] hover:bg-[var(--kb-hover)]',
    collapsed && 'justify-center px-0',
  );
  const inner = (
    <>
      <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {!collapsed && count !== undefined && <Count n={count} tone={countTone ?? 'neutral'} />}
      {collapsed && count !== undefined && count > 0 && <span aria-hidden className="absolute right-2 top-1.5 size-1.5 rounded-full bg-[var(--kb-accent)]" />}
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

function SectionHead({ icon: Icon, label, open, onToggle, onAdd, addLabel, collapsed, aside }: { icon: LucideIcon; label: string; open: boolean; onToggle: () => void; onAdd?: () => void; addLabel?: string; collapsed: boolean; aside?: React.ReactNode }): React.JSX.Element | null {
  if (collapsed) return <div className="mx-2 my-2 h-px bg-[var(--kb-hair)]" />;
  return (
    <div className="group flex h-9 items-center gap-1 px-1.5">
      <button type="button" onClick={onToggle} aria-expanded={open} className="kb-focus flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--kb-radius-sm)] px-1 text-[13.5px] text-[var(--kb-ink)] hover:bg-[var(--kb-hover)]">
        {open ? <ChevronDown size={14} aria-hidden className="text-[var(--kb-muted)]" /> : <ChevronRight size={14} aria-hidden className="text-[var(--kb-muted)]" />}
        <Icon size={16} strokeWidth={1.8} aria-hidden />
        <span className="truncate">{label}</span>
      </button>
      {aside}
      {onAdd !== undefined && (
        <button type="button" aria-label={addLabel} title={addLabel} onClick={onAdd} className="kb-focus flex size-7 items-center justify-center rounded-[var(--kb-radius-sm)] text-[var(--kb-muted)] hover:bg-[var(--kb-hover)] hover:text-[var(--kb-ink)]">
          <Plus size={15} aria-hidden />
        </button>
      )}
    </div>
  );
}

export const STATUS_DOT: Record<string, string> = {
  working: 'bg-[var(--kb-green)] kb-pulse',
  waiting: 'bg-[var(--kb-amber)]',
  idle: 'bg-[var(--kb-faint)]',
  paused: 'bg-[var(--kb-faint)]',
  removed: 'bg-[var(--kb-faint)]',
};

/** One line on what an agent is doing now. */
export function agentLine(a: Agent): string {
  const { status, working, queued } = a;
  if (status === 'paused') return a.team_paused && !a.paused ? 'Paused with every agent' : queued > 0 ? `Paused · ${queued} waiting` : 'Paused';
  if (status === 'working') return `Working on ${working}` + (queued > 0 ? ` · ${queued} queued` : '');
  if (status === 'waiting') return `${queued} card${queued === 1 ? '' : 's'} waiting`;
  return a.online ? 'Idle' : 'Idle · not connected';
}

const SHOWN_AGENTS = 4;

export function Sidebar({ page, boardId, collapsed, onCollapse, onNewBoard, drawer }: { page: Page; boardId: string; collapsed: boolean; onCollapse: (v: boolean) => void; onNewBoard: () => void; drawer?: boolean }): React.JSX.Element {
  const app = useApp();
  const { logout } = useAuth();
  const [boardsOpen, setBoardsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [meOpen, setMeOpen] = useState(false);
  const meBtn = useRef<HTMLButtonElement | null>(null);
  const agents = app.agents;
  const online = app.people.filter((p) => p.online && p.id !== app.me?.id);
  const me = app.me;
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
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em]" title={app.settings?.name}>
              Kanban<span className="text-[var(--kb-accent)]">Online</span>
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
          <NavRow icon={Inbox} label="Inbox" to={href('inbox')} active={page === 'inbox'} count={app.needsYou} countTone="accent" collapsed={collapsed} />
          <NavRow icon={Eye} label="Review" to={href('review')} active={page === 'review'} count={app.reviews} countTone="accent" collapsed={collapsed} />
          <NavRow icon={TrendingUp} label="Insights" to={href('insights')} active={page === 'insights'} collapsed={collapsed} />
          <NavRow icon={Activity} label="Activity" to={href('activity')} active={page === 'activity'} collapsed={collapsed} />
          <NavRow icon={Users} label="Team" to={href('team')} active={page === 'team'} count={app.admin ? app.pendingPeople : undefined} countTone="accent" collapsed={collapsed} />
        </div>

        <div className="my-2 h-px shrink-0 bg-[var(--kb-hair)]" />
        <SectionHead icon={LayoutGrid} label="Boards" open={boardsOpen} onToggle={() => setBoardsOpen((o) => !o)} onAdd={onNewBoard} addLabel="New board" collapsed={collapsed} />
        {(boardsOpen || collapsed) && (
          <div className="flex flex-col gap-0.5">
            {app.boards.map((b) => {
              const active = page === 'board' && b.id === boardId;
              const working = b.stats?.working ?? 0;
              const needs = b.stats?.needs_people ?? 0;
              const viewers = online.filter((p) => p.where?.board === b.id);
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
                      {viewers.length > 0 && (
                        <span className="flex -space-x-1" title={viewers.map((p) => p.name).join(', ') + ' here now'}>
                          {viewers.slice(0, 2).map((p) => (
                            <PersonAvatar key={p.id} person={p} size={16} ring />
                          ))}
                        </span>
                      )}
                      {working > 0 && <span title={`${working} card${working === 1 ? '' : 's'} being worked by agents here`} className="kb-pulse size-1.5 shrink-0 rounded-full bg-[var(--kb-green)]" />}
                      {needs > 0 && <Count n={needs} />}
                    </>
                  )}
                </a>
              );
            })}
          </div>
        )}

        <div className="my-2 h-px shrink-0 bg-[var(--kb-hair)]" />
        <SectionHead
          icon={Bot}
          label="Agents"
          open={agentsOpen}
          onToggle={() => setAgentsOpen((o) => !o)}
          collapsed={collapsed}
          aside={
            <span title={app.paused ? 'Every agent is paused: switch on to let them work' : 'Pause every agent at once'} className="flex items-center gap-1.5 pr-1 text-[11.5px] text-[var(--kb-muted)]">
              {app.paused ? 'All paused' : 'All on'}
              <Toggle checked={!app.paused} onChange={(on) => app.setPaused(!on)} label="Agents on" />
            </span>
          }
        />
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            {agents.slice(0, SHOWN_AGENTS).map((a) => (
              <button key={a.id} type="button" aria-label={`${a.name}: ${agentLine(a)}`} title={`${a.name} · ${agentLine(a)}. Click to ${a.paused ? 'resume' : 'pause'} it.`} onClick={() => app.pauseAgent(a, !a.paused)} className="kb-focus flex size-9 items-center justify-center rounded-[var(--kb-radius-sm)] hover:bg-[var(--kb-hover)]">
                <AgentAvatar agent={a} size={26} paused={a.status === 'paused'} dot={STATUS_DOT[a.status]} />
              </button>
            ))}
          </div>
        ) : (
          agentsOpen && (
            <div className={cn('flex flex-col gap-0.5 rounded-[var(--kb-radius)] transition-colors', app.paused && 'bg-[var(--kb-amber-soft)] ring-1 ring-inset ring-[var(--kb-amber-line)]')}>
              {agents.length === 0 && <p className="px-2.5 py-2 text-[12px] leading-4 text-[var(--kb-muted)]">No agent has connected yet. CraftBot and other agents join the first time they call through the agent-app CLI.</p>}
              {agents.slice(0, SHOWN_AGENTS).map((a) => (
                <div key={a.id} className="flex h-11 items-center gap-2.5 rounded-[var(--kb-radius-sm)] px-2 hover:bg-[var(--kb-hover)]">
                  <AgentAvatar agent={a} size={26} paused={a.status === 'paused'} dot={STATUS_DOT[a.status]} />
                  <a href={href('team', { agent: a.id })} className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-semibold">{a.name}</span>
                    <span className={cn('block truncate text-[11.5px]', a.status === 'paused' ? 'text-[var(--kb-amber)]' : 'text-[var(--kb-muted)]')}>{agentLine(a)}</span>
                  </a>
                  <span title={a.paused ? `Resume ${a.name}` : `Pause ${a.name}`}>
                    <Toggle checked={!a.paused} onChange={(on) => app.pauseAgent(a, !on)} label={`${a.name} on`} disabled={app.paused} />
                  </span>
                </div>
              ))}
              {agents.length > SHOWN_AGENTS && (
                <a href={href('team')} className="kb-focus flex h-8 items-center rounded-[var(--kb-radius-sm)] px-2.5 text-[12.5px] text-[var(--kb-muted)] hover:bg-[var(--kb-hover)] hover:text-[var(--kb-ink)]">
                  {agents.length - SHOWN_AGENTS} more on the Team page
                </a>
              )}
            </div>
          )
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--kb-hair)] px-2 py-2">
        <button
          ref={meBtn}
          type="button"
          aria-label="Your account"
          aria-expanded={meOpen}
          onClick={() => setMeOpen((o) => !o)}
          className={cn('kb-focus flex h-11 w-full items-center gap-2.5 rounded-[var(--kb-radius-sm)] px-2 text-left hover:bg-[var(--kb-hover)]', collapsed && 'justify-center px-0', (page === 'settings' || meOpen) && 'bg-[var(--kb-active)]')}
        >
          <PersonAvatar person={me} size={28} />
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold">{me?.name ?? 'You'}</span>
              <span className="block truncate text-[11.5px] text-[var(--kb-muted)]">
                {me?.role === 'admin' ? 'Admin' : 'Member'} · {app.settings?.name ?? 'Our team'}
              </span>
            </span>
          )}
          {!collapsed && online.length > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-[var(--kb-muted)]" title={online.map((p) => p.name).join(', ') + ' online'}>
              <span className="size-1.5 rounded-full bg-[var(--kb-green)]" />
              {online.length}
            </span>
          )}
        </button>
        <Popover anchor={meBtn} open={meOpen} onClose={() => setMeOpen(false)} side={collapsed ? 'right' : 'bottom'} width={240}>
          <div className="px-2 pb-1.5 pt-1.5">
            <div className="truncate text-[13px] font-semibold">{me?.name}</div>
            <div className="truncate text-[12px] text-[var(--kb-muted)]">{me?.email}</div>
          </div>
          <MenuSep />
          <MenuItem icon={Settings} onClick={() => (setMeOpen(false), app.setMenu(false), navigate('settings'))}>
            Settings
          </MenuItem>
          <MenuItem icon={Users} onClick={() => (setMeOpen(false), app.setMenu(false), navigate('team'))} hint={app.admin && app.pendingPeople > 0 ? `${app.pendingPeople} waiting` : undefined}>
            Team
          </MenuItem>
          <MenuSep />
          <MenuItem icon={LogOut} onClick={() => (setMeOpen(false), logout())}>
            Sign out
          </MenuItem>
        </Popover>
        {!collapsed && drawer !== true && (
          <div className="mt-1 flex items-center gap-1.5 px-2.5 text-[11.5px] text-[var(--kb-muted)]">
            <Kbd>C</Kbd> new card <span className="mx-1">·</span> <Kbd>/</Kbd> search
          </div>
        )}
      </div>
    </nav>
  );
}
