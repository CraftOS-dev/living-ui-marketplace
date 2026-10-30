/**
 * Activity: every change on every board, newest first, attributed to the
 * person or agent who made it (or a rule, or the board itself), with an
 * agent's own words where it gave them. Narrow it to you, people, agents,
 * rules, or one teammate or agent. Any change to a card can be reverted.
 */
import { useEffect, useMemo, useState } from 'react';
import { History, Undo2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { usePartyOf } from '../components/people.tsx';
import { Button, Empty, MenuButton, PartyAvatar, Segmented, Select, Spinner, errMessage, partyName } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { day, time } from '../lib/format.ts';
import { listen } from '../lib/live.ts';
import { setQuery, useRoute } from '../lib/router.ts';
import type { EventRec } from '../lib/types.ts';

type Who = 'all' | 'me' | 'person' | 'agent' | 'rule';

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
  agent_joined: 'connected',
  agent_paused: 'paused an agent',
  agent_resumed: 'resumed an agent',
  agent_removed: 'removed an agent',
  agent_restored: 'brought back an agent',
  agents_paused: 'paused every agent',
  agents_resumed: 'let every agent work again',
  person_joined: 'joined',
  person_waiting: 'asked to join',
  person_approved: 'let in',
  person_suspended: 'suspended',
  person_restored: 'restored',
  role_changed: 'changed the role of',
  rule_saved: 'saved the rule',
  board_created: 'created the board',
  board_updated: 'changed the board',
  board_deleted: 'deleted the board',
  board_frozen: 'froze the board',
  board_unfrozen: 'unfroze the board',
  column_added: 'added the column',
  column_updated: 'changed the column',
  column_removed: 'removed the column',
  retried: 'retried',
  plan_approved: 'approved the plan of',
  rule: 'ran on',
};

export function ActivityPage(): React.JSX.Element {
  const app = useApp();
  const { query } = useRoute();
  const one = query.get('who') ?? '';
  const partyOf = usePartyOf();
  const onePart = one !== '' ? partyOf(one) : null;
  const [who, setWho] = useState<Who>('all');
  const [board, setBoard] = useState('');
  const filter = { actor: one !== '' || who === 'all' || who === 'me' ? undefined : who, who: one !== '' ? one : who === 'me' ? 'me' : undefined, board: board || undefined };
  const [events, setEvents] = useState<EventRec[] | null>(null);
  const [more, setMore] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => listen('events', () => setTick((t) => t + 1)), []);
  useEffect(() => {
    let alive = true;
    api
      .activity({ ...filter, limit: 80 })
      .then((r) => {
        if (!alive) return;
        setEvents(r.events);
        setMore(r.more);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, board, one, tick]);
  useEffect(() => {
    void api.reportUi({ view: 'activity' }).catch(() => undefined);
  }, []);
  const loadMore = (): void => {
    if (events === null || events.length === 0) return;
    api
      .activity({ ...filter, limit: 80, before: events[events.length - 1]!.created })
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
        {one !== '' ? (
          <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[var(--kb-card)] pl-1 pr-1.5 text-[12.5px] font-medium ring-1 ring-inset ring-[var(--kb-hair)]">
            <PartyAvatar party={onePart} size={20} />
            Only {onePart?.name ?? 'them'}
            <button type="button" aria-label="Show everyone" onClick={() => setQuery('activity', {})} className="flex size-5 items-center justify-center rounded-full text-[var(--kb-muted)] hover:bg-[var(--kb-active)] hover:text-[var(--kb-ink)]">
              <X size={12} aria-hidden />
            </button>
          </span>
        ) : (
          <Segmented size="sm" label="Who" value={who} onChange={setWho} options={[{ value: 'all', label: 'Everyone' }, { value: 'me', label: 'Me' }, { value: 'person', label: 'People' }, { value: 'agent', label: 'Agents' }, { value: 'rule', label: 'Rules' }]} />
        )}
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
              Every change by the team, its agents and the board&apos;s rules shows here, and can be reverted.
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
  const who = e.actor !== null ? partyName(e.actor, app.me?.id) : e.actor_kind === 'rule' ? 'A rule' : 'The board';
  const verb = VERB[e.kind] ?? e.kind.replace(/_/g, ' ');
  const detail = e.kind === 'moved' ? `to ${(e.after as { name?: string } | null)?.name ?? '?'}` : e.kind === 'updated' ? `the ${e.field}` : '';
  return (
    <div className="group flex min-h-10 items-start gap-3 rounded-[var(--kb-radius-sm)] px-2 py-1.5 hover:bg-[var(--kb-main-hover)]">
      <span className="pt-0.5">
        <PartyAvatar party={e.actor ?? { kind: 'system', name: 'The board' }} size={22} />
      </span>
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
