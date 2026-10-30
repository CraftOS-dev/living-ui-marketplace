/**
 * Activity: every change on every board, newest first, attributed to you,
 * the agent, a rule or the board itself, with the agent's own words where it
 * gave them. Any change to a card can be reverted from here.
 */
import { useEffect, useMemo, useState } from 'react';
import { History, Undo2, Zap } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AgentAvatar, Button, Empty, MenuButton, Segmented, Select, Spinner, YouAvatar, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { day, time } from '../lib/format.ts';
import { listen } from '../lib/live.ts';
import type { EventRec } from '../lib/types.ts';

type Who = 'all' | 'you' | 'agent' | 'rule';

const VERB: Record<string, string> = {
  created: 'created',
  proposed: 'proposed',
  accepted: 'accepted',
  moved: 'moved',
  assigned: 'reassigned',
  updated: 'changed',
  comment: 'commented on',
  check: 'ticked',
  blocked: 'flagged blocked',
  unblocked: 'unblocked',
  archived: 'archived',
  restored: 'restored',
  deleted: 'deleted',
  claimed: 'started',
  action: 'worked on',
  thought: 'thought about',
  note: 'noted on',
  result: 'reported on',
  plan: 'planned',
  question: 'asked about',
  answer: 'answered on',
  submitted: 'submitted',
  recommended: 'reviewed',
  approved: 'approved',
  changes_requested: 'requested changes on',
  rejected: 'rejected',
  returned: 'handed back',
  failed: 'failed on',
  released: 'released',
  expired: 'timed out on',
  stopped: 'stopped the agent on',
  retried: 'retried',
  plan_approved: 'approved the plan of',
  rule: 'ran on',
};

export function ActivityPage(): React.JSX.Element {
  const app = useApp();
  const [who, setWho] = useState<Who>('all');
  const [board, setBoard] = useState('');
  const [events, setEvents] = useState<EventRec[] | null>(null);
  const [more, setMore] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => listen('events', () => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    api
      .activity({ actor: who === 'all' ? undefined : who, board: board || undefined, limit: 80 })
      .then((r) => {
        if (!alive) return;
        setEvents(r.events);
        setMore(r.more);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
    return () => {
      alive = false;
    };
  }, [who, board, tick]);
  useEffect(() => {
    void api.reportUi({ view: 'activity' }).catch(() => undefined);
  }, []);
  const loadMore = (): void => {
    if (events === null || events.length === 0) return;
    api
      .activity({ actor: who === 'all' ? undefined : who, board: board || undefined, limit: 80, before: events[events.length - 1]!.created })
      .then((r) => {
        setEvents([...events, ...r.events]);
        setMore(r.more);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const days = useMemo(() => {
    const m = new Map<string, EventRec[]>();
    for (const e of events ?? []) m.set(day(e.created), [...(m.get(day(e.created)) ?? []), e]);
    return [...m.entries()];
  }, [events]);
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--kb-hair)] px-3 py-2 md:px-6">
        <MenuButton />
        <h1 className="text-[15px] font-semibold">Activity</h1>
        <span className="flex-1" />
        <div className="flex w-full items-center gap-2 overflow-x-auto sm:w-auto">
        <Segmented size="sm" label="Who" value={who} onChange={setWho} options={[{ value: 'all', label: 'Everyone' }, { value: 'you', label: 'You' }, { value: 'agent', label: 'Agent' }, { value: 'rule', label: 'Rules' }]} />
        <Select aria-label="Board" value={board} onChange={(e) => setBoard(e.target.value)} className="min-w-[120px] flex-1 sm:w-[190px] sm:flex-none">
          <option value="">All boards</option>
          {app.boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        </div>
      </header>
      <div className="kb-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[900px] flex-col gap-5 px-3 py-4 md:px-6 md:py-5">
          {events === null ? (
            <div className="flex h-40 items-center justify-center text-[var(--kb-muted)]">
              <Spinner size={18} />
            </div>
          ) : events.length === 0 ? (
            <Empty icon={History} title="No activity yet">
              Every change by you, the agent and your rules shows here, and can be reverted.
            </Empty>
          ) : (
            days.map(([d, evs]) => (
              <section key={d} className="flex flex-col">
                <h2 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">{d}</h2>
                {evs.map((e) => (
                  <Row key={e.id} e={e} />
                ))}
              </section>
            ))
          )}
          {more && (
            <div>
              <Button onClick={loadMore}>Load older</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ e }: { e: EventRec }): React.JSX.Element {
  const app = useApp();
  const who = e.actor_kind === 'you' ? app.you : e.actor_kind === 'agent' ? 'The agent' : e.actor_kind === 'rule' ? 'A rule' : 'The board';
  const verb = VERB[e.kind] ?? e.kind.replace(/_/g, ' ');
  const detail = e.kind === 'moved' ? `to ${(e.after as { name?: string } | null)?.name ?? '?'}` : e.kind === 'updated' ? `the ${e.field}` : '';
  return (
    <div className="group flex min-h-10 items-start gap-3 rounded-[var(--kb-radius-sm)] px-2 py-1.5 hover:bg-[var(--kb-main-hover)]">
      <span className="pt-0.5">{e.actor_kind === 'agent' ? <AgentAvatar size={22} /> : e.actor_kind === 'you' ? <YouAvatar name={app.you} size={22} /> : <span className="flex size-[22px] items-center justify-center rounded-full bg-[var(--kb-card)] text-[var(--kb-muted)]"><Zap size={11} aria-hidden /></span>}</span>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[13px] leading-5', e.reverted && 'line-through opacity-60')}>
          <span className="font-medium">{who}</span> <span className="text-[var(--kb-ink-2)]">{verb}</span>{' '}
          {e.card_key !== undefined ? (
            <button type="button" onClick={() => app.setOpenCard(e.card)} className="text-left font-medium hover:underline">
              {e.card_key} {e.card_title}
            </button>
          ) : (
            <span className="text-[var(--kb-ink-2)]">{e.text}</span>
          )}{' '}
          {detail !== '' && <span className="text-[var(--kb-ink-2)]">{detail}</span>}
          {e.board_name !== undefined && <span className="text-[var(--kb-muted)]"> · {e.board_name}</span>}
        </div>
        {e.card_key !== undefined && e.text !== '' && e.text !== e.card_title && e.kind !== 'assigned' && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-[18px] text-[var(--kb-muted)]">{e.text}</div>}
      </div>
      <span className="shrink-0 pt-0.5 text-[12px] text-[var(--kb-muted)]">{time(e.created)}</span>
      {e.revertible === true && (
        <button type="button" title="Revert this change" aria-label="Revert this change" onClick={() => void api.revert(e.id).then((r) => toast.info(r.done.join(', ') || 'Reverted')).catch((err: unknown) => toast.error(errMessage(err)))} className="mt-0.5 shrink-0 text-[var(--kb-muted)] opacity-0 transition-opacity hover:text-[var(--kb-ink)] group-hover:opacity-100 focus:opacity-100">
          <Undo2 size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
