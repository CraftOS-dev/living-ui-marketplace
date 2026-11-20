/**
 * The decision part of the deal page's IC tab: the latest decision
 * (outcome, rule, the revealed votes, conditions with their status) and the
 * history. A decision is never edited: Correct records a new one.
 */
import { useState } from 'react';
import { CircleCheck, Circle, FileText, Plus } from 'lucide-react';
import { Avatar, Button, ChipPicker, Dialog, IconButton, Input, LoadError, Section, Segmented, Skeleton, Tag, Tip } from '../../components/ui.tsx';
import { READS, TallyView } from '../../components/committee/parts.tsx';
import { OUTCOMES, PASS_REASONS, REVIEW_EVENT, RULES, outcomeTone, type Condition, type Decision } from '../../components/committee/types.ts';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { fmtDay } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import type { RecordLike } from '../../lib/contract.ts';
import { cn } from '../../../kit/index.ts';

function RecordDialog({ deal, corrects, open, onClose }: { deal: string; corrects: string; open: boolean; onClose: () => void }): React.JSX.Element {
  const [outcome, setOutcome] = useState<string>('');
  const [rule, setRule] = useState<string>('champion');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const record = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('decisions.record', { deal, outcome, rule, reason: outcome === 'pass' && reason !== '' ? reason : undefined, corrects: corrects !== '' ? corrects : undefined }, { pin: { title: 'Record decision' } }), READS);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={corrects !== '' ? 'Correct decision' : 'Record decision'}
      width={480}
      footer={
        <Button variant="primary" busy={busy} disabled={outcome === ''} onClick={() => void record()}>
          Record
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <ChipPicker label="Outcome" keys options={OUTCOMES} value={outcome as (typeof OUTCOMES)[number]['value'] | ''} onChange={setOutcome} />
        <Segmented label="Rule" size="sm" value={rule as (typeof RULES)[number]['value']} onChange={setRule} options={RULES} />
        {outcome === 'pass' && <ChipPicker label="Reason" options={PASS_REASONS} value={reason} onChange={setReason} />}
      </div>
    </Dialog>
  );
}

function ConditionRow({ c, canComplete }: { c: Condition; canComplete: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const done = c.status !== 'open';
  return (
    <li className="flex min-h-9 min-w-0 items-center gap-3 border-b border-[var(--vo-hair)] py-1.5 last:border-b-0">
      {canComplete && !done ? (
        <IconButton
          icon={busy ? CircleCheck : Circle}
          label="Done"
          size={28}
          onClick={() => {
            setBusy(true);
            void act([], () => op('conditions.complete', { condition: c.id }), READS).finally(() => setBusy(false));
          }}
        />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center text-[var(--vo-muted)]">{done ? <CircleCheck size={16} className={c.status === 'done' ? 'text-[var(--vo-good)]' : ''} aria-label={c.status} /> : <Circle size={16} aria-hidden />}</span>
      )}
      <span className={cn('vo-wrap min-w-0 flex-1 text-[13px]', done && 'text-[var(--vo-muted)] line-through decoration-[var(--vo-line-2)]')}>{c.text}</span>
      {c.evidence !== '' && /^https?:\/\//.test(c.evidence) && (
        <a href={c.evidence} target="_blank" rel="noreferrer" className="vo-link hit shrink-0 text-[12px]">
          Proof
        </a>
      )}
      {c.owner !== null && (
        <Tip text={c.owner.name}>
          <span>
            <Avatar name={c.owner.name} size={22} />
          </span>
        </Tip>
      )}
      <span className={cn('vo-mono vo-num w-[92px] shrink-0 text-right text-[12px]', c.overdue ? 'text-[var(--vo-bad)]' : 'text-[var(--vo-ink-2)]')}>{c.due_day !== '' ? fmtDay(c.due_day) : ''}</span>
    </li>
  );
}

/** The decision part of the IC tab: the latest decision on top; nothing when there is none (the deal header's black button is the next committee step). */
export function DecisionPart({ deal }: { deal: RecordLike }): React.JSX.Element | null {
  const me = useMe();
  const dealRef = String((deal['number'] as string | undefined) ?? deal.id);
  const live = useOp<{ decision: Decision | null; history: Decision[] }>('decisions.get', { deal: dealRef }, READS, { name: 'committee.decision' });
  const [recording, setRecording] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const canEdit = allowed(me, 'committee:edit');
  if (live.loading) return <Skeleton className="h-10" />;
  if (live.data === null) return <LoadError message={live.error ?? 'Could not load the decision.'} onRetry={live.reload} />;
  const d = live.data.decision;
  if (d === null) return null;
  const members = (d.votes ?? []).map((v) => ({ id: v.member, name: v.name, voted: true, choice: v.choice, lean: v.lean as 'for' | 'against' | 'neutral', veto: v.veto, rationale: v.rationale }));
  const history = live.data.history.filter((h) => h.id !== d.id);
  const addCondition = async (): Promise<void> => {
    const text = adding.trim();
    if (text === '') return;
    setAdding('');
    await act([], () => op('conditions.save', { decision: d.id, text }), READS);
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className={cn('inline-flex h-9 items-center rounded-[var(--vo-radius-sm)] px-3 text-[15px] font-semibold', outcomeTone(d.outcome) === 'good' ? 'bg-[var(--vo-good-soft)] text-[var(--vo-good)]' : outcomeTone(d.outcome) === 'bad' ? 'bg-[var(--vo-bad-soft)] text-[var(--vo-bad)]' : outcomeTone(d.outcome) === 'warn' ? 'bg-[var(--vo-warn-soft)] text-[var(--vo-warn)]' : 'bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]')}>{d.outcome_label}</span>
        <Tag>{d.rule_label}</Tag>
        {d.reason_label !== '' && <Tag tone="faint">{d.reason_label}</Tag>}
        <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink-2)]">{fmtDay(d.decided_at)}</span>
        {d.decided_by !== null && (
          <Tip text={`Recorded by ${d.decided_by.name}`}>
            <span>
              <Avatar name={d.decided_by.name} size={24} />
            </span>
          </Tip>
        )}
        {d.memo !== null && (
          <Tip text={`Memo hash ${d.memo.hash}`}>
            <span className="vo-mono inline-flex items-center gap-1 text-[12px] text-[var(--vo-muted)]">
              <FileText size={12} aria-hidden />v{d.memo.version}
            </span>
          </Tip>
        )}
        {d.meeting !== null && (
          <a href={`#/committee/${d.meeting.id}`} className="vo-link hit vo-mono text-[12px]">
            {d.meeting.number}
          </a>
        )}
        <span className="flex-1" />
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setRecording(d.id)}>
            Correct
          </Button>
        )}
      </div>
      {d.tally !== null && d.tally.voted > 0 && <TallyView tally={{ ...d.tally, votes: d.votes }} members={members} />}
      {((d.conditions ?? []).length > 0 || canEdit) && (
        <Section title="Conditions">
          <ul className="flex min-w-0 flex-col">
            {(d.conditions ?? []).map((c) => (
              <ConditionRow key={c.id} c={c} canComplete={canEdit || c.owner?.id === me.member.id} />
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <Input className="min-w-0 flex-1" value={adding} placeholder="Condition" aria-label="New condition" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addCondition()} />
              <IconButton icon={Plus} label="Add condition" onClick={() => void addCondition()} />
            </div>
          )}
        </Section>
      )}
      {d.reviews.length > 0 && (
        <Section title="Since">
          <ul className="flex min-w-0 flex-col gap-2">
            {d.reviews.map((r) => (
              <li key={r.id} className="flex min-w-0 items-center gap-2 text-[13px]">
                <span className="vo-mono vo-num w-[92px] shrink-0 text-[12px] text-[var(--vo-ink-2)]">{fmtDay(r.day)}</span>
                <Tag tone="a">{REVIEW_EVENT[r.event] ?? r.event}</Tag>
                <span className="vo-wrap min-w-0 flex-1">{r.text}</span>
                {r.source_url !== '' && (
                  <a href={r.source_url} target="_blank" rel="noreferrer" className="vo-link hit shrink-0 text-[12px]">
                    {r.source_name !== '' ? r.source_name : 'Source'}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {history.length > 0 && (
        <Section title="History">
          <ul className="flex min-w-0 flex-col">
            {history.map((h) => (
              <li key={h.id} className="flex min-h-9 items-center gap-3 border-b border-[var(--vo-hair)] text-[13px] last:border-b-0">
                <span className="vo-mono vo-num w-[92px] shrink-0 text-[12px] text-[var(--vo-ink-2)]">{fmtDay(h.decided_at)}</span>
                <Tag tone={outcomeTone(h.outcome)}>{h.outcome_label}</Tag>
                <span className="text-[var(--vo-ink-2)]">{h.rule_label}</span>
                {h.corrected_by !== '' && <Tag tone="faint">Corrected</Tag>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <RecordDialog deal={dealRef} corrects={recording ?? ''} open={recording !== null} onClose={() => setRecording(null)} />
    </div>
  );
}
