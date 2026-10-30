/**
 * A column's contract, edited in place (every change saves as you make it):
 * what the stage means, its WIP limit, who works it (people, any agent, or
 * one agent), the gates agents must pass, where finished work goes, where
 * review sends rework, and the policy and instructions agents read.
 */
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import type { ColumnChanges } from '../../lib/api.ts';
import type { BoardDetail, Category, Column } from '../../lib/types.ts';
import { CATEGORY_HINT, CATEGORY_LABEL, CategoryIcon } from '../marks.tsx';
import { useApp } from '../../lib/context.tsx';
import { AgentAvatar, EditableText, Field, Input, PoolAvatar, Row, Section, Segmented, Select, Sheet, Toggle, errMessage } from '../ui.tsx';

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
  const agents = useApp().agents;
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
      subtitle="The column's contract: what it means, who works here, and the rules agents follow. Changes save as you make them."
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
          <Row label="WIP limit" hint="Agents cannot put more cards here; people get a warning. 0 = no limit.">
            <NumberField label="WIP limit" value={column.wip} min={0} max={999} onSave={(v) => save({ wip: v })} />
          </Row>
        </Section>

        {agentCapable && (
          <Section title="Who works here">
            <Segmented
              label="Who works here"
              value={column.agent_mode}
              onChange={(v) => {
                if (v === 'one') {
                  const first = column.agent ?? agents[0];
                  if (first === undefined) {
                    toast.error('No agent has connected yet. An agent joins the first time it calls through the CLI.');
                    return;
                  }
                  save({ agent: first.handle });
                } else save({ agent_mode: v });
              }}
              options={[
                {
                  value: 'off',
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <Users size={13} aria-hidden /> People
                    </span>
                  ),
                },
                {
                  value: 'any',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <PoolAvatar size={15} /> Any agent
                    </span>
                  ),
                },
                {
                  value: 'one',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <AgentAvatar agent={column.agent ?? agents[0]} size={15} /> One agent
                    </span>
                  ),
                },
              ]}
            />
            {column.agent_mode === 'one' && (
              <Field label="Agent">
                <Select aria-label="Agent" value={column.agent?.handle ?? ''} onChange={(e) => save({ agent: e.target.value })}>
                  {column.agent !== null && !agents.some((a) => a.id === column.agent?.id) && <option value={column.agent.handle}>{column.agent.name}</option>}
                  {agents.map((a) => (
                    <option key={a.id} value={a.handle}>
                      {a.name}
                      {a.paused ? ' (paused)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <p className="text-[12px] leading-4 text-[var(--kb-muted)]">
              {column.agent_mode === 'any'
                ? 'Every card that enters this column is queued for any agent: the first free one takes it, and rework comes back to the agent that did it. A card assigned to a person stays theirs.'
                : column.agent_mode === 'one'
                  ? `Every card that enters this column goes to ${column.agent?.name ?? 'the agent'} and is queued: moving a card here is the handoff.`
                  : 'People work the cards here. Assign a single card to an agent (or any agent) from the card and it is worked here.'}
            </p>
            <div className="flex flex-col">
              <Row label="Plan first" hint="The agent posts a plan; a person approves it before it works.">
                <Toggle label="Plan first" checked={column.plan_first} onChange={(v) => save({ plan_first: v })} />
              </Row>
              <Row label="Needs acceptance criteria" hint="A card without criteria waits for a person to add them before an agent starts.">
                <Toggle label="Needs acceptance criteria" checked={column.need_criteria} onChange={(v) => save({ need_criteria: v })} />
              </Row>
              <Row label="Checklist done to leave" hint="An agent must tick every item before submitting.">
                <Toggle label="Checklist done to leave" checked={column.need_checklist} onChange={(v) => save({ need_checklist: v })} />
              </Row>
              <Row label="Lease" hint="How long an agent holds a card without a heartbeat before it goes back to the queue.">
                <NumberField label="Lease minutes" value={column.lease_minutes} min={2} max={240} suffix="min" onSave={(v) => save({ lease_minutes: v })} />
              </Row>
              <Row label="Attempts" hint="Failures and timeouts before the card needs a person.">
                <NumberField label="Max attempts" value={column.max_attempts} min={1} max={10} onSave={(v) => save({ max_attempts: v })} />
              </Row>
            </div>
          </Section>
        )}

        <Section title="Flow">
          {!closed && (
            <Field label={isReview ? 'Approved work goes to' : 'Finished work goes to'} hint={isReview ? 'Where Approve moves the card.' : 'Where an agent\'s submitted work goes: a review column for people, or the next column agents work. Agents never move cards to Done.'}>
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
              <Field label="Request changes sends it back to" hint="Default: the column the agent worked in; it goes back to the same agent.">
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
          <Field label="What entering and leaving this column means" hint="Shown on the column; agents read it too.">
            <EditableText label="Policy" multiline minRows={3} value={column.policy} onSave={(v) => save({ policy: v })} placeholder="e.g. Ready means: clear acceptance criteria, links to everything needed." />
          </Field>
          {agentCapable && (
            <Field label="Instructions for agents here" hint="Sent with every card an agent takes from this column, after the board's how-we-work.">
              <EditableText label="Agent instructions" multiline minRows={4} value={column.instructions} onSave={(v) => save({ instructions: v })} placeholder="e.g. Collect sources first. Put your notes under a Research heading in the description." />
            </Field>
          )}
        </Section>
      </div>
    </Sheet>
  );
}
