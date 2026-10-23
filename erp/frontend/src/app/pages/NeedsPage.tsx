/**
 * Needs you: everything waiting on this person, in one place, each with the
 * action right there. Decisions first (your AI agent's proposals, leave,
 * claims, timesheets), then money that needs attention (overdue invoices,
 * bills due, bank lines to match, claims to post or pay), then loose ends
 * (drafts your AI agent prepared, Inbox files it could not read).
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlarmClock, ArrowUpRight, CalendarDays, Check, FileText, HandCoins, Inbox, Landmark, PartyPopper, Receipt, RotateCcw, Sparkles, Timer, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AskAgent } from '../components/AskAgent.tsx';
import { Chips } from '../components/controls.tsx';
import { ProposalCard } from '../components/Proposal.tsx';
import { docTypeLabel } from '../components/status.ts';
import { ActorPill, Card, CardHeader, CircleButton, Empty, LoadError, PageHeader, PageSkeleton, PillButton, TextLink } from '../components/ui.tsx';
import { op } from '../lib/api.ts';
import { ago, shortDay } from '../lib/dates.ts';
import { money, plural, qty } from '../lib/format.ts';
import { READS, useLive } from '../lib/live.ts';
import { can, useMe } from '../lib/me.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { Needs } from '../lib/types/home.ts';
import type { PageProps } from '../routes.tsx';

type Group = 'all' | 'decide' | 'money' | 'agent';

function Section({ id, icon: Icon, title, count, action, children }: { id: string; icon: LucideIcon; title: string; count: number; action?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <Card id={id}>
      <CardHeader icon={Icon} title={title} subtitle={plural(count, 'waiting', 'waiting')} action={action} />
      {children}
    </Card>
  );
}

function Row({ title, sub, right, onOpen, actions, alert = false }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; onOpen?: () => void; actions?: React.ReactNode; alert?: boolean }): React.JSX.Element {
  return (
    <li className={cn('flex flex-wrap items-center gap-3 rounded-[18px] px-3 py-2.5', alert ? 'bg-[var(--erp-red)]/8' : 'bg-[var(--erp-row)]')}>
      <button type="button" disabled={onOpen === undefined} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold">{title}</span>
          {sub !== undefined && <span className="block truncate text-[12px] text-[var(--erp-muted)]">{sub}</span>}
        </span>
        {right !== undefined && <span className="num shrink-0 text-[14px] font-bold">{right}</span>}
      </button>
      {actions !== undefined && <span className="flex shrink-0 items-center gap-1.5">{actions}</span>}
    </li>
  );
}

/** Approve, or reject with a note the person reads. */
function Decide({ onDecide }: { onDecide: (approve: boolean, note: string) => Promise<void> }): React.JSX.Element {
  const [busy, setBusy] = useState<boolean | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const run = async (approve: boolean): Promise<void> => {
    setBusy(approve);
    try {
      await onDecide(approve, approve ? '' : note.trim());
      setRejecting(false);
      setNote('');
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };
  if (rejecting) {
    return (
      <span className="flex w-full flex-wrap items-center gap-1.5 @min-[480px]:w-auto">
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run(false);
            if (e.key === 'Escape') setRejecting(false);
          }}
          placeholder="Why not (they see this)"
          aria-label="Reason for rejecting"
          className="h-9 min-w-0 flex-1 rounded-full bg-[var(--erp-card)] px-4 text-[13px] outline-none ring-[var(--erp-ink)] focus-visible:ring-2 @min-[480px]:w-56"
        />
        <PillButton size="sm" variant="danger" loading={busy === false} onClick={() => void run(false)}>
          Reject
        </PillButton>
        <PillButton size="sm" variant="ghost" onClick={() => setRejecting(false)}>
          Cancel
        </PillButton>
      </span>
    );
  }
  return (
    <>
      <PillButton size="sm" variant="light" icon={X} onClick={() => setRejecting(true)}>
        Reject
      </PillButton>
      <PillButton size="sm" icon={Check} dot loading={busy === true} onClick={() => void run(true)}>
        Approve
      </PillButton>
    </>
  );
}

export function NeedsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const group = (query.get('show') as Group | null) ?? 'all';
  const data = useLive(() => op<Needs>('home.needs', {}, { quiet: true }), [...READS.agent, ...READS.docs, 'bank_lines', 'leave_requests', 'expense_claims', 'timesheets', 'inbox'], []);
  const n = data.data;
  const cur = me.company.currency;

  if (n === null) return data.error !== null ? <LoadError message={data.error} onRetry={data.reload} /> : <PageSkeleton />;

  const c = n.counts;
  const decideCount = (c['proposals'] ?? 0) + (c['leave'] ?? 0) + (c['claims'] ?? 0) + (c['timesheets'] ?? 0);
  const moneyCount = (c['overdue'] ?? 0) + (c['bills_due'] ?? 0) + (c['bank'] ?? 0) + (n.claims_to_post?.length ?? 0) + (n.claims_to_pay?.length ?? 0);
  const agentCount = (c['proposals'] ?? 0) + (c['agent_drafts'] ?? 0) + (c['inbox_failed'] ?? 0);
  const show = (g: Group): boolean => group === 'all' || group === g;
  const nothing = decideCount + moneyCount + agentCount === 0;

  const decideLeave = async (id: string, approve: boolean, note: string): Promise<void> => {
    await op('leave.decide', { request: id, approve, note: note === '' ? undefined : note });
    toast.success(approve ? 'Leave approved' : 'Leave rejected');
    data.reload();
  };
  const decideClaim = async (id: string, approve: boolean, note: string): Promise<void> => {
    await op('claims.decide', { claim: id, approve, note: note === '' ? undefined : note });
    toast.success(approve ? 'Claim approved' : 'Claim rejected');
    data.reload();
  };
  const retry = async (id: string): Promise<void> => {
    await op('inbox.retry', { file: id }).catch(() => undefined);
    data.reload();
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Needs you" subtitle={nothing ? 'All caught up' : `${plural(decideCount, 'decision')} and ${plural(moneyCount, 'money matter')} waiting`} />
      <Chips<Group>
        ariaLabel="Show"
        value={group}
        onChange={(v) => replaceQuery('needs', { show: v === 'all' ? undefined : v })}
        options={[
          { value: 'all', label: 'Everything' },
          { value: 'decide', label: 'Decisions', count: decideCount },
          { value: 'money', label: 'Money', count: moneyCount },
          { value: 'agent', label: 'Your AI agent', count: agentCount },
        ]}
      />

      {nothing && (
        <Card>
          <Empty icon={PartyPopper} title="Nothing needs you">
            Approvals, overdue invoices, bills due and your AI agent's proposals show up here as they happen.
          </Empty>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 @min-[1100px]:grid-cols-2 @min-[1100px]:items-start">
        {(show('decide') || show('agent')) && n.proposals.length > 0 && (
          <div className="@min-[1100px]:col-span-2">
            <Section
              id="proposals"
              icon={Sparkles}
              title="From your AI agent"
              count={n.proposals.length}
              action={<CircleButton icon={ArrowUpRight} label="All proposals" variant="row" size={36} onClick={() => navigate('proposals')} />}
            >
              <div className="grid grid-cols-1 gap-3 @min-[900px]:grid-cols-2">
                {n.proposals.slice(0, 6).map((p) => (
                  <ProposalCard key={p.id} p={p} onDecided={data.reload} compact />
                ))}
              </div>
              {n.proposals.length > 6 && (
                <div className="mt-4">
                  <TextLink onClick={() => navigate('proposals')}>And {plural(n.proposals.length - 6, 'more proposal')}</TextLink>
                </div>
              )}
            </Section>
          </div>
        )}

        {show('decide') && (n.leave?.length ?? 0) > 0 && (
          <Section id="leave" icon={CalendarDays} title="Leave requests" count={n.leave?.length ?? 0} action={<CircleButton icon={ArrowUpRight} label="Leave" variant="row" size={36} onClick={() => navigate('leave', { tab: 'team' })} />}>
            <ul className="flex flex-col gap-1.5">
              {(n.leave ?? []).map((l) => (
                <Row
                  key={l.id}
                  title={l.employee}
                  sub={`${l.type}, ${shortDay(l.start)}${l.end !== l.start ? ` to ${shortDay(l.end)}` : ''} · ${plural(l.days, 'day')}${l.reason !== '' ? ` · ${l.reason}` : ''}`}
                  actions={<Decide onDecide={(a, note) => decideLeave(l.id, a, note)} />}
                />
              ))}
            </ul>
          </Section>
        )}

        {show('decide') && (n.claims?.length ?? 0) > 0 && (
          <Section id="claims" icon={HandCoins} title="Expense claims to approve" count={n.claims?.length ?? 0}>
            <ul className="flex flex-col gap-1.5">
              {(n.claims ?? []).map((cl) => (
                <Row
                  key={cl.id}
                  title={`${cl.employee}: ${cl.title}`}
                  sub={`${cl.number} · ${shortDay(cl.date)}`}
                  right={money(cl.total, cur)}
                  onOpen={() => navigate('claim', { id: cl.id })}
                  actions={<Decide onDecide={(a, note) => decideClaim(cl.id, a, note)} />}
                />
              ))}
            </ul>
          </Section>
        )}

        {show('decide') && (n.timesheets?.length ?? 0) > 0 && (
          <Section id="timesheets" icon={Timer} title="Timesheets to approve" count={n.timesheets?.length ?? 0}>
            <ul className="flex flex-col gap-1.5">
              {(n.timesheets ?? []).map((t) => (
                <Row
                  key={`${t.employee_id}${t.start}`}
                  title={t.employee}
                  sub={`${shortDay(t.start)} to ${shortDay(t.end)} · ${plural(t.entries, 'entry', 'entries')}`}
                  right={`${qty(t.hours)} h`}
                  onOpen={() => navigate('timesheets', { tab: 'team' })}
                  actions={
                    <PillButton size="sm" variant="light" onClick={() => navigate('timesheets', { tab: 'team' })}>
                      Review
                    </PillButton>
                  }
                />
              ))}
            </ul>
          </Section>
        )}

        {show('money') && (n.overdue?.length ?? 0) > 0 && (
          <Section
            id="overdue"
            icon={AlarmClock}
            title="Overdue invoices"
            count={c['overdue'] ?? 0}
            action={can(me, 'sales', 'edit') ? <AskAgent kind="collections_requested" label="Ask your AI agent to chase" size="sm" variant="light" /> : undefined}
          >
            <ul className="flex flex-col gap-1.5">
              {(n.overdue ?? []).map((d) => (
                <Row key={d.id} alert title={d.party} sub={`${d.number} · ${plural(d.days, 'day')} late`} right={money(d.balance, d.currency)} onOpen={() => navigate('doc', { id: d.id })} />
              ))}
            </ul>
          </Section>
        )}

        {show('money') && (n.bills_due?.length ?? 0) > 0 && (
          <Section id="bills" icon={Receipt} title="Bills due this week" count={c['bills_due'] ?? 0}>
            <ul className="flex flex-col gap-1.5">
              {(n.bills_due ?? []).map((d) => (
                <Row
                  key={d.id}
                  alert={d.due_date < me.today}
                  title={d.party}
                  sub={`${d.number} · ${d.due_date < me.today ? 'late, was due' : 'due'} ${shortDay(d.due_date)}`}
                  right={money(d.balance, d.currency)}
                  onOpen={() => navigate('doc', { id: d.id })}
                  actions={
                    can(me, 'banking', 'edit') || can(me, 'purchasing', 'full') ? (
                      <PillButton size="sm" variant="light" onClick={() => navigate('payments', { new: 'out', doc: d.id })}>
                        Pay
                      </PillButton>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          </Section>
        )}

        {show('money') && (n.bank?.length ?? 0) > 0 && (
          <Section id="bank" icon={Landmark} title="Bank lines to match" count={c['bank'] ?? 0}>
            <ul className="flex flex-col gap-1.5">
              {(n.bank ?? []).map((b) => (
                <Row
                  key={b.id}
                  title={b.name}
                  sub={plural(b.n, 'statement line') + ' not matched yet'}
                  onOpen={() => navigate('bank', { id: b.id })}
                  actions={
                    <>
                      <AskAgent kind="bank_lines_waiting" params={{ bank: b.id }} label="Ask your AI agent" size="sm" variant="light" />
                      <PillButton size="sm" onClick={() => navigate('bank', { id: b.id })}>
                        Match
                      </PillButton>
                    </>
                  }
                />
              ))}
            </ul>
          </Section>
        )}

        {show('money') && ((n.claims_to_post?.length ?? 0) > 0 || (n.claims_to_pay?.length ?? 0) > 0) && (
          <Section id="claims-money" icon={HandCoins} title="Expense claims to post and pay" count={(n.claims_to_post?.length ?? 0) + (n.claims_to_pay?.length ?? 0)}>
            <ul className="flex flex-col gap-1.5">
              {(n.claims_to_post ?? []).map((cl) => (
                <Row key={cl.id} title={`${cl.employee}: ${cl.title}`} sub={`${cl.number} · approved, to post`} right={money(cl.total, cur)} onOpen={() => navigate('claim', { id: cl.id })} />
              ))}
              {(n.claims_to_pay ?? []).map((cl) => (
                <Row key={cl.id} title={`${cl.employee}: ${cl.title}`} sub={`${cl.number} · posted, to pay back`} right={money(cl.total, cur)} onOpen={() => navigate('claim', { id: cl.id })} />
              ))}
            </ul>
            <div className="mt-4">
              <PillButton size="sm" variant="soft" onClick={() => navigate('claims', { tab: 'pay' })}>
                Open claims to pay
              </PillButton>
            </div>
          </Section>
        )}

        {show('agent') && (n.agent_drafts?.length ?? 0) > 0 && (
          <Section id="drafts" icon={FileText} title="Drafts your AI agent prepared" count={n.agent_drafts?.length ?? 0}>
            <ul className="flex flex-col gap-1.5">
              {(n.agent_drafts ?? []).map((d) => (
                <Row
                  key={d.id}
                  title={`${docTypeLabel(d.type)} for ${d.party}`}
                  sub={d.note !== '' ? d.note : ago(d.created)}
                  right={money(d.total, d.currency)}
                  onOpen={() => navigate('doc', { id: d.id })}
                  actions={<ActorPill actor="agent" />}
                />
              ))}
            </ul>
          </Section>
        )}

        {show('agent') && (n.inbox_failed?.length ?? 0) > 0 && (
          <Section id="inbox" icon={Inbox} title="Inbox files your AI agent could not read" count={n.inbox_failed?.length ?? 0}>
            <ul className="flex flex-col gap-1.5">
              {(n.inbox_failed ?? []).map((f) => (
                <Row
                  key={f.id}
                  alert
                  title={f.filename}
                  sub={f.error}
                  onOpen={() => navigate('inbox')}
                  actions={
                    <PillButton size="sm" variant="light" icon={RotateCcw} onClick={() => void retry(f.id)}>
                      Try again
                    </PillButton>
                  }
                />
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
