/**
 * Settings, Invention scoring: the criteria reviewers score invention
 * disclosures on, with weights and order. Managers edit.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Switch, Textarea, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { ScoringCriterionRec } from '../lib/types.ts';
import { EmptyHint, ErrorBox, Field, Loading, Notice, Section, Segmented } from './ui.tsx';
import { ReadOnlyNote } from './adminShared.tsx';

const DEFAULT_LEVELS = [
  { value: 0, label: 'None' },
  { value: 25, label: 'Low' },
  { value: 50, label: 'Moderate' },
  { value: 75, label: 'High' },
  { value: 100, label: 'Very high' },
];

const WEIGHTS = ['1', '2', '3', '4', '5'] as const;
type Weight = (typeof WEIGHTS)[number];

function keyFrom(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 34) || 'criterion';
  let k = base;
  let i = 2;
  while (taken.has(k)) k = `${base}_${i++}`;
  return k;
}

export function ScoringTab(): React.JSX.Element {
  const { can } = useApp();
  const list = useCollection<ScoringCriterionRec>('scoring_criteria', { sort: 'order,created' });
  const [editing, setEditing] = useState<ScoringCriterionRec | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const rows = list.records;
  const totalWeight = rows.filter((r) => r.enabled).reduce((s, r) => s + (r.weight || 1), 0);

  const patch = async (r: ScoringCriterionRec, data: Record<string, unknown>, msg: string): Promise<void> => {
    try {
      await updateRecord('scoring_criteria', r.id, data);
      toast.success(msg);
    } catch {
      /* the client already showed the server's message */
    }
  };

  const move = async (index: number, dir: -1 | 1): Promise<void> => {
    const other = index + dir;
    if (other < 0 || other >= rows.length) return;
    setBusy(true);
    try {
      // Renumber everything so equal or missing order values cannot stall a move.
      const next = rows.slice();
      const a = next[index];
      const b = next[other];
      if (a === undefined || b === undefined) return;
      next[index] = b;
      next[other] = a;
      for (let i = 0; i < next.length; i++) {
        const r = next[i];
        if (r !== undefined && r.order !== i) await updateRecord('scoring_criteria', r.id, { order: i });
      }
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: ScoringCriterionRec): Promise<void> => {
    if (!(await confirm(`Delete "${r.label}"? Scores already given keep their totals; new reviews no longer ask for it. To stop using it but keep it, switch it off instead.`, 'Delete criterion?'))) return;
    try {
      await deleteRecord('scoring_criteria', r.id);
      toast.success(`${r.label} deleted`);
    } catch {
      /* the client already showed the server's message */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {confirmEl}
      {!can.manage && <ReadOnlyNote>Only admins and IP managers can change the scoring criteria.</ReadOnlyNote>}
      <Notice tone="neutral" icon={SlidersHorizontal}>
        Each reviewer rates every switched-on criterion from None to Very high (0 to 100). A review's score is the weighted average, so a criterion with weight 3 counts three times as much as one with weight 1. The invention's score is the average of its reviews.
      </Notice>
      <Section
        title="Scoring criteria"
        meta={list.loading ? undefined : `${rows.filter((r) => r.enabled).length} in use, total weight ${totalWeight}`}
        flush
        actions={
          can.manage ? (
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              <Plus size={13} aria-hidden /> Add criterion
            </Button>
          ) : undefined
        }
      >
        {list.loading ? (
          <Loading />
        ) : list.error !== null ? (
          <div className="p-4">
            <ErrorBox message={list.error} onRetry={list.refresh} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyHint
            compact
            icon={SlidersHorizontal}
            title="No criteria"
            message="Reviewers need at least one criterion to score inventions."
            action={can.manage ? <Button size="sm" onClick={() => setEditing('new')}>Add criterion</Button> : undefined}
          />
        ) : (
          <div>
            {rows.map((r, i) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0">
                {can.manage && (
                  <div className="flex flex-col">
                    <button type="button" aria-label={`Move ${r.label} up`} disabled={busy || i === 0} onClick={() => void move(i, -1)} className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)] disabled:opacity-30">
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" aria-label={`Move ${r.label} down`} disabled={busy || i === rows.length - 1} onClick={() => void move(i, 1)} className="text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)] disabled:opacity-30">
                      <ArrowDown size={14} />
                    </button>
                  </div>
                )}
                <div className={`min-w-0 flex-1 basis-60 ${r.enabled ? '' : 'opacity-60'}`}>
                  <div className="text-sm font-medium">{r.label}</div>
                  {r.description !== '' && <div className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{r.description}</div>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wider text-[var(--agent-app-muted)]">Weight</span>
                    {can.manage ? (
                      <Segmented<Weight>
                        size="sm"
                        ariaLabel={`Weight of ${r.label}`}
                        value={(WEIGHTS as readonly string[]).includes(String(r.weight)) ? (String(r.weight) as Weight) : '1'}
                        onChange={(v) => void patch(r, { weight: Number(v) }, `${r.label} weight set to ${v}`)}
                        options={WEIGHTS.map((w) => ({ value: w, label: w }))}
                      />
                    ) : (
                      <span className="text-sm tabular-nums">{r.weight}</span>
                    )}
                  </div>
                  <Switch checked={r.enabled} disabled={!can.manage} onCheckedChange={(v) => void patch(r, { enabled: v }, `${r.label} ${v ? 'switched on' : 'switched off'}`)} />
                  {can.manage && (
                    <span className="flex gap-0.5">
                      <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Edit ${r.label}`} onClick={() => setEditing(r)}>
                        <Pencil size={13} aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Delete ${r.label}`} onClick={() => void remove(r)}>
                        <Trash2 size={13} aria-hidden />
                      </Button>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      {editing !== null && (
        <CriterionDialog
          criterion={editing === 'new' ? null : editing}
          taken={new Set(rows.map((r) => r.key))}
          nextOrder={rows.reduce((m, r) => Math.max(m, r.order), -1) + 1}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CriterionDialog({ criterion, taken, nextOrder, onClose }: { criterion: ScoringCriterionRec | null; taken: Set<string>; nextOrder: number; onClose: () => void }): React.JSX.Element {
  const [label, setLabel] = useState(criterion?.label ?? '');
  const [description, setDescription] = useState(criterion?.description ?? '');
  const [weight, setWeight] = useState<Weight>(criterion !== null && (WEIGHTS as readonly string[]).includes(String(criterion.weight)) ? (String(criterion.weight) as Weight) : '2');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (label.trim() === '') return;
    setBusy(true);
    try {
      if (criterion === null) {
        await createRecord('scoring_criteria', {
          key: keyFrom(label, taken),
          label: label.trim(),
          description: description.trim(),
          weight: Number(weight),
          order: nextOrder,
          levels: DEFAULT_LEVELS,
          enabled: true,
        });
        toast.success(`${label.trim()} added`);
      } else {
        await updateRecord('scoring_criteria', criterion.id, { label: label.trim(), description: description.trim(), weight: Number(weight) });
        toast.success('Criterion saved');
      }
      onClose();
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={criterion === null ? 'Add a scoring criterion' : `Edit ${criterion.label}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={label.trim() === ''} onClick={() => void save()}>
            {criterion === null ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="Name" autoFocus value={label} placeholder="For example: Fit with the product roadmap" onChange={(e) => setLabel(e.target.value)} />
        <Textarea label="What reviewers should consider" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <Field label="Weight" help="1 counts least, 5 counts most.">
          <div>
            <Segmented<Weight> ariaLabel="Weight" value={weight} onChange={setWeight} options={WEIGHTS.map((w) => ({ value: w, label: w }))} />
          </div>
        </Field>
        {criterion === null && <p className="text-xs text-[var(--agent-app-muted)]">Reviewers choose None, Low, Moderate, High or Very high.</p>}
      </div>
    </Dialog>
  );
}
