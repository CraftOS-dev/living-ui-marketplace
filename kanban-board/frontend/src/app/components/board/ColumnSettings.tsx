/**
 * A column's contract, edited in place (every change saves as you make it):
 * what the stage means, its WIP limit, whether the agent works it, the
 * gates the agent must pass, where finished work goes, where review sends
 * rework, and the policy and instructions the agent reads.
 */
import { useEffect, useState } from 'react';
import { Hand } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import type { ColumnChanges } from '../../lib/api.ts';
import type { BoardDetail, Category, Column } from '../../lib/types.ts';
import { CATEGORY_HINT, CATEGORY_LABEL, CategoryIcon } from '../marks.tsx';
import { AgentAvatar, EditableText, Field, Input, Row, Section, Segmented, Select, Sheet, Toggle, errMessage } from '../ui.tsx';

const CATS: Category[] = ['triage', 'backlog', 'todo', 'doing', 'review', 'done', 'canceled'];

function NumberField({ value, onSave, min, max, label, suffix }: { value: number; onSave: (v: number) => void; min: number; max: number; label: string; suffix?: string }): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (): void => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < min || n > max) {
      setDraft(String(value));
      toast.error(`${label}: a whole number from ${min} to ${max}`);
      return;
    }
    if (n !== value) onSave(n);
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input aria-label={label} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-16 text-right" />
      {suffix !== undefined && <span className="text-[12px] text-[var(--kb-muted)]">{suffix}</span>}
    </span>
  );
}

export function ColumnSettings({ d, column, onClose }: { d: BoardDetail; column: Column; onClose: () => void }): React.JSX.Element {
  const save = (p: ColumnChanges): void => {
    api.updateColumn(column.id, p, true).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const others = d.columns.filter((c) => c.id !== column.id);
  const isReview = column.category === 'review';
  const closed = column.category === 'done' || column.category === 'canceled';
  const agentCapable = !isReview && !closed;
  const nextDefault = (() => {
    const i = d.columns.findIndex((c) => c.id === column.id);
    for (let k = i + 1; k < d.columns.length; k++) if (d.columns[k]!.category !== 'canceled') return d.columns[k]!.name;
    return 'none';
  })();
  return (
    <Sheet
      open
      onClose={onClose}
      width={460}
      label={`Column: ${column.name}`}
      title={
        <span className="inline-flex items-center gap-2">
          <CategoryIcon category={column.category} /> {column.name}
        </span>
      }
      subtitle="The column's contract: what it means, who works here, and the rules the agent follows. Changes save as you make them."
    >
      <div className="flex flex-col gap-6">
        <Section title="Stage">
          <Field label="Name">
            <EditableText label="Column name" value={column.name} onSave={(v) => v.trim() !== '' && save({ name: v.trim() })} />
          </Field>
          <Field label="What it means" hint={CATEGORY_HINT[column.category]}>
            <Select aria-label="Category" value={column.category} onChange={(e) => save({ category: e.target.value })}>
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Row label="WIP limit" hint="The agent cannot put more cards here; you get a warning. 0 = no limit.">
            <NumberField label="WIP limit" value={column.wip} min={0} max={999} onSave={(v) => save({ wip: v })} />
          </Row>
        </Section>

        {agentCapable && (
          <Section title="Who works here">
            <Segmented
              label="Who works here"
              value={column.agent ? 'agent' : 'you'}
              onChange={(v) => save({ agent: v === 'agent' })}
              options={[
                {
                  value: 'you',
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <Hand size={13} aria-hidden /> You
                    </span>
                  ),
                },
                {
                  value: 'agent',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <AgentAvatar size={15} /> Agent
                    </span>
                  ),
                },
              ]}
            />
            <p className="text-[12px] leading-4 text-[var(--kb-muted)]">
              {column.agent
                ? 'Every card that enters this column goes to the agent and is queued: moving a card here is the handoff. The agent is woken when work waits.'
                : 'Cards here are yours. Assign a single card to the agent from the card and it works it here.'}
            </p>
            <div className="flex flex-col">
              <Row label="Plan first" hint="The agent posts a plan; you approve it before it works.">
                <Toggle label="Plan first" checked={column.plan_first} onChange={(v) => save({ plan_first: v })} />
              </Row>
              <Row label="Needs acceptance criteria" hint="A card without criteria waits for you to add them before the agent starts.">
                <Toggle label="Needs acceptance criteria" checked={column.need_criteria} onChange={(v) => save({ need_criteria: v })} />
              </Row>
              <Row label="Checklist done to leave" hint="The agent must tick every item before submitting.">
                <Toggle label="Checklist done to leave" checked={column.need_checklist} onChange={(v) => save({ need_checklist: v })} />
              </Row>
              <Row label="Lease" hint="How long the agent holds a card without a heartbeat before it goes back to the queue.">
                <NumberField label="Lease minutes" value={column.lease_minutes} min={2} max={240} suffix="min" onSave={(v) => save({ lease_minutes: v })} />
              </Row>
              <Row label="Attempts" hint="Failures and timeouts before the card comes to you.">
                <NumberField label="Max attempts" value={column.max_attempts} min={1} max={10} onSave={(v) => save({ max_attempts: v })} />
              </Row>
            </div>
          </Section>
        )}

        <Section title="Flow">
          {!closed && (
            <Field label={isReview ? 'Approved work goes to' : 'Finished work goes to'} hint={isReview ? 'Where Approve moves the card.' : 'Where the agent\'s submitted work goes: a review column for you, or the next column the agent works. The agent never moves cards to Done.'}>
              <Select aria-label="Next column" value={column.next} onChange={(e) => save({ next: e.target.value })}>
                <option value="">The next column ({nextDefault})</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {isReview && (
            <>
              <Field label="Request changes sends it back to" hint="Default: the column the agent worked in.">
                <Select aria-label="Return to" value={column.return_to} onChange={(e) => save({ return_to: e.target.value })}>
                  <option value="">Where it was worked</option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          {!closed && (
            <Row label="Flag aging cards after" hint="Age dots turn amber, then red.">
              <NumberField label="Aging days" value={Math.round(column.aging_days) || 3} min={1} max={365} suffix="days" onSave={(v) => save({ aging_days: v })} />
            </Row>
          )}
        </Section>

        <Section title="Policy">
          <Field label="What entering and leaving this column means" hint="Shown on the column; the agent reads it too.">
            <EditableText label="Policy" multiline minRows={3} value={column.policy} onSave={(v) => save({ policy: v })} placeholder="e.g. Ready means: clear acceptance criteria, links to everything needed." />
          </Field>
          {agentCapable && (
            <Field label="Instructions for the agent here" hint="Sent with every card the agent takes from this column, after the board's how-we-work.">
              <EditableText label="Agent instructions" multiline minRows={4} value={column.instructions} onSave={(v) => save({ instructions: v })} placeholder="e.g. Collect sources first. Put your notes under a Research heading in the description." />
            </Field>
          )}
        </Section>
      </div>
    </Sheet>
  );
}
