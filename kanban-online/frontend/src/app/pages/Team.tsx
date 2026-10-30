/**
 * Team: the people and the agents who share these boards.
 *
 * People: who is online and where, each member's open cards and role.
 * Admins let new accounts in (or decline them), suspend and restore members
 * and choose who else is an admin.
 *
 * Agents: each one live (working on what, how much waits for it, its limit,
 * when it was last seen) with its report card for the week. Anyone pauses
 * an agent; admins rename it, set its limit, remove it or bring it back.
 * How another agent joins is shown right there.
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Clock, MoreHorizontal, RotateCcw, ShieldCheck, Terminal, Trash2, UserCheck, UserX, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { STATUS_DOT, agentLine } from '../components/Sidebar.tsx';
import { AgentAvatar, Button, Chip, Count, EditableText, Empty, IconButton, MenuButton, MenuItem, MenuSep, PersonAvatar, Popover, Section, Select, Spinner, Tabs, Toggle, errMessage, useConfirm } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, pct } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href, setQuery, useRoute } from '../lib/router.ts';
import type { Agent, Person } from '../lib/types.ts';

type Tab = 'people' | 'agents';

const VIEW: Record<string, string> = { board: 'on', card: 'on a card on', inbox: 'in the inbox', review: 'reviewing', insights: 'in insights', activity: 'in the activity', team: 'on the team page', settings: 'in settings' };

export function TeamPage(): React.JSX.Element {
  const app = useApp();
  const { query } = useRoute();
  const focusAgent = query.get('agent') ?? '';
  const [tab, setTab] = useState<Tab>(focusAgent !== '' ? 'agents' : 'people');
  useEffect(() => {
    if (focusAgent !== '') setTab('agents');
  }, [focusAgent]);
  useEffect(() => {
    void api.reportUi({ view: 'team' }).catch(() => undefined);
  }, []);
  const people = useLive(() => api.people(), ['users', 'cards'], [], 300, 1500);
  const agents = useLive(() => api.agents(7, app.admin), ['agents', 'cards', 'runs'], [app.admin], 400, 2000);
  const list = people.data?.people ?? [];
  const pending = list.filter((p) => p.status === 'pending');
  const active = list.filter((p) => p.status === 'active');
  const suspended = list.filter((p) => p.status === 'suspended');
  const all = agents.data?.agents ?? [];
  const current = all.filter((a) => !a.removed);
  const removed = all.filter((a) => a.removed);
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kb-hair)] px-3 md:gap-3 md:px-6">
        <MenuButton />
        <h1 className="text-[15px] font-semibold">Team</h1>
        <span className="hidden truncate text-[13px] text-[var(--kb-muted)] sm:inline">{app.settings?.name}</span>
      </header>
      <div className="px-3 md:px-6">
        <Tabs<Tab>
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (focusAgent !== '') setQuery('team', {});
          }}
          options={[
            { value: 'people', label: <span className="inline-flex items-center gap-1.5">People <span className="kb-num text-[var(--kb-muted)]">{active.length}</span> {app.admin && <Count n={pending.length} tone="accent" />}</span> },
            { value: 'agents', label: <span className="inline-flex items-center gap-1.5">Agents <span className="kb-num text-[var(--kb-muted)]">{current.length}</span></span> },
          ]}
        />
      </div>
      <div className="kb-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[920px] flex-col gap-7 px-3 py-4 md:px-6 md:py-5">
          {tab === 'people' ? (
            people.data === null ? (
              <Loading />
            ) : (
              <>
                {app.admin && pending.length > 0 && (
                  <Section title={`Waiting to join · ${pending.length}`}>
                    <div className="flex flex-col gap-2">
                      {pending.map((p) => (
                        <PendingRow key={p.id} p={p} onDone={people.reload} />
                      ))}
                    </div>
                  </Section>
                )}
                <Section title={`Members · ${active.length}`} aside={<JoiningNote />}>
                  <div className="flex flex-col">
                    {active.map((p) => (
                      <PersonRow key={p.id} p={p} onDone={people.reload} />
                    ))}
                  </div>
                </Section>
                {app.admin && suspended.length > 0 && (
                  <Section title={`Suspended · ${suspended.length}`}>
                    <div className="flex flex-col">
                      {suspended.map((p) => (
                        <PersonRow key={p.id} p={p} onDone={people.reload} />
                      ))}
                    </div>
                  </Section>
                )}
              </>
            )
          ) : agents.data === null ? (
            <Loading />
          ) : (
            <>
              {current.length === 0 ? (
                <Empty icon={Bot} title="No agent has connected yet">
                  Agents join the first time they call this app through the agent-app CLI. CraftBot is woken by the board when work waits for it.
                </Empty>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {current.map((a) => (
                    <AgentPanel key={a.id} a={a} focused={a.id === focusAgent} onDone={agents.reload} />
                  ))}
                </div>
              )}
              <Connect />
              {app.admin && removed.length > 0 && (
                <Section title={`Removed · ${removed.length}`}>
                  <div className="flex flex-col">
                    {removed.map((a) => (
                      <div key={a.id} className="flex min-h-11 items-center gap-3 rounded-[var(--kb-radius-sm)] px-2 hover:bg-[var(--kb-main-hover)]">
                        <AgentAvatar agent={a} size={24} paused />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{a.name}</div>
                          <div className="truncate text-[12px] text-[var(--kb-muted)]">{a.handle} · its calls are refused</div>
                        </div>
                        <Button size="sm" icon={RotateCcw} onClick={() => void api.updateAgent(a.id, { restore: true }).then(() => (toast.success(`${a.name} is back on the team`), agents.reload())).catch((err: unknown) => toast.error(errMessage(err)))}>
                          Bring back
                        </Button>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Loading(): React.JSX.Element {
  return (
    <div className="flex h-40 items-center justify-center text-[var(--kb-muted)]">
      <Spinner size={18} />
    </div>
  );
}

function JoiningNote(): React.JSX.Element | null {
  const app = useApp();
  if (app.settings === null) return null;
  return <span className="text-[12px] text-[var(--kb-muted)]">{app.settings.joining === 'open' ? 'New accounts join at once' : 'An admin lets people from shared links in'}</span>;
}

/* ---------------------------------------------------------------- people */

function PendingRow({ p, onDone }: { p: Person; onDone: () => void }): React.JSX.Element {
  const app = useApp();
  const [busy, setBusy] = useState<'' | 'in' | 'out'>('');
  const set = (status: 'active' | 'suspended'): void => {
    setBusy(status === 'active' ? 'in' : 'out');
    api
      .updatePerson(p.id, { status })
      .then(() => {
        toast.success(status === 'active' ? `${p.name} is in` : `${p.name} was declined`);
        onDone();
        app.reload();
      })
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setBusy(''));
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--kb-radius)] border border-[var(--kb-amber-line)] bg-[var(--kb-amber-soft)] px-3 py-2.5">
      <PersonAvatar person={p} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{p.name}</div>
        <div className="truncate text-[12px] text-[var(--kb-ink-2)]">
          {p.email} · asked {ago(p.joined)}
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={UserCheck} busy={busy === 'in'} onClick={() => set('active')}>
          Let in
        </Button>
        <Button size="sm" variant="ghost" icon={UserX} busy={busy === 'out'} onClick={() => set('suspended')}>
          Decline
        </Button>
      </div>
    </div>
  );
}

function PersonRow({ p, onDone }: { p: Person; onDone: () => void }): React.JSX.Element {
  const app = useApp();
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const me = p.id === app.me?.id;
  const board = p.where?.board ? app.boards.find((b) => b.id === p.where?.board) : undefined;
  const where = p.online && p.where !== null ? `${VIEW[p.where.view] ?? 'in'}${board !== undefined && (p.where.view === 'board' || p.where.view === 'card') ? ` ${board.name}` : ''}` : p.last_active !== '' ? `active ${ago(p.last_active)}` : `joined ${ago(p.joined)}`;
  const change = (patch: { status?: 'active' | 'suspended'; role?: 'admin' | 'member' }, msg: string): void => {
    setMenu(false);
    api
      .updatePerson(p.id, patch)
      .then(() => {
        toast.success(msg);
        onDone();
        app.reload();
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-[var(--kb-radius-sm)] px-2 py-1.5 hover:bg-[var(--kb-main-hover)]">
      <PersonAvatar person={p} size={30} online={p.online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-[13px] font-semibold', p.status === 'suspended' && 'text-[var(--kb-muted)] line-through')}>{p.name}</span>
          {me && <span className="text-[12px] text-[var(--kb-muted)]">you</span>}
          {p.role === 'admin' && (
            <Chip tone="neutral" icon={ShieldCheck}>
              Admin
            </Chip>
          )}
        </div>
        <div className="truncate text-[12px] text-[var(--kb-muted)]">
          {p.email} · <span className={cn(p.online && 'text-[var(--kb-green)]')}>{p.online ? 'online ' : ''}</span>
          {where}
        </div>
      </div>
      {p.open_cards > 0 && (
        <span className="kb-num hidden shrink-0 text-[12px] text-[var(--kb-ink-2)] sm:inline" title="Open cards assigned to them">
          {p.open_cards} open card{p.open_cards === 1 ? '' : 's'}
        </span>
      )}
      {app.admin && !me && (
        <>
          <IconButton ref={btn} icon={MoreHorizontal} label={`Change ${p.name}`} onClick={() => setMenu((m) => !m)} />
          <Popover anchor={btn} open={menu} onClose={() => setMenu(false)} align="end" width={210}>
            {p.status === 'suspended' ? (
              <MenuItem icon={RotateCcw} onClick={() => change({ status: 'active' }, `${p.name} is back`)}>
                Restore
              </MenuItem>
            ) : (
              <>
                {p.role === 'admin' ? (
                  <MenuItem icon={Users} onClick={() => change({ role: 'member' }, `${p.name} is now a member`)}>
                    Make a member
                  </MenuItem>
                ) : (
                  <MenuItem icon={ShieldCheck} onClick={() => change({ role: 'admin' }, `${p.name} is now an admin`)}>
                    Make an admin
                  </MenuItem>
                )}
                <MenuSep />
                <MenuItem icon={UserX} danger onClick={() => change({ status: 'suspended' }, `${p.name} is suspended`)}>
                  Suspend
                </MenuItem>
              </>
            )}
          </Popover>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- agents */

function AgentPanel({ a, focused, onDone }: { a: Agent; focused: boolean; onDone: () => void }): React.JSX.Element {
  const app = useApp();
  const ref = useRef<HTMLElement | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const live = app.agents.find((x) => x.id === a.id);
  const paused = live?.paused ?? a.paused;
  const status = live?.status ?? a.status;
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);
  const save = (p: Parameters<typeof api.updateAgent>[1], msg?: string): void => {
    api
      .updateAgent(a.id, p)
      .then(() => {
        if (msg !== undefined) toast.success(msg);
        onDone();
        app.reload();
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const st = a.stats;
  return (
    <section ref={ref} aria-label={a.name} className={cn('flex flex-col gap-3 rounded-[var(--kb-radius-lg)] border bg-[var(--kb-card)] p-4 transition-shadow', focused ? 'border-[var(--kb-accent)] shadow-[0_0_0_3px_var(--kb-accent-soft)]' : 'border-[var(--kb-hair)]')}>
      <div className="flex items-start gap-3">
        <AgentAvatar agent={{ ...a, paused }} size={36} paused={status === 'paused'} dot={STATUS_DOT[status]} />
        <div className="min-w-0 flex-1">
          {app.admin ? (
            <EditableText label={`${a.name}'s name`} value={a.name} onSave={(v) => v.trim() !== '' && save({ name: v.trim() })} className="-ml-1 h-7 border-transparent bg-transparent px-1 text-[14px] font-semibold hover:border-[var(--kb-line)]" />
          ) : (
            <div className="truncate text-[14px] font-semibold">{a.name}</div>
          )}
          <div className="truncate text-[12px] text-[var(--kb-muted)]">
            {a.handle}
            {a.craftbot ? ' · CraftBot' : ''} · {a.online ? <span className="text-[var(--kb-green)]">connected</span> : a.last_seen !== '' ? `seen ${ago(a.last_seen)}` : 'not seen yet'}
          </div>
        </div>
        <span title={paused ? `Resume ${a.name}` : `Pause ${a.name}`} className="pt-1">
          <Toggle checked={!paused} onChange={(on) => app.pauseAgent(a, !on)} label={`${a.name} on`} disabled={app.paused} />
        </span>
      </div>
      <div className={cn('text-[12.5px]', status === 'paused' ? 'text-[var(--kb-amber)]' : 'text-[var(--kb-ink-2)]')}>{live !== undefined ? agentLine(live) : agentLine(a)}</div>
      {a.working_on.length > 0 && (
        <div className="flex flex-col gap-1">
          {a.working_on.map((c) => (
            <button key={c.id} type="button" onClick={() => app.setOpenCard(c.id)} className="kb-focus flex min-w-0 items-center gap-2 rounded-[var(--kb-radius-sm)] bg-[var(--kb-main)] px-2 py-1.5 text-left text-[12.5px] ring-1 ring-inset ring-[var(--kb-hair)] hover:ring-[var(--kb-line)]">
              <span aria-hidden className="kb-pulse size-1.5 shrink-0 rounded-full bg-[var(--kb-green)]" />
              <span className="kb-num shrink-0 font-medium text-[var(--kb-muted)]">{c.key}</span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              {c.progress !== '' && <span className="hidden max-w-[40%] truncate text-[var(--kb-muted)] sm:inline">{c.progress}</span>}
            </button>
          ))}
        </div>
      )}
      {st !== undefined && (
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-[var(--kb-radius)] bg-[var(--kb-hair)] ring-1 ring-[var(--kb-hair)]">
          {[
            { label: 'Runs', value: String(st.runs) },
            { label: 'Approved', value: pct(st.approval_rate) },
            { label: 'First pass', value: pct(st.first_pass_rate) },
            { label: 'Failed', value: String(st.failed + st.expired) },
          ].map((c) => (
            <div key={c.label} className="flex flex-col bg-[var(--kb-main)] px-2.5 py-2">
              <span className="text-[11px] text-[var(--kb-muted)]">{c.label}</span>
              <span className="kb-num text-[15px] font-semibold">{c.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--kb-hair)] pt-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--kb-muted)]">
          <Clock size={12} aria-hidden /> Cards at once
        </span>
        {app.admin ? (
          <Select aria-label={`${a.name}: cards at once`} value={String(a.own_limit)} onChange={(e) => save({ max_working: Number(e.target.value) }, 'Limit saved')} className="w-auto min-w-[140px]">
            <option value="0">Workspace default ({app.settings?.max_working ?? 2})</option>
            {[1, 2, 3, 4, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        ) : (
          <span className="kb-num text-[12.5px] font-medium">{a.max_working}</span>
        )}
        <span className="flex-1" />
        <a href={href('activity', { who: 'agent:' + a.id })} className="text-[12.5px] font-medium text-[var(--kb-ink-2)] hover:text-[var(--kb-ink)] hover:underline">
          Its activity
        </a>
        {app.admin && (
          <IconButton
            icon={Trash2}
            tone="danger"
            label={`Remove ${a.name}`}
            onClick={() =>
              void (async () => {
                if (!(await confirm(`${a.name} leaves the team: its calls are refused, cards it works or holds go back to any agent, and columns it worked are handed to any agent. You can bring it back later.`, `Remove ${a.name}?`, 'Remove'))) return;
                api
                  .removeAgent(a.id)
                  .then((r) => {
                    toast.success(`${a.name} was removed${r.cards > 0 ? `; ${r.cards} card${r.cards === 1 ? '' : 's'} went back to the team` : ''}`);
                    onDone();
                    app.reload();
                  })
                  .catch((err: unknown) => toast.error(errMessage(err)));
              })()
            }
          />
        )}
      </div>
      {confirmEl}
    </section>
  );
}

function Connect(): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--kb-radius-lg)] border border-dashed border-[var(--kb-line)] px-4 py-3.5">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <Terminal size={15} aria-hidden className="text-[var(--kb-muted)]" /> Add an agent
      </div>
      <p className="text-[12.5px] leading-5 text-[var(--kb-ink-2)]">
        Any agent that runs the agent-app CLI on this app joins under the name it sends. Give each one its own name, and it shows up here the first time it calls, with its own queue, limit and pause switch.
      </p>
      <code className="kb-scroll block overflow-x-auto whitespace-pre rounded-[var(--kb-radius-sm)] bg-[var(--kb-main)] px-3 py-2 font-mono text-[12px] text-[var(--kb-ink)] ring-1 ring-inset ring-[var(--kb-hair)]">{`A2APP_AGENT=researcher agent-app run <project> app.guide\nA2APP_AGENT=researcher agent-app run <project> work.next`}</code>
      <p className="inline-flex items-center gap-1.5 text-[12px] text-[var(--kb-muted)]">
        <Check size={12} aria-hidden /> Point a column at it (column settings, One agent) or assign it cards.
      </p>
    </section>
  );
}
