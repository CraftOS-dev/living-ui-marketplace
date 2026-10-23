/**
 * Pieces the Projects screens share: a project's color, the words and
 * tones of project, task and time states, and the add/edit project form.
 */
import { useEffect, useState } from 'react';
import { Check, FolderPlus } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import type { Params } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { minorToText } from '../../lib/format.ts';
import type { Billing, ProjectDetail, ProjectStatus, TimeStatus } from '../../lib/types/work.ts';
import { Segmented } from '../controls.tsx';
import { DateField, EmployeePicker, MoneyInput, PartyPicker } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Field, Modal, Notice, PillButton, PillSelect, softArea, softInput } from '../ui.tsx';
import type { Tone } from '../ui.tsx';

/** The eight project colors, all from the theme. */
const COLORS = ['var(--erp-seg-0)', 'var(--erp-seg-1)', 'var(--erp-seg-2)', 'var(--erp-seg-3)', 'var(--erp-seg-4)', 'var(--erp-accent)', 'var(--erp-ink-2)', 'var(--erp-seg-other)'];

const TEXTS = ['var(--erp-seg-0-text)', 'var(--erp-seg-1-text)', 'var(--erp-seg-2-text)', 'var(--erp-seg-3-text)', 'var(--erp-seg-4-text)', 'var(--erp-on-accent)', 'var(--erp-card)', 'var(--erp-seg-other-text)'];

export function projectColor(n: number): string {
  return COLORS[((n % 8) + 8) % 8] ?? 'var(--erp-accent)';
}

/** The text color that reads on a project color. */
export function projectColorText(n: number): string {
  return TEXTS[((n % 8) + 8) % 8] ?? 'var(--erp-on-accent)';
}

export const PROJECT_STATE: Record<ProjectStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'good' },
  on_hold: { label: 'On hold', tone: 'warn' },
  done: { label: 'Done', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const TIME_STATE: Record<TimeStatus | 'mixed' | 'empty', { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  invoiced: { label: 'Billed', tone: 'info' },
  mixed: { label: 'Mixed', tone: 'neutral' },
  empty: { label: 'Nothing logged', tone: 'neutral' },
};

export const BILLING_LABEL: Record<Billing, string> = {
  time_materials: 'Time and materials',
  fixed: 'Fixed price',
  non_billable: 'Internal',
};

/** A small round color mark. */
export function ColorDot({ color, size = 10 }: { color: number; size?: number | undefined }): React.JSX.Element {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: projectColor(color) }} />;
}

/* ----------------------------------------------------------------- form */

interface Form {
  name: string;
  code: string;
  customer: Option | null;
  manager: Option | null;
  billing: Billing;
  rate: string;
  budget: string;
  start: string;
  end: string;
  color: number;
  status: ProjectStatus;
  description: string;
}

function fromProject(p: ProjectDetail | null, currency: string, color: number): Form {
  return {
    name: p?.name ?? '',
    code: p?.code ?? '',
    customer: p !== null && p.customer !== null ? { id: p.customer.id, label: p.customer.name, value: p.customer.id } : null,
    manager: p !== null && p.manager !== null ? { id: p.manager.id, label: p.manager.name, value: p.manager.id } : null,
    billing: p?.billing ?? 'time_materials',
    rate: p !== null && p.rate !== 0 ? p.rate_text : '',
    budget: p !== null && p.budget !== 0 ? minorToText(p.budget, currency) : '',
    start: p?.start ?? today(),
    end: p?.end ?? '',
    color: p?.color ?? color,
    status: p?.status ?? 'active',
    description: p?.description ?? '',
  };
}

/**
 * Add a project, or change one. The common path is a name, a customer and
 * how it is billed; the rest has sensible defaults.
 */
export function ProjectForm({
  project,
  currency,
  inline = false,
  open = true,
  onClose,
  onSaved,
}: {
  project: ProjectDetail | null;
  currency: string;
  inline?: boolean | undefined;
  open?: boolean | undefined;
  onClose: () => void;
  onSaved: (p: ProjectDetail) => void;
}): React.JSX.Element {
  const [f, setF] = useState<Form>(() => fromProject(project, currency, Math.floor(Math.random() * 8)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF(fromProject(project, currency, Math.floor(Math.random() * 8)));
      setError(null);
    }
  }, [open, project, currency]);
  const set = <K extends keyof Form>(k: K, v: Form[K]): void => setF((x) => ({ ...x, [k]: v }));
  const adding = project === null;

  const save = async (): Promise<void> => {
    if (f.name.trim() === '') {
      setError('A project needs a name.');
      return;
    }
    setBusy(true);
    setError(null);
    const p: Params = {
      name: f.name.trim(),
      customer: f.customer?.id ?? (adding ? undefined : 'none'),
      manager: f.manager?.id ?? (adding ? undefined : 'none'),
      billing: f.billing,
      rate: f.billing === 'time_materials' ? (f.rate === '' ? '0' : f.rate) : undefined,
      budget: f.budget === '' ? '0' : f.budget,
      start: f.start === '' ? (adding ? undefined : 'none') : f.start,
      end: f.end === '' ? (adding ? undefined : 'none') : f.end,
      color: f.color,
      description: f.description.trim(),
    };
    if (!adding) {
      p['status'] = f.status;
      if (f.code.trim() !== '' && f.code.trim() !== project.code) p['code'] = f.code.trim();
    } else if (f.code.trim() !== '') p['code'] = f.code.trim();
    try {
      const r = adding ? await op<ProjectDetail>('projects.add', p, { quiet: true }) : await op<ProjectDetail>('projects.update', { project: project.id, ...p }, { quiet: true });
      toast.success(adding ? `${r.code} added` : 'Saved');
      onClose();
      onSaved(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-[1fr_140px]">
        <Field label="Name">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} aria-label="Project name" autoFocus={adding} placeholder="e.g. Website rebuild" className={softInput} />
        </Field>
        <Field label="Code" optional hint={adding ? 'Automatic when empty' : undefined}>
          <input value={f.code} onChange={(e) => set('code', e.target.value)} aria-label="Project code" className={cn(softInput, 'num')} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">
        <Field label="Customer" optional>
          <PartyPicker value={f.customer} onChange={(o) => set('customer', o)} role="customer" clearable placeholder="Internal project" />
        </Field>
        <Field label="Project manager" optional>
          <EmployeePicker value={f.manager} onChange={(o) => set('manager', o)} clearable placeholder="Nobody yet" />
        </Field>
      </div>
      <Field label="Billing">
        <Segmented
          ariaLabel="Billing"
          value={f.billing}
          onChange={(v) => set('billing', v)}
          options={[
            { value: 'time_materials', label: 'By the hour' },
            { value: 'fixed', label: 'Fixed price' },
            { value: 'non_billable', label: 'Internal' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">
        {f.billing === 'time_materials' && (
          <Field label={`Rate per hour (${currency})`} hint="Billed for approved time">
            <MoneyInput value={f.rate} onChange={(v) => set('rate', v)} currency={currency} ariaLabel="Rate per hour" decimals={4} />
          </Field>
        )}
        <Field label={f.billing === 'fixed' ? `Price and budget (${currency})` : `Budget (${currency})`} optional hint="Costs and time cost count against it">
          <MoneyInput value={f.budget} onChange={(v) => set('budget', v)} currency={currency} ariaLabel="Budget" />
        </Field>
        <Field label="Start" optional>
          <DateField value={f.start} onChange={(v) => set('start', v)} ariaLabel="Start" optional placeholder="Not set" />
        </Field>
        <Field label="End" optional>
          <DateField value={f.end} onChange={(v) => set('end', v)} ariaLabel="End" optional placeholder="Not set" min={f.start !== '' ? f.start : undefined} align="right" />
        </Field>
        {!adding && (
          <PillSelect
            soft
            label="Status"
            value={f.status}
            onChange={(v) => set('status', v as ProjectStatus)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'on_hold', label: 'On hold' },
              { value: 'done', label: 'Done' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        )}
      </div>
      <Field label="Color">
        <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={f.color === i}
              aria-label={`Color ${i + 1}`}
              onClick={() => set('color', i)}
              className={cn('flex size-9 items-center justify-center rounded-full transition-transform active:scale-90', f.color === i && 'ring-2 ring-[var(--erp-ink)] ring-offset-2 ring-offset-[var(--erp-shell)]')}
              style={{ background: projectColor(i) }}
            >
              {f.color === i && <Check size={14} strokeWidth={3} style={{ color: projectColorText(i) }} aria-hidden />}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Description" optional>
        <textarea value={f.description} onChange={(e) => set('description', e.target.value)} aria-label="Description" className={cn(softArea, 'min-h-[64px]')} />
      </Field>
      {error !== null && <Notice tone="bad">{error}</Notice>}
    </div>
  );

  if (inline) {
    return (
      <div className="flex flex-col gap-4">
        {body}
        <div className="flex justify-end gap-2">
          <PillButton loading={busy} onClick={() => void save()}>
            Save changes
          </PillButton>
        </div>
      </div>
    );
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={adding ? 'New project' : `Edit ${project.name}`}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={FolderPlus} dot={adding} loading={busy} onClick={() => void save()}>
            {adding ? 'Add project' : 'Save'}
          </PillButton>
        </>
      }
    >
      {body}
    </Modal>
  );
}
