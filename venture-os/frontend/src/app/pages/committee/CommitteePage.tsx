/**
 * The Committee page: the next meeting first (its agenda with a vote dot per
 * member and the cooling-off countdown), then Meetings, Decisions and the
 * Anti-portfolio. The one black button is Vote while a vote of mine is due,
 * otherwise New meeting.
 */
import { useMemo, useState } from 'react';
import { ArrowUpRight, CalendarPlus, Gavel, Lock, Plus, Sparkle, Vote } from 'lucide-react';
import { Avatar, Button, DataTable, DayPicker, Dialog, Empty, Field, Input, LoadError, PageBody, PageHeader, Panel, PersonChip, Skeleton, StatusDot, Tabs, Tag, Tip } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { Cooling, JobTrack, READS, VoteDialog, VoteDots } from '../../components/committee/parts.tsx';
import { REVIEW_EVENT, outcomeTone, type AntiRow, type Decision, type Item, type JobBrief, type Meeting, type MeetingList } from '../../components/committee/types.ts';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { fmtDay, money, time } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate, setQuery, useRoute } from '../../lib/router.ts';
import { cn } from '../../../kit/index.ts';
import { AskAgent, askWith, stateOfTrack } from '../../components/agent.tsx';

type TabKey = 'meetings' | 'decisions' | 'anti';

function dueItem(m: Meeting | null): Item | null {
  if (m === null) return null;
  return (m.items ?? []).find((it) => it.votes?.me.eligible === true && !it.votes.me.voted && it.preread_at !== '' && it.voting === 'open' && (it.status === 'waiting' || it.status === 'voting')) ?? null;
}

/** One agenda row: company, kind, champion, a dot per voter, the countdown or the outcome. */
function AgendaRow({ item, meeting }: { item: Item; meeting: Meeting }): React.JSX.Element {
  const name = item.title !== '' ? item.title : item.company?.name ?? '';
  return (
    <a href={`#/committee/${meeting.id}?item=${item.id}`} className="vo-focus vo-tap group flex min-h-11 min-w-0 items-center gap-3 border-b border-[var(--vo-hair)] px-2 py-1.5 transition-colors duration-150 last:border-b-0 hover:bg-[var(--vo-hover)]">
      <Avatar name={name} size={26} square />
      <span className="vo-wrap min-w-0 flex-1 text-[13px] font-medium">{name}</span>
      <Tag tone={item.kind === 'follow_on' ? 'b' : 'neutral'} className="hidden sm:inline-flex">
        {item.kind_label}
      </Tag>
      {item.champion !== null && (
        <Tip text={`Champion: ${item.champion.name}`}>
          <span className="hidden sm:inline-flex">
            <Avatar name={item.champion.name} size={22} />
          </span>
        </Tip>
      )}
      <span className="flex w-[92px] shrink-0 justify-end sm:w-[120px]">{item.votes !== undefined && item.votes.members.length > 0 && <VoteDots members={item.votes.members} />}</span>
      <span className="flex w-[84px] shrink-0 justify-end">
        {item.decision !== null ? (
          <Tag tone={outcomeTone(item.decision.outcome)}>{item.decision.outcome_label}</Tag>
        ) : item.status === 'revealed' ? (
          <Tag tone="warn">Revealed</Tag>
        ) : item.cooling.state === 'cooling' ? (
          <Cooling endsAt={item.cooling.ends_at} />
        ) : item.preread_at === '' ? (
          <Tip text="Memo not submitted">
            <span className="text-[12px] text-[var(--vo-muted)]">No memo</span>
          </Tip>
        ) : null}
      </span>
    </a>
  );
}

/** The next meeting: when, who facilitates, and its agenda. */
function NextMeeting({ meeting }: { meeting: Meeting }): React.JSX.Element {
  const items = meeting.items ?? [];
  return (
    <Panel flush>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3 pt-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="vo-mono vo-num text-[26px] font-light leading-8 tracking-tight">{time(meeting.starts_at)}</span>
          <span className="vo-mono vo-num text-[14px] text-[var(--vo-ink-2)]">{fmtDay(meeting.day, { weekday: true })}</span>
        </div>
        {meeting.status === 'live' ? <StatusDot tone="good" pulse label="Live" /> : <span className="vo-mono text-[12px] text-[var(--vo-muted)]">{meeting.number}</span>}
        <span className="flex-1" />
        {meeting.hidden > 0 && (
          <Tip text={`${meeting.hidden} restricted`}>
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--vo-muted)]">
              <Lock size={12} aria-hidden />
              <span className="vo-mono">{meeting.hidden}</span>
            </span>
          </Tip>
        )}
        {meeting.facilitator !== null && (
          <Tip text={`Facilitator: ${meeting.facilitator.name}`}>
            <span>
              <Avatar name={meeting.facilitator.name} size={24} />
            </span>
          </Tip>
        )}
        <Button size="sm" iconRight={ArrowUpRight} onClick={() => navigate('/committee/' + meeting.id)}>
          Room
        </Button>
      </div>
      <div className="px-3 pb-3">
        {items.length === 0 ? (
          <div className="flex min-h-11 items-center px-2 text-[13px] text-[var(--vo-muted)]">No items</div>
        ) : (
          items.map((it) => <AgendaRow key={it.id} item={it} meeting={meeting} />)
        )}
      </div>
    </Panel>
  );
}

function NewMeetingDialog({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults: MeetingList['defaults'] | undefined }): React.JSX.Element {
  const [day, setDay] = useState('');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const d = day !== '' ? day : defaults?.day ?? '';
  const t = at !== '' ? at : defaults?.time ?? '10:00';
  const create = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op<{ meeting: Meeting }>('meetings.create', { day: d, time: t }), READS);
    setBusy(false);
    if (out !== null) {
      onClose();
      navigate('/committee/' + out.meeting.id);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New meeting"
      width={400}
      footer={
        <Button variant="primary" busy={busy} onClick={() => void create()}>
          Create
        </Button>
      }
    >
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <Field label="Day">
          <DayPicker value={d} onChange={setDay} label="Day" />
        </Field>
        <Field label="Time">
          <Input className="vo-mono" value={t} onChange={(e) => setAt(e.target.value)} aria-label="Time" placeholder="10:00" maxLength={5} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- tabs */

function Meetings(): React.JSX.Element {
  const live = useOp<MeetingList>('meetings.list', { when: 'all', limit: 200 }, READS, { name: 'committee.meetings' });
  const cols: Column<Meeting>[] = [
    { key: 'number', label: 'Meeting', width: '110px', fixed: true, phone: 'title', sort: (m) => m.starts_at, render: (m) => <span className="vo-mono text-[13px]">{m.number}</span> },
    { key: 'day', label: 'Day', width: 'minmax(140px,1fr)', sort: (m) => m.starts_at, render: (m) => <span className="vo-mono vo-num text-[13px]">{fmtDay(m.day, { weekday: true })} {time(m.starts_at)}</span> },
    { key: 'items', label: 'Decided', width: '90px', align: 'right', mono: true, render: (m) => `${m.items_decided}/${m.items_total}` },
    { key: 'facilitator', label: 'Facilitator', width: 'minmax(140px,1fr)', render: (m) => (m.facilitator !== null ? <PersonChip name={m.facilitator.name} size={20} /> : '') },
    { key: 'status', label: 'Status', width: '100px', phone: 'end', render: (m) => <StatusDot tone={m.status === 'live' ? 'good' : m.status === 'planned' ? 'a' : 'faint'} label={m.status === 'live' ? 'Live' : m.status === 'planned' ? 'Planned' : 'Closed'} /> },
  ];
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-24" />;
  return <DataTable label="Meetings" columns={cols} rows={live.data?.meetings ?? []} rowKey={(m) => m.id} rowHref={(m) => `#/committee/${m.id}`} stickyTop={0} initialSort={{ key: 'day', dir: 'desc' }} empty={<Empty icon={CalendarPlus} title="No meetings" />} />;
}

/** A tally as one small bar: for, neutral, against. */
function MiniTally({ d }: { d: Decision }): React.JSX.Element {
  const t = d.tally;
  if (t === null || t.voted === 0) return <span className="text-[12px] text-[var(--vo-muted)]">No votes</span>;
  const w = (n: number): string => `${(n / t.voted) * 100}%`;
  return (
    <Tip text={`${t.for} for, ${t.against} against${t.neutral > 0 ? `, ${t.neutral} neutral` : ''}`}>
      <span className="flex w-full max-w-[120px] items-center gap-2">
        <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--vo-sunk)]">
          <span style={{ width: w(t.for), background: 'var(--vo-good)' }} />
          <span style={{ width: w(t.neutral), background: 'var(--vo-muted)' }} />
          <span style={{ width: w(t.against), background: 'var(--vo-bad)' }} />
        </span>
        <span className="vo-mono vo-num text-[12px] text-[var(--vo-ink-2)]">
          {t.for}:{t.against}
        </span>
      </span>
    </Tip>
  );
}

function Decisions(): React.JSX.Element {
  const live = useOp<{ decisions: Decision[]; hidden: number }>('decisions.list', { limit: 300 }, READS, { name: 'committee.decisions' });
  const cols: Column<Decision>[] = [
    { key: 'day', label: 'Date', width: '110px', sort: (d) => d.decided_at, render: (d) => <span className="vo-mono vo-num text-[13px]">{fmtDay(d.decided_at)}</span> },
    { key: 'company', label: 'Company', width: 'minmax(160px,2fr)', fixed: true, phone: 'title', sort: (d) => d.company?.name ?? '', render: (d) => <PersonChip name={d.company?.name ?? d.deal?.title ?? ''} size={22} square /> },
    { key: 'outcome', label: 'Outcome', width: '140px', phone: 'end', sort: (d) => d.outcome, render: (d) => (
      <span className="flex items-center gap-1.5">
        <Tag tone={outcomeTone(d.outcome)}>{d.outcome_label}</Tag>
        {d.corrected_by !== '' && <Tag tone="faint">Corrected</Tag>}
      </span>
    ) },
    { key: 'rule', label: 'Rule', width: '110px', render: (d) => <span className="text-[13px] text-[var(--vo-ink-2)]">{d.rule_label}</span> },
    { key: 'tally', label: 'Tally', width: '150px', render: (d) => <MiniTally d={d} /> },
    { key: 'conditions', label: 'Conditions', width: '100px', align: 'right', mono: true, optional: false, render: (d) => (d.conditions_total > 0 ? `${d.conditions_total - d.conditions_open}/${d.conditions_total}` : '') },
  ];
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-24" />;
  return <DataTable label="Decisions" columns={cols} rows={live.data?.decisions ?? []} rowKey={(d) => d.id} rowHref={(d) => (d.deal !== null ? `#/deals/${d.deal.number}?tab=ic` : '#/committee')} stickyTop={0} empty={<Empty icon={Gavel} title="No decisions yet" />} />;
}

function AntiPortfolio(): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ rows: AntiRow[]; ask: JobBrief | null }>('decisions.anti-portfolio', { limit: 300 }, READS, { name: 'committee.anti' });
  const job = live.data?.ask ?? null;
  const running = job !== null && job.open;
  const cols: Column<AntiRow>[] = [
    { key: 'company', label: 'Company', width: 'minmax(160px,2fr)', fixed: true, phone: 'title', render: (r) => <PersonChip name={r.company?.name ?? ''} size={22} square /> },
    { key: 'day', label: 'Passed', width: '110px', sort: (r) => r.decided_at, render: (r) => <span className="vo-mono vo-num text-[13px]">{fmtDay(r.decided_at)}</span> },
    { key: 'reason', label: 'Reason', width: '120px', render: (r) => (r.reason_label !== '' ? <Tag>{r.reason_label}</Tag> : '') },
    { key: 'then', label: 'Raise then', width: '120px', align: 'right', mono: true, render: (r) => (r.then.raise_minor !== null ? money(r.then.raise_minor, r.then.currency, { compact: true }) : '') },
    {
      key: 'later',
      label: 'Since',
      width: 'minmax(200px,3fr)',
      phone: 'sub',
      render: (r) =>
        r.latest === null ? (
          ''
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <Tag tone={r.latest.event === 'shut_down' ? 'faint' : 'a'}>{REVIEW_EVENT[r.latest.event] ?? r.latest.event}</Tag>
            <span className="vo-wrap min-w-0 truncate text-[13px]">{r.latest.text}</span>
            {r.latest.by === 'agent' && <Sparkle size={12} className="shrink-0 text-[var(--vo-muted)]" aria-label="From your AI agent" />}
            {r.latest.source_url !== '' && (
              <a href={r.latest.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="vo-link hit shrink-0 text-[12px]">
                {r.latest.source_name !== '' ? r.latest.source_name : 'Source'}
              </a>
            )}
          </span>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {(running || (allowed(me, 'committee:view') && (live.data?.rows.length ?? 0) > 0)) && (
        <div className="flex min-h-8 items-center justify-end gap-3">
          {running && job !== null ? <JobTrack job={job} className="flex-1" /> : <AskAgent label="Check outcomes" state={stateOfTrack(job)} onAsk={askWith('anti_portfolio', '')} reads={READS} />}
        </div>
      )}
      {live.error !== null && live.data === null ? <LoadError message={live.error} onRetry={live.reload} /> : live.data === null ? <Skeleton className="h-24" /> : <DataTable label="Anti-portfolio" columns={cols} rows={live.data?.rows ?? []} rowKey={(r) => r.decision} rowHref={(r) => (r.deal !== null ? `#/deals/${r.deal.number}?tab=ic` : '#/committee')} stickyTop={0} empty={<Empty icon={Gavel} title="No passes yet" />} />}
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export function CommitteePage(): React.JSX.Element {
  const me = useMe();
  const route = useRoute();
  const tab = (route.query.get('tab') ?? 'meetings') as TabKey;
  const live = useOp<MeetingList>('meetings.list', { when: 'upcoming', limit: 1 }, READS, { name: 'committee.next' });
  const [voting, setVoting] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const next = live.data?.next ?? null;
  const due = useMemo(() => dueItem(next), [next]);
  const votesDue = live.data?.votes_due ?? 0;
  const canCreate = allowed(me, 'committee:edit');
  return (
    <>
      <PageHeader title="Committee">
        {votesDue > 0 ? (
          <Button variant="primary" icon={Vote} onClick={() => (due !== null ? setVoting(due) : navigate('/focus'))}>
            Vote
          </Button>
        ) : canCreate ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New meeting
          </Button>
        ) : null}
      </PageHeader>
      <PageBody>
        {live.loading ? (
          <Skeleton className="h-40" />
        ) : live.error !== null && live.data === null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : next !== null ? (
          <NextMeeting meeting={next} />
        ) : (
          <Panel>
            <Empty icon={CalendarPlus} title="No meeting planned" />
          </Panel>
        )}
        <div className={cn('flex min-w-0 flex-col gap-3')}>
          <Tabs<TabKey>
            label="Committee"
            value={tab}
            onChange={(v) => setQuery({ tab: v === 'meetings' ? null : v })}
            tabs={[
              { value: 'meetings', label: 'Meetings' },
              { value: 'decisions', label: 'Decisions' },
              { value: 'anti', label: 'Anti-portfolio' },
            ]}
          />
          {tab === 'decisions' ? <Decisions /> : tab === 'anti' ? <AntiPortfolio /> : <Meetings />}
        </div>
      </PageBody>
      {voting !== null && <VoteDialog item={voting} open onClose={() => setVoting(null)} />}
      <NewMeetingDialog open={creating} onClose={() => setCreating(false)} defaults={live.data?.defaults} />
    </>
  );
}
