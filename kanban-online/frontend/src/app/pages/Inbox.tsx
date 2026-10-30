/**
 * Inbox: what needs you, typed and in order (questions agents asked, plans
 * to approve, cards handed back or failed, proposals, blocked and overdue
 * cards; reviews have their own queue), each with its action right there;
 * and what teammates, agents and rules did since you last looked. "Mine"
 * is the cards you asked for or hold (and ones nobody owns); "Everyone" is
 * the whole team's.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowRight, ArrowUp, Ban, CalendarClock, Check, CheckCheck, Eye, Inbox as InboxIcon, Lightbulb, ListChecks, MessageCircleQuestion, RotateCcw, ShieldQuestion, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { assigneeKey, forAgents } from '../components/people.tsx';
import { Button, Count, Empty, MenuButton, PartyAvatar, Segmented, Tabs, Textarea, errMessage, partyName } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, day } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href } from '../lib/router.ts';
import type { Card, EventRec } from '../lib/types.ts';

type Tab = 'needs' | 'updates';

export function InboxPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('needs');
  const [scope, setScope] = useState<'mine' | 'all' | null>(null);
  const live = useLive(() => api.inbox(scope ?? undefined), ['cards', 'events'], [scope], 400, 1500);
  const d = live.data;
  const shown = scope ?? d?.scope ?? 'mine';
  useEffect(() => {
    void api.reportUi({ view: 'inbox' }).catch(() => undefined);
  }, []);
  const needs = d?.needs;
  const waiting = needs === undefined ? 0 : needs.questions.length + needs.attention.length + needs.proposals.length;
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--kb-hair)] px-3 md:gap-3 md:px-6">
        <MenuButton />
        <h1 className="text-[15px] font-semibold">Inbox</h1>
        <span className="flex-1" />
        <Segmented
          size="sm"
          label="Whose"
          value={shown}
          onChange={(v) => setScope(v)}
          options={[
            { value: 'mine', label: <span className="inline-flex items-center gap-1.5">Mine {d?.counts.mine !== undefined && <span className="kb-num text-[var(--kb-muted)]">{d.counts.mine}</span>}</span>, title: 'Cards you asked for or hold, and ones nobody owns' },
            { value: 'all', label: <span className="inline-flex items-center gap-1.5">Everyone <span className="kb-num text-[var(--kb-muted)]">{d?.counts.all ?? ''}</span></span>, title: 'The whole team\'s' },
          ]}
        />
        {tab === 'updates' && (d?.updates.length ?? 0) > 0 && (
          <Button variant="ghost" icon={CheckCheck} aria-label="Mark all as seen" className="px-2 sm:px-3" onClick={() => void api.seen().catch((err: unknown) => toast.error(errMessage(err)))}>
            <span className="hidden sm:inline">Mark all as seen</span>
          </Button>
        )}
      </header>
      <div className="px-3 md:px-6">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'needs', label: <span className="inline-flex items-center gap-1.5">Needs you <Count n={waiting} tone="accent" /></span> },
            { value: 'updates', label: <span className="inline-flex items-center gap-1.5">Since you were away <Count n={d?.updates.length ?? 0} /></span> },
          ]}
        />
      </div>
      <div className="kb-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-6 px-3 py-4 md:px-6 md:py-5">
          {d === null ? null : tab === 'needs' ? (
            <>
              {needs !== undefined && needs.reviews.length > 0 && (
                <a href={href('review')} className="kb-focus flex items-center gap-3 rounded-[var(--kb-radius)] border border-[var(--kb-hair)] bg-[var(--kb-blue-soft)] px-4 py-3 hover:brightness-[0.98]">
                  <Eye size={16} aria-hidden className="text-[var(--kb-blue)]" />
                  <span className="flex-1 text-[13px]">
                    <span className="font-semibold">{needs.reviews.length} card{needs.reviews.length === 1 ? '' : 's'}</span> {needs.reviews.length === 1 ? 'waits' : 'wait'} for {shown === 'mine' ? 'your review' : 'review'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[12.5px] font-medium">
                    Open the review queue <ArrowRight size={13} aria-hidden />
                  </span>
                </a>
              )}
              <Group title="Questions and plans" icon={MessageCircleQuestion} cards={needs?.questions ?? []} render={(c) => <QuestionRow card={c} />} />
              <Group title="Needs attention" icon={AlertTriangle} cards={needs?.attention ?? []} render={(c) => <AttentionRow card={c} />} />
              <Group title="Proposed by agents" icon={Lightbulb} cards={needs?.proposals ?? []} render={(c) => <ProposalRow card={c} />} />
              <Group title="Blocked" icon={Ban} cards={needs?.blocked ?? []} render={(c) => <PlainRow card={c} note={c.blocked_reason} />} />
              <Group title="Overdue" icon={CalendarClock} cards={needs?.overdue ?? []} render={(c) => <PlainRow card={c} note={`Due ${day(c.due)}`} />} />
              {waiting === 0 && (needs?.reviews.length ?? 0) === 0 && (needs?.blocked.length ?? 0) === 0 && (needs?.overdue.length ?? 0) === 0 && (
                <Empty icon={InboxIcon} title={shown === 'mine' ? 'Nothing needs you' : 'Nothing needs the team'}>
                  Questions from agents, plans to approve, cards handed back and proposals land here.
                </Empty>
              )}
            </>
          ) : (
            <Updates events={d.updates} since={d.since} />
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, icon: Icon, cards, render }: { title: string; icon: LucideIcon; cards: Card[]; render: (c: Card) => React.ReactNode }): React.JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">
        <Icon size={13} aria-hidden /> {title} <span className="kb-num font-normal">{cards.length}</span>
      </h2>
      <div className="flex flex-col gap-2">
        {cards.map((c) => (
          <div key={c.id}>{render(c)}</div>
        ))}
      </div>
    </section>
  );
}

function Head({ card }: { card: Card }): React.JSX.Element {
  const app = useApp();
  // Who the card is waiting on you about: the one asking, the one who proposed it, else whoever has it.
  const who = card.question?.by_party ?? (card.proposed ? card.created_by : card.assignee);
  const forSomeoneElse = card.requester !== null && card.requester.id !== app.me?.id;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <PartyAvatar party={who} size={20} />
      <button type="button" onClick={() => app.setOpenCard(card.id)} className="min-w-0 truncate text-left text-[13px] font-medium hover:underline">
        <span className="kb-num mr-1.5 text-[var(--kb-muted)]">{card.key}</span>
        {card.title}
      </button>
      <span className="ml-auto shrink-0 text-[12px] text-[var(--kb-muted)]">
        {forSomeoneElse && <span className="hidden sm:inline">for {card.requester?.name} · </span>}
        <span className="hidden sm:inline">{card.board_name} · </span>
        {ago(card.updated)}
      </span>
    </div>
  );
}

function Frame({ children, tone }: { children: React.ReactNode; tone?: 'amber' | 'red' | 'violet' }): React.JSX.Element {
  return <div className={cn('flex flex-col gap-2.5 rounded-[var(--kb-radius)] border bg-[var(--kb-card)] px-4 py-3', tone === 'amber' ? 'border-[color-mix(in_srgb,var(--kb-amber),transparent_70%)]' : tone === 'red' ? 'border-[color-mix(in_srgb,var(--kb-red),transparent_70%)]' : tone === 'violet' ? 'border-[color-mix(in_srgb,var(--kb-violet),transparent_70%)]' : 'border-[var(--kb-hair)]')}>{children}</div>;
}

function QuestionRow({ card }: { card: Card }): React.JSX.Element {
  const app = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const q = card.question;
  const run = async (fn: () => Promise<unknown>, msg: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      setText('');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const Icon = q?.kind === 'plan' ? ListChecks : q?.kind === 'criteria' ? ShieldQuestion : MessageCircleQuestion;
  return (
    <Frame tone="amber">
      <Head card={card} />
      <div className="flex items-start gap-2 text-[13px] leading-5">
        <Icon size={15} aria-hidden className="mt-0.5 shrink-0 text-[var(--kb-amber)]" />
        <span>{q?.kind === 'plan' ? `${q.by_party?.name ?? 'An agent'} wants a go-ahead on a plan.` : q?.kind === 'criteria' ? q.text : `${q?.by_party?.name ?? 'An agent'} asks: ${q?.text ?? ''}`}</span>
      </div>
      {q?.kind === 'plan' ? (
        <div className="flex gap-2 pl-[23px]">
          <Button size="sm" variant="primary" icon={Check} busy={busy} onClick={() => void run(() => api.approvePlan(card.id), 'Plan approved')}>
            Approve plan
          </Button>
          <Button size="sm" onClick={() => app.setOpenCard(card.id)}>
            Read the plan
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 pl-[23px]">
          {(q?.options ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(q?.options ?? []).map((o) => (
                <Button key={o} size="sm" variant="pill" onClick={() => void run(() => api.answer(card.id, o), 'Answered')}>
                  {o}
                </Button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea aria-label="Your answer" value={text} minRows={1} placeholder={q?.kind === 'criteria' ? 'Acceptance criteria, one per line…' : 'Your answer…'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() !== '' && void run(() => api.answer(card.id, text.trim()), 'Answered')} />
            <Button variant="primary" icon={ArrowUp} busy={busy} disabled={text.trim() === ''} onClick={() => void run(() => api.answer(card.id, text.trim()), q?.kind === 'criteria' ? 'Criteria added' : 'Answered')}>
              {q?.kind === 'criteria' ? 'Add' : 'Answer'}
            </Button>
          </div>
        </div>
      )}
    </Frame>
  );
}

function AttentionRow({ card }: { card: Card }): React.JSX.Element {
  const app = useApp();
  const canRetry = forAgents(assigneeKey(card.assignee));
  const run = (fn: () => Promise<unknown>, msg: string): void => {
    fn()
      .then(() => toast.success(msg))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <Frame tone="red">
      <Head card={card} />
      <div className="flex items-start gap-2 text-[13px] leading-5">
        <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-[var(--kb-red)]" />
        <span>{card.attention}</span>
      </div>
      <div className="flex gap-2 pl-[23px]">
        {canRetry && (
          <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => run(() => api.retry(card.id), 'Queued again')}>
            Retry
          </Button>
        )}
        <Button size="sm" onClick={() => app.setOpenCard(card.id)}>
          Open
        </Button>
        <Button size="sm" variant="ghost" icon={Check} onClick={() => run(() => api.stop(card.id), 'The card is yours')}>
          I'll handle it
        </Button>
      </div>
    </Frame>
  );
}

function ProposalRow({ card }: { card: Card }): React.JSX.Element {
  const run = (fn: () => Promise<unknown>, msg: string): void => {
    fn()
      .then(() => toast.success(msg))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <Frame tone="violet">
      <Head card={card} />
      <div className="flex items-center gap-2 pl-[2px]">
        <span className="flex-1 text-[12.5px] text-[var(--kb-muted)]">Proposed by {card.created_by?.name ?? 'an agent'}</span>
        <Button size="sm" variant="primary" icon={Check} onClick={() => run(() => api.accept(card.id), 'Accepted')}>
          Accept
        </Button>
        <Button size="sm" variant="ghost" icon={X} onClick={() => run(() => api.archive([card.id]), 'Dismissed')}>
          Dismiss
        </Button>
      </div>
    </Frame>
  );
}

function PlainRow({ card, note }: { card: Card; note: string }): React.JSX.Element {
  return (
    <Frame>
      <Head card={card} />
      {note !== '' && <div className="text-[12.5px] text-[var(--kb-ink-2)]">{note}</div>}
    </Frame>
  );
}

const UPDATE_TEXT: Record<string, string> = {
  submitted: 'submitted work for review',
  question: 'asked about',
  answer: 'answered on',
  approved: 'approved',
  changes_requested: 'requested changes on',
  rejected: 'rejected',
  assigned: 'reassigned',
  created: 'created',
  accepted: 'accepted',
  agent_joined: 'connected',
  person_joined: 'joined the team',
  person_waiting: 'asked to join',
  returned: 'handed back',
  failed: 'could not finish',
  expired: 'stopped responding on',
  proposed: 'proposed',
  moved: 'moved',
  comment: 'commented on',
  updated: 'changed',
  rule: 'ran a rule on',
  blocked: 'flagged blocked',
};

function Updates({ events, since }: { events: EventRec[]; since: string }): React.JSX.Element {
  const app = useApp();
  const days = useMemo(() => {
    const m = new Map<string, EventRec[]>();
    for (const e of events) {
      const k = day(e.created);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [events]);
  if (events.length === 0)
    return (
      <Empty icon={CheckCheck} title="You are up to date">
        Nothing new from the team or its agents since {ago(since) || 'you last looked'}.
      </Empty>
    );
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] text-[var(--kb-muted)]">What teammates, agents and rules did since {ago(since)}.</p>
      {days.map(([d, evs]) => (
        <section key={d} className="flex flex-col gap-1">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">{d}</h2>
          {evs.map((e) => (
            <div key={e.id} className="flex min-h-9 items-center gap-2.5 rounded-[var(--kb-radius-sm)] px-2 hover:bg-[var(--kb-main-hover)]">
              <PartyAvatar party={e.actor ?? { kind: 'system', name: 'The board' }} size={20} />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className="font-medium">{e.actor !== null ? partyName(e.actor, app.me?.id) : e.actor_kind === 'rule' ? 'A rule' : 'The board'}</span> <span className="text-[var(--kb-ink-2)]">{UPDATE_TEXT[e.kind] ?? e.kind.replace(/_/g, ' ')}</span>{' '}
                {e.card_key !== undefined && (
                  <button type="button" onClick={() => app.setOpenCard(e.card)} className="text-left font-medium hover:underline">
                    {e.card_key} {e.card_title}
                  </button>
                )}
                {e.kind !== 'moved' && e.text !== '' && e.card_key === undefined && <span className="text-[var(--kb-muted)]"> · {e.text}</span>}
                {e.kind === 'moved' && <span className="text-[var(--kb-muted)]"> → {(e.after as { name?: string } | null)?.name}</span>}
              </span>
              <span className="shrink-0 text-[12px] text-[var(--kb-muted)]">{ago(e.created)}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
