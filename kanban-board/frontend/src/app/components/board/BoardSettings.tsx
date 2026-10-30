/**
 * Board settings: how we work (the standing instructions the agent receives
 * with every card), freezing the board for the agent, swimlanes; the columns and their
 * contracts; labels; and rules (When, If, Then; a rule's actions never set
 * off other rules, and a looping rule switches itself off).
 */
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Snowflake, Trash2, Zap } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { BoardDetail, LabelColor, Rule } from '../../lib/types.ts';
import { CategoryIcon, LabelDot, PRIORITY_LABEL } from '../marks.tsx';
import { AgentAvatar, Button, Chip, EditableText, Empty, Field, IconButton, Popover, Row, Section, Segmented, Select, Sheet, Tabs, Toggle, errMessage, useConfirm } from '../ui.tsx';

type Tab = 'general' | 'columns' | 'labels' | 'rules';
const COLORS: LabelColor[] = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

export function BoardSettings({ d, onClose, onOpenColumn }: { d: BoardDetail; onClose: () => void; onOpenColumn: (id: string) => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('general');
  const [confirmEl, confirm] = useConfirm();
  const b = d.board;
  const save = (p: Parameters<typeof api.updateBoard>[1]): void => {
    api.updateBoard(b.id, p).catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <Sheet open onClose={onClose} width={560} title="Board settings" subtitle={`${b.name} · ${b.key}`}>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="-mt-2 mb-4"
        options={[
          { value: 'general', label: 'General' },
          { value: 'columns', label: `Columns · ${d.columns.length}` },
          { value: 'labels', label: `Labels · ${d.labels.length}` },
          { value: 'rules', label: `Rules · ${d.rules}` },
        ]}
      />
      {tab === 'general' && (
        <div className="flex flex-col gap-6">
          <Section title="Board">
            <Field label="Name">
              <EditableText label="Board name" value={b.name} onSave={(v) => v.trim() !== '' && save({ name: v.trim() })} />
            </Field>
            <div className="grid grid-cols-[120px_1fr] gap-3">
              <Field label="Key" hint="Card ids: KEY-12">
                <EditableText label="Key" value={b.key} onSave={(v) => v.trim() !== '' && save({ key: v.trim().toUpperCase() })} />
              </Field>
              <Field label="Description">
                <EditableText label="Description" value={b.description} onSave={(v) => save({ description: v })} placeholder="What this board is for" />
              </Field>
            </div>
          </Section>
          <Section title="How we work">
            <p className="text-[12px] leading-4 text-[var(--kb-muted)]">Standing instructions the agent receives with every card on this board: your conventions, tone, what to avoid. Written instructions make the agent much more reliable.</p>
            <EditableText label="How we work" multiline minRows={7} value={b.instructions} onSave={(v) => save({ instructions: v })} placeholder="How we work on this board…" />
          </Section>
          <Section title="Agent">
            <Row
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Snowflake size={14} aria-hidden className="text-[var(--kb-blue)]" /> Freeze the board
                </span>
              }
              hint="The agent can read it but change nothing (no claims, moves, edits or comments) until you unfreeze it."
            >
              <Toggle label="Freeze the board" checked={b.frozen} onChange={(v) => save({ frozen: v })} />
            </Row>
          </Section>
          <Section title="Layout">
            <Row label="Swimlanes" hint="Rows by assignee (you, the agent, unassigned) or by priority.">
              <Segmented size="sm" label="Swimlanes" value={b.swimlanes} onChange={(v) => save({ swimlanes: v })} options={[{ value: 'none', label: 'None' }, { value: 'assignee', label: 'Assignee' }, { value: 'priority', label: 'Priority' }]} />
            </Row>
          </Section>
          <Section title="Danger zone">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                icon={Trash2}
                onClick={() =>
                  void (async () => {
                    if (!(await confirm(`"${b.name}" with its ${d.cards.length + d.archived_cards} cards, columns, rules and activity is deleted for good.`, 'Delete this board?'))) return;
                    try {
                      await api.deleteBoard(b.id);
                      onClose();
                      navigate('board');
                    } catch (err) {
                      toast.error(errMessage(err));
                    }
                  })()
                }
              >
                Delete board
              </Button>
            </div>
          </Section>
        </div>
      )}
      {tab === 'columns' && (
        <div className="flex flex-col gap-1">
          {d.columns.map((c, i) => (
            <div key={c.id} className="group flex h-11 items-center gap-2.5 rounded-[var(--kb-radius-sm)] px-2 hover:bg-[var(--kb-main-hover)]">
              <CategoryIcon category={c.category} />
              <button type="button" onClick={() => onOpenColumn(c.id)} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:underline">
                {c.name}
              </button>
              {c.agent && (
                <Chip tone="neutral" title="The agent works this column">
                  <AgentAvatar size={14} /> Agent
                </Chip>
              )}
              {c.wip > 0 && <span className="kb-num text-[12px] text-[var(--kb-muted)]">WIP {c.wip}</span>}
              <IconButton icon={ArrowUp} label="Move up" size={26} disabled={i === 0} onClick={() => api.moveColumn(c.id, i - 1).catch((err: unknown) => toast.error(errMessage(err)))} />
              <IconButton icon={ArrowDown} label="Move down" size={26} disabled={i === d.columns.length - 1} onClick={() => api.moveColumn(c.id, i + 1).catch((err: unknown) => toast.error(errMessage(err)))} />
            </div>
          ))}
          <div className="mt-2">
            <Button icon={Plus} onClick={() => api.addColumn(b.id, { name: 'New column', category: 'todo' }).then((r) => onOpenColumn(r.column.id)).catch((err: unknown) => toast.error(errMessage(err)))}>
              Add column
            </Button>
          </div>
        </div>
      )}
      {tab === 'labels' && <Labels d={d} />}
      {tab === 'rules' && <Rules d={d} />}
      {confirmEl}
    </Sheet>
  );
}

function Labels({ d }: { d: BoardDetail }): React.JSX.Element {
  const [name, setName] = useState('');
  const add = (): void => {
    if (name.trim() === '') return;
    api
      .saveLabel({ board: d.board.id, name: name.trim(), color: COLORS[(d.labels.length + 1) % COLORS.length] })
      .then(() => setName(''))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className="flex flex-col gap-1">
      {d.labels.map((l) => (
        <LabelRow key={l.id} id={l.id} name={l.name} color={l.color} />
      ))}
      <div className="mt-2 flex gap-2">
        <input aria-label="New label" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="New label" className="kb-field h-8 flex-1 px-2.5 text-[13px]" />
        <Button icon={Plus} onClick={add} disabled={name.trim() === ''}>
          Add
        </Button>
      </div>
    </div>
  );
}

function LabelRow({ id, name, color }: { id: string; name: string; color: LabelColor }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="group flex h-10 items-center gap-2 rounded-[var(--kb-radius-sm)] px-1 hover:bg-[var(--kb-main-hover)]">
      <button ref={btn} type="button" aria-label="Colour" onClick={() => setOpen((o) => !o)} className="flex size-7 items-center justify-center rounded-[var(--kb-radius-sm)] hover:bg-[var(--kb-active)]">
        <LabelDot color={color} size={10} />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)}>
        <div className="flex gap-1 p-1">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={c} onClick={() => (setOpen(false), void api.saveLabel({ label: id, color: c }).catch((err: unknown) => toast.error(errMessage(err))))} className={cn('flex size-7 items-center justify-center rounded-full', c === color && 'ring-2 ring-[var(--kb-ink)]')}>
              <LabelDot color={c} size={14} />
            </button>
          ))}
        </div>
      </Popover>
      <EditableText label="Label name" value={name} onSave={(v) => v.trim() !== '' && void api.saveLabel({ label: id, name: v.trim() }).catch((err: unknown) => toast.error(errMessage(err)))} className="h-7 flex-1 border-transparent bg-transparent hover:border-[var(--kb-line)]" />
      <IconButton icon={Trash2} label="Remove label" tone="danger" size={26} onClick={() => api.removeLabel(id).catch((err: unknown) => toast.error(errMessage(err)))} />
    </div>
  );
}

const WHEN_LABEL: Record<string, string> = {
  enters_column: 'a card enters',
  created: 'a card is created',
  checklist_done: 'its checklist is complete',
  approved: 'a review is approved',
  changes_requested: 'changes are requested',
  needs_attention: 'a card needs attention',
  blocked: 'a card is flagged blocked',
  idle: 'a card sits untouched for',
  due_soon: 'a card is due within',
};

const ACTION_LABEL: Record<string, string> = {
  move: 'Move it to',
  assign: 'Assign it to',
  priority: 'Set priority',
  label: 'Add label',
  unlabel: 'Remove label',
  request_review: 'Send it for your review',
  block: 'Flag it blocked',
  comment: 'Comment',
  archive: 'Archive it',
};

function sentence(r: Rule, d: BoardDetail): string {
  const col = d.columns.find((c) => c.id === r.column)?.name ?? '';
  const when = r.when === 'enters_column' ? `When a card enters ${col}` : r.when === 'idle' || r.when === 'due_soon' ? `When ${WHEN_LABEL[r.when]} ${r.days} days` : `When ${WHEN_LABEL[r.when] ?? r.when}`;
  const ifs: string[] = [];
  if ((r.conditions.priority ?? []).length > 0) ifs.push('priority is ' + (r.conditions.priority ?? []).map((p) => PRIORITY_LABEL[p]?.toLowerCase()).join(' or '));
  if ((r.conditions.labels ?? []).length > 0) ifs.push('labeled ' + (r.conditions.labels ?? []).map((l) => d.labels.find((x) => x.id === l)?.name ?? 'a removed label').join(' or '));
  if (r.conditions.assignee !== undefined && r.conditions.assignee !== '') ifs.push('assigned to ' + (r.conditions.assignee === 'agent' ? 'the agent' : r.conditions.assignee === 'none' ? 'nobody' : 'you'));
  const then = r.actions
    .map((a) => {
      if (a.do === 'move') return 'move it to ' + (d.columns.find((c) => c.id === a['column'])?.name ?? '?');
      if (a.do === 'assign') return 'assign it to ' + (a['to'] === 'you' ? 'you' : a['to'] === 'agent' ? 'the agent' : 'nobody');
      if (a.do === 'priority') return 'set priority ' + (PRIORITY_LABEL[Number(a['value'])] ?? '').toLowerCase();
      if (a.do === 'label' || a.do === 'unlabel') return (a.do === 'label' ? 'add ' : 'remove ') + (d.labels.find((l) => l.id === a['label'])?.name ?? 'a label');
      if (a.do === 'request_review') return 'send it for your review';
      if (a.do === 'block') return 'flag it blocked';
      if (a.do === 'comment') return 'comment';
      return 'archive it';
    })
    .join(', then ');
  return `${when}${ifs.length > 0 ? ', if ' + ifs.join(' and ') : ''}: ${then}.`;
}

function Rules({ d }: { d: BoardDetail }): React.JSX.Element {
  const live = useLive(() => api.rules(d.board.id), ['rules'], [d.board.id]);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const rules = live.data?.rules ?? [];
  if (editing !== null) return <RuleEditor d={d} rule={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-4 text-[var(--kb-muted)]">Rules act on cards as things happen: When, If, Then. A rule's own actions never set off other rules, and a rule that runs 5 times on one card within 10 minutes switches itself off. To have the agent pick cards up, let it work the column instead (column settings).</p>
      {rules.length === 0 ? (
        <Empty icon={Zap} title="No rules yet">
          For example: when a card&apos;s checklist is complete, send it for your review.
        </Empty>
      ) : (
        rules.map((r) => (
          <div key={r.id} className="flex items-start gap-3 rounded-[var(--kb-radius)] border border-[var(--kb-hair)] bg-[var(--kb-card)] p-3">
            <Zap size={15} aria-hidden className={cn('mt-0.5 shrink-0', r.enabled ? 'text-[var(--kb-accent)]' : 'text-[var(--kb-faint)]')} />
            <button type="button" onClick={() => setEditing(r)} className="min-w-0 flex-1 text-left">
              <div className="text-[13px] font-medium">{r.name || 'Rule'}</div>
              <div className="mt-0.5 text-[12.5px] leading-[18px] text-[var(--kb-ink-2)]">{sentence(r, d)}</div>
              <div className="mt-1 text-[11.5px] text-[var(--kb-muted)]">{r.paused_reason !== '' ? <span className="text-[var(--kb-red)]">{r.paused_reason}</span> : r.runs > 0 ? `Ran ${r.runs} time${r.runs === 1 ? '' : 's'}` : 'Has not run yet'}</div>
            </button>
            <Toggle label="On" checked={r.enabled} onChange={(v) => api.saveRule({ rule: r.id, enabled: v }).catch((err: unknown) => toast.error(errMessage(err)))} />
            <IconButton icon={Trash2} label="Remove rule" tone="danger" size={26} onClick={() => api.removeRule(r.id).catch((err: unknown) => toast.error(errMessage(err)))} />
          </div>
        ))
      )}
      <div>
        <Button icon={Plus} onClick={() => setEditing('new')}>
          New rule
        </Button>
      </div>
    </div>
  );
}

interface Draft {
  name: string;
  when: string;
  column: string;
  days: number;
  priority: number[];
  labels: string[];
  assignee: string;
  actions: { do: string; [k: string]: unknown }[];
}

function RuleEditor({ d, rule, onDone }: { d: BoardDetail; rule: Rule | null; onDone: () => void }): React.JSX.Element {
  const [r, setR] = useState<Draft>(() => ({
    name: rule?.name ?? '',
    when: rule?.when ?? 'enters_column',
    column: rule?.column ?? d.columns.find((c) => c.category === 'review')?.id ?? d.columns[0]?.id ?? '',
    days: rule?.days || 3,
    priority: rule?.conditions.priority ?? [],
    labels: rule?.conditions.labels ?? [],
    assignee: rule?.conditions.assignee ?? '',
    actions: rule?.actions ?? [{ do: 'priority', value: 2 }],
  }));
  const [busy, setBusy] = useState(false);
  const setAction = (i: number, a: { do: string; [k: string]: unknown }): void => setR({ ...r, actions: r.actions.map((x, j) => (j === i ? a : x)) });
  const blank = (kind: string): { do: string; [k: string]: unknown } => {
    if (kind === 'move') return { do: 'move', column: d.columns[0]?.id ?? '' };
    if (kind === 'assign') return { do: 'assign', to: 'you' };
    if (kind === 'priority') return { do: 'priority', value: 2 };
    if (kind === 'label' || kind === 'unlabel') return { do: kind, label: d.labels[0]?.id ?? '' };
    if (kind === 'block') return { do: 'block', reason: 'Blocked by a rule' };
    if (kind === 'comment') return { do: 'comment', text: '' };
    return { do: kind };
  };
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.saveRule({
        ...(rule !== null ? { rule: rule.id } : { board: d.board.id }),
        name: r.name,
        when: r.when,
        column: r.when === 'enters_column' ? r.column : '',
        days: r.days,
        conditions: { priority: r.priority, labels: r.labels, assignee: r.assignee },
        actions: r.actions,
      });
      onDone();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const agentOptions = (
    <>
      <option value="you">You</option>
      <option value="agent">The agent</option>
    </>
  );
  return (
    <div className="flex flex-col gap-5">
      <Field label="Name">
        <input aria-label="Rule name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Urgent reviews first" className="kb-field h-8 px-2.5 text-[13px]" />
      </Field>
      <Section title="When">
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="When" value={r.when} onChange={(e) => setR({ ...r, when: e.target.value })} className="w-auto min-w-[220px]">
            {Object.keys(WHEN_LABEL).map((k) => (
              <option key={k} value={k}>
                {WHEN_LABEL[k]}
              </option>
            ))}
          </Select>
          {r.when === 'enters_column' && (
            <Select aria-label="Column" value={r.column} onChange={(e) => setR({ ...r, column: e.target.value })} className="w-auto min-w-[160px]">
              {d.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {(r.when === 'idle' || r.when === 'due_soon') && (
            <span className="inline-flex items-center gap-1.5">
              <input aria-label="Days" value={r.days} onChange={(e) => setR({ ...r, days: Number(e.target.value) || 1 })} className="kb-field h-8 w-16 px-2 text-right text-[13px]" />
              days
            </span>
          )}
        </div>
      </Section>
      <Section title="If (optional)">
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 0].map((p) => (
            <button key={p} type="button" aria-pressed={r.priority.includes(p)} onClick={() => setR({ ...r, priority: r.priority.includes(p) ? r.priority.filter((x) => x !== p) : [...r.priority, p] })} className={cn('h-7 rounded-full px-2.5 text-[12px] ring-1 ring-inset', r.priority.includes(p) ? 'bg-[var(--kb-ink)] text-[var(--kb-main)] ring-[var(--kb-ink)]' : 'text-[var(--kb-ink-2)] ring-[var(--kb-line)] hover:bg-[var(--kb-main-hover)]')}>
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
        {d.labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {d.labels.map((l) => (
              <button key={l.id} type="button" aria-pressed={r.labels.includes(l.id)} onClick={() => setR({ ...r, labels: r.labels.includes(l.id) ? r.labels.filter((x) => x !== l.id) : [...r.labels, l.id] })} className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] ring-1 ring-inset', r.labels.includes(l.id) ? 'bg-[var(--kb-ink)] text-[var(--kb-main)] ring-[var(--kb-ink)]' : 'text-[var(--kb-ink-2)] ring-[var(--kb-line)] hover:bg-[var(--kb-main-hover)]')}>
                <LabelDot color={l.color} size={7} /> {l.name}
              </button>
            ))}
          </div>
        )}
        <Select aria-label="Assigned to" value={r.assignee} onChange={(e) => setR({ ...r, assignee: e.target.value })} className="w-auto min-w-[200px]">
          <option value="">Whoever it is assigned to</option>
          <option value="you">Assigned to you</option>
          <option value="agent">Assigned to the agent</option>
          <option value="none">Unassigned</option>
        </Select>
      </Section>
      <Section title="Then">
        {r.actions.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label="Action" value={a.do} onChange={(e) => setAction(i, blank(e.target.value))} className="w-auto min-w-[190px]">
              {Object.keys(ACTION_LABEL).map((k) => (
                <option key={k} value={k}>
                  {ACTION_LABEL[k]}
                </option>
              ))}
            </Select>
            {a.do === 'move' && (
              <Select aria-label="Column" value={String(a['column'] ?? '')} onChange={(e) => setAction(i, { ...a, column: e.target.value })} className="w-auto min-w-[150px]">
                {d.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            {a.do === 'assign' && (
              <Select aria-label="Assignee" value={String(a['to'] ?? '')} onChange={(e) => setAction(i, { ...a, to: e.target.value })} className="w-auto min-w-[150px]">
                {agentOptions}
              </Select>
            )}
            {a.do === 'priority' && (
              <Select aria-label="Priority" value={String(a['value'] ?? 2)} onChange={(e) => setAction(i, { ...a, value: Number(e.target.value) })} className="w-auto min-w-[130px]">
                {[1, 2, 3, 4, 0].map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
            {(a.do === 'label' || a.do === 'unlabel') && (
              <Select aria-label="Label" value={String(a['label'] ?? '')} onChange={(e) => setAction(i, { ...a, label: e.target.value })} className="w-auto min-w-[130px]">
                {d.labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
            {(a.do === 'comment' || a.do === 'block') && <input aria-label={a.do === 'comment' ? 'Comment' : 'Reason'} value={String(a[a.do === 'comment' ? 'text' : 'reason'] ?? '')} onChange={(e) => setAction(i, { ...a, [a.do === 'comment' ? 'text' : 'reason']: e.target.value })} placeholder={a.do === 'comment' ? 'Comment text' : 'Reason'} className="kb-field h-8 min-w-[180px] flex-1 px-2.5 text-[13px]" />}
            {r.actions.length > 1 && <IconButton icon={Trash2} label="Remove action" size={26} onClick={() => setR({ ...r, actions: r.actions.filter((_, j) => j !== i) })} />}
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setR({ ...r, actions: [...r.actions, blank('assign')] })}>
            Add action
          </Button>
        </div>
      </Section>
      <div className="flex gap-2 border-t border-[var(--kb-hair)] pt-4">
        <Button variant="primary" busy={busy} onClick={() => void submit()}>
          {rule === null ? 'Create rule' : 'Save rule'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
