/**
 * The books, shown plainly: the journal lines an action will post (account,
 * debit, credit, with totals), and a confirm step that previews them before
 * anything is posted or voided. Advanced detail stays one tap away; the
 * plain sentence comes first.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, BookOpen, ChevronDown } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import type { OpName, Params } from '../lib/api.ts';
import { amount, money } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { JournalPreviewLine } from '../lib/types.ts';
import { DateField } from './pickers.tsx';
import { Field, Modal, Notice, PillButton, Skeleton } from './ui.tsx';

/** Journal lines as a small table: account, debit, credit, and the totals. */
export function JournalLines({ lines, currency, dark = false, compact = false }: { lines: JournalPreviewLine[]; currency: string; dark?: boolean | undefined; compact?: boolean | undefined }): React.JSX.Element {
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  const muted = dark ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]';
  return (
    <>
      {/* Phones: one block per line, the amount on the right with its side. */}
      <ul className={cn('flex flex-col gap-1 rounded-[18px] p-2 @min-[640px]:hidden', dark ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-row)]')}>
        {lines.map((l, i) => (
          <li key={i} className="flex items-start justify-between gap-3 rounded-[12px] px-2 py-1.5 text-[13px]">
            <button type="button" onClick={() => navigate('account', { id: l.account.id })} className="min-w-0 text-left">
              <span className="block font-semibold">
                <span className="num">{l.account.code}</span> {l.account.name}
              </span>
              {(l.memo !== '' || l.party !== '') && !compact && <span className={cn('block truncate text-[12px]', muted)}>{[l.party, l.memo].filter((x) => x !== '').join(' · ')}</span>}
            </button>
            <span className="shrink-0 text-right">
              <span className="num block font-bold">{amount(l.debit !== 0 ? l.debit : l.credit, currency)}</span>
              <span className={cn('block text-[12px]', muted)}>{l.debit !== 0 ? 'Debit' : 'Credit'}</span>
            </span>
          </li>
        ))}
        <li className={cn('flex justify-between gap-3 border-t px-2 pt-2 text-[13px] font-bold', dark ? 'border-[var(--erp-dark)]' : 'border-[var(--erp-line)]')}>
          <span>Debits {money(dr, currency)}</span>
          <span>Credits {money(cr, currency)}</span>
        </li>
      </ul>
    <div className={cn('hidden relative overflow-x-auto rounded-[18px] @min-[640px]:block', dark ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-row)]')}>
      <table className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr className={cn('text-left text-[12px] font-semibold', muted)}>
            <th className="px-4 pb-1.5 pt-3 font-semibold">Account</th>
            <th className="px-4 pb-1.5 pt-3 text-right font-semibold">Debit</th>
            <th className="px-4 pb-1.5 pt-3 text-right font-semibold">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td className={cn('px-4', compact ? 'py-1' : 'py-1.5')}>
                <button type="button" onClick={() => navigate('account', { id: l.account.id })} className="text-left font-semibold hover:underline">
                  <span className="num">{l.account.code}</span> {l.account.name}
                </button>
                {(l.memo !== '' || l.party !== '') && !compact && <span className={cn('block text-[12px]', muted)}>{[l.party, l.memo].filter((x) => x !== '').join(' · ')}</span>}
              </td>
              <td className={cn('num px-4 text-right', compact ? 'py-1' : 'py-1.5')}>{l.debit !== 0 ? amount(l.debit, currency) : ''}</td>
              <td className={cn('num px-4 text-right', compact ? 'py-1' : 'py-1.5')}>{l.credit !== 0 ? amount(l.credit, currency) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="px-4 pb-3 pt-2">Total</td>
            <td className="num px-4 pb-3 pt-2 text-right">{money(dr, currency)}</td>
            <td className="num px-4 pb-3 pt-2 text-right">{money(cr, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  );
}

/** "What this does to the books": collapsed by default under a plain summary. */
export function BooksDetail({ lines, currency, open: start = false, label = 'What this posts to the books' }: { lines: JournalPreviewLine[]; currency: string; open?: boolean | undefined; label?: string | undefined }): React.JSX.Element | null {
  const [open, setOpen] = useState(start);
  if (lines.length === 0) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
        <BookOpen size={14} aria-hidden />
        {label}
        <ChevronDown size={14} aria-hidden className={cn('transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div className="mt-3">
          <JournalLines lines={lines} currency={currency} />
        </div>
      )}
    </div>
  );
}

export interface PreviewResult {
  lines?: JournalPreviewLine[] | undefined;
  currency?: string | undefined;
  warning?: string | undefined;
  date?: string | undefined;
  summary?: string | undefined;
  title?: string | undefined;
  [key: string]: unknown;
}

/**
 * Confirm a posting or a void: loads the preview operation, shows the plain
 * summary, any warning and the journal lines, lets the person pick the date
 * when `withDate`, then runs the real operation. `extra` adds fields
 * (a void's reason).
 */
export function ConfirmPosting({
  open,
  onClose,
  title,
  verb,
  previewOp,
  runOp,
  params,
  withDate = false,
  defaultDate = '',
  danger = false,
  extra,
  extraParams = {},
  canRun = true,
  intro,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  verb: string;
  previewOp: OpName;
  runOp: OpName;
  params: Params;
  withDate?: boolean | undefined;
  defaultDate?: string | undefined;
  danger?: boolean | undefined;
  extra?: ReactNode | undefined;
  extraParams?: Params | undefined;
  canRun?: boolean | undefined;
  intro?: ReactNode | undefined;
  onDone?: ((result: unknown) => void) | undefined;
}): React.JSX.Element {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(params);

  useEffect(() => {
    if (!open) return;
    setDate(defaultDate);
    setPreview(null);
    setError(null);
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    op<PreviewResult>(previewOp, { ...params, ...(withDate && date !== '' ? { date } : {}) }, { quiet: true })
      .then((p) => {
        if (live) {
          setPreview(p);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, previewOp, date, withDate]);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op(runOp, { ...params, ...extraParams, ...(withDate && date !== '' ? { date } : {}) });
      onDone?.(r);
      onClose();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  const cur = preview?.currency ?? '';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant={danger ? 'danger' : 'dark'} loading={busy} disabled={preview === null || error !== null || !canRun} onClick={() => void run()}>
            {verb}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {intro}
        {withDate && (
          <Field label="Date in the books" hint="The day it counts in the accounts (a locked month moves it to the first open day)">
            <DateField value={date} onChange={setDate} ariaLabel="Date in the books" />
          </Field>
        )}
        {error !== null && (
          <Notice tone="bad" icon={AlertTriangle}>
            {error}
          </Notice>
        )}
        {preview === null && error === null && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-28" />
          </div>
        )}
        {preview !== null && (
          <>
            {typeof preview.summary === 'string' && preview.summary !== '' && <p className="text-[14px] leading-6 text-[var(--erp-ink-2)]">{preview.summary}</p>}
            {typeof preview.warning === 'string' && preview.warning !== '' && (
              <Notice tone="warn" icon={AlertTriangle}>
                {preview.warning}
              </Notice>
            )}
            {(preview.lines ?? []).length > 0 ? <JournalLines lines={preview.lines ?? []} currency={cur} /> : <p className="text-[13px] text-[var(--erp-muted)]">Nothing is posted to the accounts.</p>}
          </>
        )}
        {extra}
      </div>
    </Modal>
  );
}
