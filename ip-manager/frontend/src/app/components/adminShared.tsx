/**
 * Small building blocks shared by the Settings tabs (and the Reports and
 * People pages): read-only notices, a number-chips editor, a date input
 * that speaks PocketBase dates, value formatting for audit and report
 * cells, and the digest preview.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ExternalLink, Lock, Mailbox, Plus, X } from 'lucide-react';
import { Button, Input, cn, toast } from '../../kit/index.ts';
import { op, errText } from '../lib/api.ts';
import { useLiveReload } from '../lib/live.ts';
import { d10, fmtDate, fmtDateTime } from '../lib/format.ts';
import { EmptyHint, Notice } from './ui.tsx';

/** One line explaining why controls are read-only. */
export function ReadOnlyNote({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Notice tone="neutral" icon={Lock}>
      {children}
    </Notice>
  );
}

/** Heading + body block used inside settings cards. */
export function SettingGroup({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <div className={cn('grid gap-4 border-b border-[var(--agent-app-border)] py-5 first:pt-0 last:border-0 last:pb-0 md:grid-cols-[220px_minmax(0,1fr)]', className)}>
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description !== undefined && <p className="mt-1 text-xs leading-relaxed text-[var(--agent-app-muted)]">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}

/** Editable list of whole numbers shown as chips (reminder days). */
export function NumberChips({
  value,
  onChange,
  disabled = false,
  suffix,
  max = 3650,
}: {
  value: number[];
  onChange: (v: number[]) => void;
  disabled?: boolean | undefined;
  suffix?: string | undefined;
  max?: number | undefined;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n <= 0 || n > max) {
      toast.error(`Enter a whole number from 1 to ${max}.`);
      return;
    }
    if (!value.includes(n)) onChange([...value, n].sort((a, b) => b - a));
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-[var(--agent-app-muted)]">None</span>}
        {value.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-0.5 text-xs tabular-nums">
            {n}
            {suffix !== undefined && <span className="text-[var(--agent-app-muted)]">{suffix}</span>}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${n}`}
                className="text-[var(--agent-app-muted)] hover:text-red-600"
                onClick={() => onChange(value.filter((x) => x !== n))}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex max-w-xs items-center gap-2">
          <Input
            type="number"
            min={1}
            max={max}
            value={draft}
            aria-label="Add a number"
            placeholder="Add, for example 45"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={add} disabled={draft.trim() === ''}>
            <Plus size={13} aria-hidden /> Add
          </Button>
        </div>
      )}
    </div>
  );
}

/** Native date input bound to a PocketBase date string (or ''). */
export function DateField({
  label,
  value,
  onChange,
  disabled,
  help,
}: {
  label: string;
  value: string;
  onChange: (pbDay: string) => void;
  disabled?: boolean | undefined;
  help?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Input label={label} type="date" value={d10(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {help !== undefined && <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{help}</p>}
    </div>
  );
}

/** Parse a number input; '' becomes 0. */
export function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const PB_DAY = /^\d{4}-\d{2}-\d{2} 00:00:00(\.000)?Z$/;
const PB_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

/** Human text for any stored value (audit changes, snapshots). */
export function fmtAny(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'string') {
    if (PB_DAY.test(v)) return fmtDate(v);
    if (PB_TIME.test(v)) return fmtDateTime(v);
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return 'empty';
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join(', ');
    return JSON.stringify(v);
  }
  return JSON.stringify(v);
}

/* ------------------------------------------------------------------ */
/* Digest preview (Reports page and My account)                        */
/* ------------------------------------------------------------------ */

export interface DigestSection {
  title: string;
  items: string[];
  link: string;
}

export interface DigestResponse {
  sections: DigestSection[];
  text: string;
  counts: { overdue: number; soon: number; sections: number };
}

export function DigestPreview({ compact = false }: { compact?: boolean | undefined }): React.JSX.Element {
  const [data, setData] = useState<DigestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  // Once shown, the preview follows the data it summarizes.
  useLiveReload(
    ['deadlines', 'inbox_items', 'renewals', 'watch_hits', 'approvals', 'disclosures', 'saved_views', 'settings'],
    () => {
      op<DigestResponse>('digest/preview', {})
        .then(setData)
        .catch(() => undefined);
    },
    data !== null,
  );
  const load = async (): Promise<void> => {
    setBusy(true);
    try {
      setData(await op<DigestResponse>('digest/preview', {}));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  if (data === null) {
    return (
      <div className={cn('flex flex-wrap items-center justify-between gap-3', compact ? '' : 'py-2')}>
        <p className="max-w-md text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
          See what your daily digest contains right now: overdue items, deadlines coming up, and what waits for review.
        </p>
        <Button variant="outline" size="sm" loading={busy} onClick={() => void load()}>
          <Mailbox size={14} aria-hidden /> Preview my digest
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs tabular-nums text-[var(--agent-app-muted)]">
          {data.counts.overdue} overdue, {data.counts.soon} coming up in the next 45 days
        </p>
        <Button variant="ghost" size="sm" loading={busy} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {data.sections.length === 0 ? (
        <EmptyHint compact icon={Mailbox} title="Nothing needs attention" message="Your digest would be empty today, so it would not be sent." />
      ) : (
        <div className="flex flex-col gap-4">
          {data.sections.map((s) => (
            <div key={s.title}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  {s.title} <span className="font-normal tabular-nums">{s.items.length}</span>
                </h4>
                {s.link !== '' && (
                  <a href={s.link} className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--agent-app-accent)] hover:underline">
                    Open <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </div>
              <ul className="flex flex-col border border-[var(--agent-app-border)]">
                {s.items.map((it, i) => (
                  <li key={i} className="border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 text-[13px] last:border-0">
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
