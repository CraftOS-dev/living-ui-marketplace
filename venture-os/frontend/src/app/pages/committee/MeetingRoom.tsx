/**
 * The meeting room (#/committee/:id): one agenda item at a time, as a line
 * of steps (Pre-read, Cooling, Votes, Reveal, Decided). The header's one
 * black button is the next step: Start, Vote, Reveal, Record decision, Next
 * item, Close. Votes stay dots until the reveal; then the Tally chart and
 * every rationale, junior first; then the decision as two chips.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, FileText, Gavel, Play, Plus, Trash2, Vote } from 'lucide-react';
import { Avatar, Button, ChipPicker, DayPicker, Empty, IconButton, Input, LoadError, PageBody, PageHeader, Panel, Section, Segmented, Skeleton, StatusDot, StepTrack, Tag, Tip, confirmAsk } from '../../components/ui.tsx';
import { BearCase, Cooling, READS, TallyView, VoteDialog, VoteDots } from '../../components/committee/parts.tsx';
import { OUTCOMES, PASS_REASONS, RULES, STEP_LABELS, outcomeTone, stepOf, type Item, type Meeting } from '../../components/committee/types.ts';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { addDays, fmtDay, money, time, today } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import type { PageProps } from '../../lib/contract.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { cn } from '../../../kit/index.ts';

interface CondRow {
  text: string;
  due_day: string;
}

/** The decision being recorded: two chips (outcome, rule), a pass reason, conditions as quick rows. */
interface Draft {
  outcome: string;
  rule: string;
  reason: string;
  conditions: CondRow[];
}

function AgendaList({ meeting, current, onPick }: { meeting: Meeting; current: string; onPick: (id: string) => void }): React.JSX.Element {
  return (
    <nav aria-label="Agenda" className="flex min-w-0 flex-col">
      {(meeting.items ?? []).map((it, i) => {
        const on = it.id === current;
        return (
          <button key={it.id} type="button" onClick={() => onPick(it.id)} aria-current={on ? 'true' : undefined} className={cn('vo-focus vo-tap relative flex min-h-11 min-w-0 items-center gap-2.5 rounded-[var(--vo-radius-sm)] px-2.5 text-left transition-colors duration-150', on ? 'bg-[var(--vo-active)]' : 'hover:bg-[var(--vo-hover)]')}>
            {on && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[2px] rounded-full bg-[var(--vo-ink)]" />}
            <span className="vo-mono w-4 shrink-0 text-[12px] text-[var(--vo-muted)]">{i + 1}</span>
            <span className="vo-wrap min-w-0 flex-1 text-[13px] font-medium">{it.title}</span>
            {it.decision !== null ? <Tag tone={outcomeTone(it.decision.outcome)}>{it.decision.outcome_label}</Tag> : it.status === 'skipped' ? <Tag tone="faint">Skipped</Tag> : it.votes !== undefined && it.votes.members.length > 0 ? <VoteDots members={it.votes.members} size={8} /> : null}
          </button>
        );
      })}
    </nav>
  );
}

/** The current item: header, its steps and the content of the step it is at. */
function ItemView({ item, meeting, draft, setDraft, canRun }: { item: Item; meeting: Meeting; draft: Draft; setDraft: (d: Draft) => void; canRun: boolean }): React.JSX.Element {
  const step = stepOf(item);
  const d = item.deal;
  const votes = item.votes;
  return (
    <Panel>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Avatar name={item.title} size={36} square />
          <div className="flex min-w-0 flex-1 flex-col">
            <a href={d !== null ? `#/deals/${d.number}` : undefined} className={cn('vo-wrap text-[15px] font-semibold leading-5', d !== null && 'vo-link hit')}>
              {item.title}
            </a>
            <span className="flex flex-wrap items-center gap-x-3 text-[12px] text-[var(--vo-muted)]">
              {d !== null && d.raise_minor !== null && <span className="vo-mono vo-num">{money(d.raise_minor, d.currency, { compact: true })}</span>}
              {d !== null && d.round_type !== '' && <span>{d.round_type.replace(/_/g, ' ')}</span>}
            </span>
          </div>
          <Tag tone={item.kind === 'follow_on' ? 'b' : 'neutral'}>{item.kind_label}</Tag>
          {item.champion !== null && (
            <Tip text={`Champion: ${item.champion.name}`}>
              <span>
                <Avatar name={item.champion.name} size={26} />
              </span>
            </Tip>
          )}
          {item.skeptic !== null && (
            <Tip text={`Skeptic: ${item.skeptic.name}`}>
              <span className="flex rounded-full ring-2 ring-[var(--vo-warn)]">
                <Avatar name={item.skeptic.name} size={26} />
              </span>
            </Tip>
          )}
        </div>
        <StepTrack labels={STEP_LABELS} at={step} className="max-w-[560px]" />

        {step < 4 && (
          <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Section title="Pre-read">
              <div className="flex min-w-0 flex-col gap-4">
                {item.memo !== null && d !== null ? (
                  <a href={`#/deals/${d.number}?tab=ic&part=memo`} className="vo-focus inline-flex items-center gap-2 self-start rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] px-2.5 py-1.5 text-[13px] transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                    <FileText size={14} aria-hidden />
                    <span className="vo-mono">
                      {item.memo.number} v{item.memo.version}
                    </span>
                  </a>
                ) : (
                  <span className="text-[13px] text-[var(--vo-muted)]">{item.deal !== null ? 'Memo not submitted' : 'No memo'}</span>
                )}
                <BearCase item={item} canAsk={canRun} />
              </div>
            </Section>
            <Section title="Votes">
              <div className="flex min-w-0 flex-col gap-3">
                {item.cooling.state === 'cooling' && <Cooling endsAt={item.cooling.ends_at} big />}
                {votes !== undefined && (
                  <ul className="flex min-w-0 flex-col">
                    {votes.members.map((m) => (
                      <li key={m.id} className="flex min-h-8 min-w-0 items-center gap-2.5">
                        <VoteDots members={[m]} size={12} />
                        <span className={cn('min-w-0 flex-1 truncate text-[13px]', m.voted ? 'text-[var(--vo-ink)]' : 'text-[var(--vo-muted)]')}>{m.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          </div>
        )}

        {step >= 4 && item.tally !== undefined && votes !== undefined && <TallyView tally={item.tally} members={votes.members} />}
        {step >= 4 && item.tally === undefined && <span className="text-[13px] text-[var(--vo-muted)]">No votes</span>}

        {step === 4 && canRun && (
          <div className="flex min-w-0 flex-col gap-4 border-t border-[var(--vo-hair)] pt-5">
            <ChipPicker label="Outcome" options={OUTCOMES} value={draft.outcome as (typeof OUTCOMES)[number]['value']} onChange={(v) => setDraft({ ...draft, outcome: v })} />
            <Segmented label="Rule" size="sm" value={draft.rule as (typeof RULES)[number]['value']} onChange={(v) => setDraft({ ...draft, rule: v })} options={RULES} />
            {draft.outcome === 'pass' && <ChipPicker label="Reason" options={PASS_REASONS} value={draft.reason} onChange={(v) => setDraft({ ...draft, reason: v })} />}
            {draft.outcome !== 'pass' && (
              <div className="flex min-w-0 flex-col gap-2">
                {draft.conditions.map((c, i) => (
                  <div key={i} className="flex min-w-0 items-center gap-2">
                    <Input className="min-w-0 flex-1" value={c.text} placeholder="Condition" aria-label="Condition" onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                    <DayPicker value={c.due_day} onChange={(v) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => (j === i ? { ...x, due_day: v } : x)) })} label="Due" className="w-[150px]" />
                    <IconButton icon={Trash2} label="Remove" size={28} onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={Plus} className="self-start" onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { text: '', due_day: addDays(today(), 14) }] })}>
                  Condition
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 5 && item.decision !== null && (
          <div className="flex items-center gap-2 border-t border-[var(--vo-hair)] pt-5">
            <Tag tone={outcomeTone(item.decision.outcome)} icon={Check}>
              {item.decision.outcome_label}
            </Tag>
            {d !== null && (
              <a href={`#/deals/${d.number}?tab=ic`} className="vo-link hit text-[13px]">
                Decision
              </a>
            )}
          </div>
        )}
        {meeting.status === 'closed' && item.status === 'skipped' && <Tag tone="faint">Skipped</Tag>}
      </div>
    </Panel>
  );
}

export function MeetingRoom({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ meeting: Meeting }>('meetings.get', { meeting: params['id'] ?? '' }, READS, { name: 'committee.room' });
  const meeting = live.data?.meeting ?? null;
  const items = meeting?.items ?? [];
  const picked = query.get('item') ?? '';
  const current = items.find((it) => it.id === picked) ?? items.find((it) => it.id === meeting?.current_item) ?? items.find((it) => it.status !== 'decided' && it.status !== 'skipped') ?? items[0] ?? null;
  const [voting, setVoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({ outcome: '', rule: 'consensus', reason: '', conditions: [] });
  const canRun = meeting !== null && meeting.me.facilitator && allowed(me, 'committee:edit');
  const myVote = current !== null && current.votes?.me.eligible === true && !current.votes.me.voted && current.preread_at !== '' && current.voting === 'open' && (current.status === 'waiting' || current.status === 'voting');
  // The deal page's Vote step opens the room with ?vote=1: the scale opens at once.
  const wantVote = query.get('vote') === '1';
  useEffect(() => {
    if (!wantVote || live.loading) return;
    if (myVote) setVoting(true);
    setQuery({ vote: null });
  }, [wantVote, myVote, live.loading]);

  useEffect(() => {
    if (current === null) return;
    const first = current.tally?.result === 'invest' ? 'invest' : current.tally?.result === 'pass' ? 'pass' : '';
    setDraft({ outcome: first, rule: current.rule, reason: '', conditions: [] });
  }, [current?.id, current?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextOpen = useMemo(() => {
    if (current === null) return null;
    const at = items.findIndex((x) => x.id === current.id);
    return items.slice(at + 1).find((x) => x.status !== 'decided' && x.status !== 'skipped') ?? items.find((x) => x.id !== current.id && x.status !== 'decided' && x.status !== 'skipped') ?? null;
  }, [items, current]);

  const pick = (id: string): void => {
    setQuery({ item: id });
    if (canRun && meeting !== null && meeting.status === 'live') void act([], () => op('meetings.start', { meeting: meeting.id, item: id }, { quiet: true }), READS);
  };

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    await act([], fn, READS);
    setBusy(false);
  };

  if (live.loading)
    return (
      <>
        <PageHeader title="Meeting" back="#/committee" />
        <PageBody>
          <Skeleton className="h-64" />
        </PageBody>
      </>
    );
  if (meeting === null)
    return (
      <>
        <PageHeader title="Meeting" back="#/committee" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Empty icon={Gavel} title="Meeting not found" />}</PageBody>
      </>
    );

  const step = current !== null ? stepOf(current) : -1;
  const waiting = current?.votes?.waiting ?? 0;

  let primary: React.JSX.Element | null = null;
  if (meeting.status === 'planned' && canRun && !myVote && step !== 4) {
    primary = (
      <Button variant="primary" icon={Play} busy={busy} onClick={() => void run(() => op('meetings.start', { meeting: meeting.id }))}>
        Start
      </Button>
    );
  } else if (myVote) {
    primary = (
      <Button variant="primary" icon={Vote} onClick={() => setVoting(true)}>
        Vote
      </Button>
    );
  } else if (current !== null && canRun && meeting.status !== 'closed') {
    if ((step === 2 || step === 3) && (current.votes?.voted ?? 0) > 0) {
      primary = (
        <Button
          variant="primary"
          busy={busy}
          onClick={() =>
            void (async () => {
              if (waiting > 0 && !(await confirmAsk(`${waiting} not voted. Close voting?`, 'Close and reveal', 'primary'))) return;
              await run(() => op('votes.reveal', { item: current.id, close: waiting > 0 }, { pin: { title: 'Reveal votes' } }));
            })()
          }
        >
          Reveal
        </Button>
      );
    } else if (step === 4) {
      primary = (
        <Button
          variant="primary"
          busy={busy}
          disabled={draft.outcome === ''}
          onClick={() =>
            void run(() =>
              op(
                'decisions.record',
                {
                  item: current.id,
                  outcome: draft.outcome,
                  rule: draft.rule,
                  reason: draft.outcome === 'pass' && draft.reason !== '' ? draft.reason : undefined,
                  conditions: draft.outcome !== 'pass' ? draft.conditions.filter((c) => c.text.trim() !== '').map((c) => ({ text: c.text.trim(), due_day: c.due_day })) : undefined,
                },
                { pin: { title: 'Record decision' } },
              ),
            )
          }
        >
          Record decision
        </Button>
      );
    } else if ((step === 5 || current.status === 'skipped') && nextOpen !== null) {
      primary = (
        <Button variant="primary" iconRight={ArrowRight} onClick={() => pick(nextOpen.id)}>
          Next item
        </Button>
      );
    } else if (step === 5 && nextOpen === null) {
      primary = (
        <Button variant="primary" busy={busy} onClick={() => void run(() => op('meetings.close', { meeting: meeting.id }))}>
          Close meeting
        </Button>
      );
    }
  }

  return (
    <>
      <PageHeader title={`${meeting.number} ${fmtDay(meeting.day)} ${time(meeting.starts_at)}`} back="#/committee">
        {primary}
      </PageHeader>
      <PageBody>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="order-2 flex min-w-0 flex-col gap-2 lg:order-1">
            <div className="flex items-center gap-2 px-2.5">
              {meeting.status === 'live' ? <StatusDot tone="good" pulse label="Live" /> : <StatusDot tone={meeting.status === 'planned' ? 'a' : 'faint'} label={meeting.status === 'planned' ? 'Planned' : 'Closed'} />}
              <span className="flex-1" />
              {meeting.facilitator !== null && (
                <Tip text={`Facilitator: ${meeting.facilitator.name}`}>
                  <span>
                    <Avatar name={meeting.facilitator.name} size={22} />
                  </span>
                </Tip>
              )}
            </div>
            {items.length > 0 ? <AgendaList meeting={meeting} current={current?.id ?? ''} onPick={pick} /> : null}
          </aside>
          <div className="order-1 min-w-0 lg:order-2">{current !== null ? <ItemView item={current} meeting={meeting} draft={draft} setDraft={setDraft} canRun={canRun} /> : <Panel><Empty icon={Gavel} title="No items" /></Panel>}</div>
        </div>
      </PageBody>
      {current !== null && <VoteDialog item={current} open={voting} onClose={() => setVoting(false)} />}
    </>
  );
}

