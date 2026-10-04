/**
 * Shared pieces of the licensing desk: the stage lists, reviewer decision
 * chips, reply-due labels, image picking, small form fields and helpers
 * used by the products, approvals and royalties pages.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RecordModel } from 'pocketbase';
import { Check, ImagePlus, Package, X } from 'lucide-react';
import { Input, Select, cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, fmtMoney, fmtShort } from '../lib/format.ts';
import { enumLabel, t, tf, tn } from '../lib/i18n.ts';
import type { Tone } from '../lib/labels.ts';
import type { AgreementRec, ApprovalRec, ProductRec, SettingsRec } from '../lib/records.ts';
import type { ApprovalReviewer, StageTemplate } from '../lib/shapes.ts';
import { Dot, Field, TONE_BG, TONE_TEXT } from './ui.tsx';
import { DeleteButton } from './deleteRecord.tsx';

export type ApprovalStage = Exclude<ApprovalRec['stage'], ''>;
export type ApprovalStatus = Exclude<ApprovalRec['status'], ''>;
export type ProductStage = Exclude<ProductRec['stage'], ''>;
export type Decision = ApprovalReviewer['decision'];
export type ReviewerKind = ApprovalReviewer['kind'];

/** Approval (監修) stages in the order a product moves through them. */
export const APPROVAL_STAGES: readonly ApprovalStage[] = [
  'proposal',
  'concept',
  'design',
  'color_proof',
  'prototype',
  'pre_production_sample',
  'final_sample',
  'packaging',
  'advertising',
  'mass_production_check',
];

/** A product's life from the licensee's idea to the last sell-off day. */
export const PRODUCT_STAGES: readonly ProductStage[] = [
  'proposal',
  'contract',
  'concept',
  'design',
  'prototype',
  'final_sample',
  'packaging',
  'mass_production',
  'on_sale',
  'sell_off',
  'ended',
  'cancelled',
];

/** Moving here needs an approved final sample (or a forced move with a reason). */
export const NEEDS_FINAL_SAMPLE: readonly ProductStage[] = ['mass_production', 'on_sale'];

/** Still in play: waiting on reviewers or on the licensee. */
export function isOpenApproval(status: string): boolean {
  return status === 'submitted' || status === 'in_review' || status === 'changes_requested';
}

/** Waiting on reviewers (the reply clock is running). */
export function awaitingReviewers(status: string): boolean {
  return status === 'submitted' || status === 'in_review';
}

export function isOverdue(a: Pick<ApprovalRec, 'status' | 'due_date'>): boolean {
  const due = d10(a.due_date);
  return awaitingReviewers(a.status) && due !== '' && daysUntil(due) < 0;
}

/** The record of the two that changed last (a realtime copy or the one an action returned). */
export function newest<T extends RecordModel>(a: T | null, b: T | null): T | null {
  if (a === null) return b;
  if (b === null) return a;
  return String(b['updated'] ?? '') > String(a['updated'] ?? '') ? b : a;
}

/** A to-one expand, typed. */
export function expandOne<T>(r: RecordModel, key: string): T | null {
  const v: unknown = r.expand?.[key];
  return v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
}

export function agreementLabel(a: Pick<AgreementRec, 'ref' | 'title'>): string {
  return `${a.ref} ${a.title}`.trim();
}

/** Parse a number typed into a text field ('' and junk are 0). */
export function numOf(s: string): number {
  const n = Number(s.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function numStr(n: number | null | undefined): string {
  return n === null || n === undefined || n === 0 ? '' : String(n);
}

/** Money with its currency; an empty string for nothing. */
export function money(n: number | null | undefined, currency: string): string {
  return n === null || n === undefined || n === 0 ? '' : fmtMoney(n, currency);
}

/* ------------------------------------------------------------------ */
/* Reviewers and decisions                                             */
/* ------------------------------------------------------------------ */

export const DECISION_TONE: Record<Decision, Tone> = {
  pending: 'neutral',
  approved: 'good',
  changes: 'warn',
  rejected: 'bad',
  deemed_approved: 'good',
  deemed_refused: 'bad',
};

export function decisionLabel(d: Decision): string {
  switch (d) {
    case 'approved':
      return t('Approved');
    case 'changes':
      return t('Changes requested');
    case 'rejected':
      return t('Rejected|approval');
    case 'deemed_approved':
      return t('Deemed approved');
    case 'deemed_refused':
      return t('Deemed refused');
    default:
      return t('Pending|decision');
  }
}

export function reviewerKindLabel(kind: ReviewerKind): string {
  switch (kind) {
    case 'internal':
      return t('Licensing team');
    case 'committee':
      return t('Committee member');
    case 'original':
      return t('Original author');
    case 'talent':
      return t('Talent');
    case 'reviewer':
      return t('Reviewer');
    default:
      return kind;
  }
}

export function reviewerName(r: ApprovalReviewer): string {
  return tf(r, 'label') || reviewerKindLabel(r.kind);
}

function DecisionIcon({ d }: { d: Decision }): React.JSX.Element {
  if (d === 'approved' || d === 'deemed_approved') return <Check size={11} strokeWidth={3} aria-hidden className="shrink-0" />;
  if (d === 'rejected' || d === 'deemed_refused') return <X size={11} strokeWidth={3} aria-hidden className="shrink-0" />;
  if (d === 'changes') return <span aria-hidden className="w-[11px] shrink-0 text-center text-[11px] font-bold leading-none">!</span>;
  return <Dot tone="neutral" />;
}

/** One reviewer with their answer: check approved, ! changes, x rejected, a dot while pending. */
export function ReviewerChip({ r, className }: { r: ApprovalReviewer; className?: string | undefined }): React.JSX.Element {
  const tone = DECISION_TONE[r.decision] ?? 'neutral';
  const name = reviewerName(r);
  const label = t('{name}: {decision}', { name, decision: decisionLabel(r.decision) });
  return (
    <span
      title={label}
      aria-label={label}
      className={cn('inline-flex min-w-0 max-w-full items-center gap-1 px-1.5 py-px text-[11px] font-medium', TONE_BG[tone], TONE_TEXT[tone], className)}
    >
      <DecisionIcon d={r.decision} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function ReviewerChips({ reviewers, className }: { reviewers: ApprovalReviewer[] | null; className?: string | undefined }): React.JSX.Element | null {
  const list = reviewers ?? [];
  if (list.length === 0) return null;
  return (
    <div className={cn('flex min-w-0 flex-wrap gap-1', className)}>
      {list.map((r) => (
        <ReviewerChip key={r.key} r={r} className="max-w-[11rem]" />
      ))}
    </div>
  );
}

/** "3 days left", "2 days overdue", or the plain date once the reply is in. */
export function ReplyDue({ a, className, withDate = true }: { a: Pick<ApprovalRec, 'status' | 'due_date'>; className?: string | undefined; withDate?: boolean | undefined }): React.JSX.Element | null {
  const due = d10(a.due_date);
  if (due === '') return null;
  let tone: Tone | null = null;
  let rel = '';
  if (awaitingReviewers(a.status)) {
    const n = daysUntil(due);
    if (n < 0) {
      tone = 'bad';
      rel = tn(-n, '{n} day overdue', '{n} days overdue');
    } else if (n === 0) {
      tone = 'warn';
      rel = t('Due today');
    } else {
      tone = n <= 2 ? 'warn' : null;
      rel = tn(n, '{n} day left', '{n} days left');
    }
  }
  return (
    <span className={cn('whitespace-nowrap text-xs tabular-nums', tone !== null ? TONE_TEXT[tone] : 'text-[var(--agent-app-muted)]', className)} title={t('Reply due {date}', { date: fmtDate(due) })}>
      {withDate || rel === '' ? t('Due {date}', { date: fmtShort(due) }) : ''}
      {withDate && rel !== '' ? ' · ' : ''}
      {rel}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stage templates                                                     */
/* ------------------------------------------------------------------ */

/** The licence's approval stages, else the organization's, else every stage. */
export function stageTemplates(agreement: AgreementRec | null, settings: SettingsRec | null): StageTemplate[] {
  const own = (agreement?.approval_stages ?? []).filter((s) => s && typeof s.key === 'string' && s.key !== '');
  if (own.length > 0) return own;
  const org = (settings?.approval_stages ?? []).filter((s) => s && typeof s.key === 'string' && s.key !== '');
  if (org.length > 0) return org;
  return APPROVAL_STAGES.map((k) => ({ key: k, label: '', reviewers: ['internal'] }));
}

export function stageName(tpl: StageTemplate): string {
  return tf(tpl, 'label') || enumLabel('approvals.stage', tpl.key);
}

/** Working days the reviewers have, in the server's order of precedence. */
export function slaDays(agreement: AgreementRec | null, tpl: StageTemplate | undefined, settings: SettingsRec | null): number {
  if (agreement !== null && agreement.approval_sla_days > 0) return agreement.approval_sla_days;
  if (tpl !== undefined && Number(tpl.sla_days) > 0) return Number(tpl.sla_days);
  return settings?.approval_sla_days || 5;
}

/* ------------------------------------------------------------------ */
/* Rights dimension values for selects                                 */
/* ------------------------------------------------------------------ */

/** The most specific values of a dimension (groups such as "All categories" are left out). */
export function useDimOptions(dimension: string, current?: string | undefined): { value: string; label: string }[] {
  const { dimValues, dimLabel } = useApp();
  return useMemo(() => {
    const values = dimValues.filter((v) => v.dimension === dimension);
    const parents = new Set(values.map((v) => v.parent_code).filter((c) => c !== ''));
    const opts = values.filter((v) => !parents.has(v.code)).map((v) => ({ value: v.code, label: dimLabel(dimension, v.code) }));
    if (current !== undefined && current !== '' && !opts.some((o) => o.value === current)) opts.push({ value: current, label: dimLabel(dimension, current) });
    return opts;
  }, [dimValues, dimLabel, dimension, current]);
}

/* ------------------------------------------------------------------ */
/* Form pieces                                                         */
/* ------------------------------------------------------------------ */

export function DateField({
  label,
  value,
  onChange,
  help,
  required = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode | undefined;
  required?: boolean | undefined;
  error?: string | undefined;
}): React.JSX.Element {
  return (
    <Field label={label} help={help} required={required} error={error}>
      <Input type="date" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  help,
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string | undefined;
  help?: ReactNode | undefined;
  min?: number | undefined;
  step?: number | undefined;
}): React.JSX.Element {
  return (
    <Field label={label} help={help}>
      <div className="flex min-w-0 items-center gap-2">
        <Input type="number" inputMode="decimal" aria-label={label} value={value} min={min} step={step ?? 'any'} onChange={(e) => onChange(e.target.value)} className="tabular-nums" />
        {suffix !== undefined && suffix !== '' && <span className="shrink-0 font-mono text-xs text-[var(--agent-app-muted)]">{suffix}</span>}
      </div>
    </Field>
  );
}

/** Pick several values from a known list; the picks show as removable chips. */
export function ChipMultiSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  options: { value: string; label: string }[];
  onChange: (v: string[]) => void;
  placeholder?: string | undefined;
}): React.JSX.Element {
  const names = new Map(options.map((o) => [o.value, o.label]));
  const rest = options.filter((o) => !value.includes(o.value));
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-0.5 text-xs">
              <span className="truncate">{names.get(id) ?? id}</span>
              <button type="button" aria-label={t('Remove')} className="text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => onChange(value.filter((x) => x !== id))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <Select
        aria-label={label}
        value=""
        placeholder={rest.length === 0 ? t('Nothing more to add') : (placeholder ?? t('Add'))}
        options={rest}
        disabled={rest.length === 0}
        onChange={(e) => {
          const v = e.target.value;
          if (v !== '' && !value.includes(v)) onChange([...value, v]);
        }}
      />
    </div>
  );
}

/** Choose images to send with a submission or a decision (up to 10). */
export function ImagePicker({ files, onChange, label, help }: { files: File[]; onChange: (f: File[]) => void; label: string; help?: string | undefined }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null): void => {
    if (list === null) return;
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/'));
    onChange([...files, ...picked].slice(0, 10));
  };
  return (
    <Field label={label} help={help ?? t('Images, up to 10 files and 20 MB each.')}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') input.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          'flex items-center justify-center gap-2 border border-dashed px-3 py-4 text-center text-[13px] text-[var(--agent-app-muted)]',
          drag ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]',
        )}
      >
        <ImagePlus size={16} aria-hidden className="shrink-0" /> {t('Drop images here or click to choose')}
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 border border-[var(--agent-app-border)] px-2 py-0.5 text-xs">
              <span className="truncate">{f.name}</span>
              <button type="button" aria-label={t('Remove')} className="text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </Field>
  );
}

/** A record image: a thumbnail that opens full size, or a file link when it is not an image. */
export function RecordImage({ src, full, alt, className }: { src: string; full: string; alt: string; className?: string | undefined }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  return (
    <a href={full} target="_blank" rel="noreferrer" title={t('Open full size in a new tab')} className={cn('block', className)}>
      {broken ? (
        <span className="flex aspect-square w-full items-center justify-center border border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/25 text-[var(--agent-app-muted)]">
          <Package size={18} aria-hidden />
        </span>
      ) : (
        <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className="aspect-square w-full border border-[var(--agent-app-border)] object-cover" />
      )}
    </a>
  );
}

/** A small heading inside a drawer or panel. */
export function SubHead({ children, right }: { children: ReactNode; right?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{children}</h3>
      {right}
    </div>
  );
}

/**
 * A row's trash icon. The delete dialog is rendered inside the row, and React
 * passes its clicks and key presses up the component tree, so they are
 * stopped here before they reach a clickable row.
 */
export function RowDelete({ collection, id, onDeleted, label }: { collection: string; id: string; onDeleted?: (() => void) | undefined; label?: string | undefined }): React.JSX.Element {
  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DeleteButton collection={collection} id={id} onDeleted={onDeleted} label={label} iconOnly />
    </span>
  );
}

/** Common time zones for sales windows (IANA names). */
export const TIME_ZONES = ['Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Bangkok', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Paris', 'UTC'];
