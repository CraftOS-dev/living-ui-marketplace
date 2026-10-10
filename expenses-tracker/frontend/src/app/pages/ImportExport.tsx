/**
 * Bank or card statements in (CSV), your data out (CSV). The import shows
 * exactly what will be added before anything is written, skips what is
 * already there, and can be undone.
 */
import { useRef, useState } from 'react';
import { Download, FileUp, RotateCcw, Sparkles } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { DropZone } from '../components/DropZone.tsx';
import { Card, CardHeader, PageHeader, PillButton, PillSelect, StatusPill, TextLink, Toggle, softInput, useConfirm } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';
import { api, download } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addMonths, ago, thisMonth, today } from '../lib/dates.ts';
import { useLive } from '../lib/live.ts';
import { money } from '../lib/money.ts';
import type { ImportPreview, PlannedStatus } from '../lib/types.ts';

const STATUS: Record<PlannedStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'good' },
  duplicate: { label: 'Already here', tone: 'neutral' },
  not_expense: { label: 'Money in', tone: 'neutral' },
  empty: { label: 'No amount', tone: 'neutral' },
  invalid: { label: 'Unreadable', tone: 'bad' },
};

const FORMAT_WORDS: Record<string, string> = {
  'YYYY-MM-DD': 'Year-Month-Day',
  'YYYY/MM/DD': 'Year/Month/Day',
  'YYYY.MM.DD': 'Year.Month.Day',
  'DD/MM/YYYY': 'Day/Month/Year',
  'MM/DD/YYYY': 'Month/Day/Year',
  'DD-MM-YYYY': 'Day-Month-Year',
  'MM-DD-YYYY': 'Month-Day-Year',
  'DD.MM.YYYY': 'Day.Month.Year',
  'DD/MM/YY': 'Day/Month/YY',
  'MM/DD/YY': 'Month/Day/YY',
  'DD-MM-YY': 'Day-Month-YY',
  'DD.MM.YY': 'Day.Month.YY',
  'D MMM YYYY': '5 Oct 2026',
  'MMM D YYYY': 'Oct 5, 2026',
  YYYYMMDD: 'YearMonthDay',
};

function lastDay(month: string): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}

type Choice = string | boolean;

function ImportBox(): React.JSX.Element {
  const { currency } = useApp();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  // Choices made but not yet reflected in a preview, shown in their controls meanwhile.
  const [pending, setPending] = useState<Record<string, Choice>>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const seq = useRef(0);
  const session = useRef<string | null>(null);
  const settling = Object.keys(pending).length > 0;

  const show = (next: ImportPreview | null): void => {
    session.current = next?.import_id ?? null;
    seq.current += 1;
    setPending({});
    setPreview(next);
  };
  const start = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (f === undefined) return;
    setBusy(true);
    try {
      show(await api.previewUpload(f));
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  // Only the changed choice is sent; the app remembers the rest from the last
  // preview. Changes go one at a time, in the order made, so each starts from
  // the choices the one before saved and a slow reply never undoes a later one.
  const change = (key: string, value: Choice): void => {
    const id = session.current;
    if (id === null) return;
    const mine = ++seq.current;
    setPending((p) => ({ ...p, [key]: value }));
    queue.current = queue.current.then(async () => {
      let next: ImportPreview | null = null;
      try {
        next = await api.preview(id, { [key]: value });
      } catch {
        /* toasted */
      }
      if (session.current !== id) return;
      if (next !== null) setPreview(next);
      // The last change answered: every choice is in the preview now (or, after an error, back to what the app has).
      if (mine === seq.current) setPending({});
    });
  };
  const run = async (): Promise<void> => {
    if (preview === null || settling) return;
    setBusy(true);
    try {
      const r = await api.runImport(preview.import_id, {});
      toast.success(r.message);
      show(null);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };

  if (preview === null) {
    return (
      <div className="flex flex-col gap-3">
        <DropZone icon={FileUp} title="Choose a CSV file" hint="Exported from your bank or card. Nothing is added until you confirm." accept=".csv,.txt,text/csv,text/plain" busy={busy} onFiles={(f) => void start(f)} />
        <p className="flex items-center gap-2 px-1 text-[12px] text-[var(--et-ink-2)]">
          <Sparkles size={13} aria-hidden /> Or give the file to your AI agent in chat and it imports it for you.
        </p>
      </div>
    );
  }

  const m = preview.mapping;
  const col = (v: number | null): string => (v === null ? 'none' : String(v));
  const shown = (key: string, saved: string): string => {
    const v = pending[key];
    return typeof v === 'string' ? v : saved;
  };
  const header = typeof pending['has_header'] === 'boolean' ? pending['has_header'] : preview.has_header;
  const columns = (optional: boolean): { value: string; label: string }[] => [
    ...(optional ? [{ value: 'none', label: 'None' }] : []),
    ...preview.columns.map((c) => ({ value: String(c.index), label: preview.has_header || c.samples[0] === undefined ? c.name : `${c.name}: ${c.samples[0].slice(0, 14)}` })),
  ];
  const formats = [...new Set([...(m.date_format !== null ? [m.date_format] : []), ...preview.date_formats])];
  const c = preview.counts;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[14px] font-bold">{preview.filename}</p>
        <TextLink tone="muted" onClick={() => show(null)}>
          Choose another file
        </TextLink>
      </div>

      <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4', busy && 'opacity-60')}>
        <PillSelect soft label="Date" value={shown('date_column', col(m.date_column))} onChange={(v) => change('date_column', v)} options={columns(false)} />
        <PillSelect soft label="Amount spent" value={shown('amount_column', col(m.amount_column))} onChange={(v) => change('amount_column', v)} options={columns(false)} />
        <PillSelect soft label="Description" value={shown('note_column', col(m.note_column))} onChange={(v) => change('note_column', v)} options={columns(true)} />
        <PillSelect soft label="Category" value={shown('category_column', col(m.category_column))} onChange={(v) => change('category_column', v)} options={columns(true)} />
        <PillSelect
          soft
          label="Date format"
          value={shown('date_format', m.date_format ?? '')}
          onChange={(v) => change('date_format', v)}
          options={formats.length > 0 ? formats.map((f) => ({ value: f, label: FORMAT_WORDS[f] ?? f })) : [{ value: '', label: 'No dates found' }]}
        />
        <PillSelect
          soft
          label="Spending is"
          value={shown('expenses_are', m.expenses_are)}
          onChange={(v) => change('expenses_are', v)}
          options={[
            { value: 'negative', label: 'Negative amounts' },
            { value: 'positive', label: 'Positive amounts' },
            { value: 'all', label: 'All amounts' },
          ]}
        />
        <PillSelect
          soft
          label="Decimal mark"
          value={shown('decimal', m.decimal)}
          onChange={(v) => change('decimal', v)}
          options={[
            { value: '.', label: '1,234.50' },
            { value: ',', label: '1.234,50' },
          ]}
        />
        <div className="flex flex-col gap-2">
          <span className="px-1 text-[13px] font-semibold text-[var(--et-ink-2)]">First row is names</span>
          <div className="flex h-11 items-center px-1">
            <Toggle checked={header} onChange={(v) => change('has_header', v)} label="First row is column names" />
          </div>
        </div>
      </div>

      <div className={cn('flex flex-col gap-5 transition-opacity', settling && 'opacity-60')} aria-busy={settling}>
        {preview.date_format_ambiguous && (
          <p className="rounded-[18px] bg-[var(--et-accent)]/30 px-4 py-3 text-[13px] font-semibold">
            Dates like 03/04 can be read either way. Check the dates below and change the date format if they are wrong.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="good">
            {c.new} new · {money(preview.total_minor, currency)}
          </StatusPill>
          {c.duplicate > 0 && <StatusPill tone="neutral">{c.duplicate} already here</StatusPill>}
          {c.not_expense > 0 && <StatusPill tone="neutral">{c.not_expense} money in, skipped</StatusPill>}
          {c.empty > 0 && <StatusPill tone="neutral">{c.empty} without an amount</StatusPill>}
          {c.invalid > 0 && <StatusPill tone="bad">{c.invalid} unreadable</StatusPill>}
          {preview.new_categories.length > 0 && <span className="text-[12px] text-[var(--et-ink-2)]">New categories: {preview.new_categories.join(', ')}</span>}
        </div>

        <div className="overflow-x-auto rounded-[20px] bg-[var(--et-row)]">
          <table className="w-full min-w-[36rem] text-left text-[13px]">
            <thead>
              <tr className="text-[12px] text-[var(--et-muted)]">
                <th className="px-4 pb-2 pt-3 font-semibold">Line</th>
                <th className="px-4 pb-2 pt-3 font-semibold">Date</th>
                <th className="px-4 pb-2 pt-3 font-semibold">Description</th>
                <th className="px-4 pb-2 pt-3 font-semibold">Category</th>
                <th className="px-4 pb-2 pt-3 text-right font-semibold">Amount</th>
                <th className="px-4 pb-2 pt-3 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 30).map((r) => (
                <tr key={r.line} className={cn('border-t border-[var(--et-line)]', r.status !== 'new' && 'text-[var(--et-muted)]')}>
                  <td className="num px-4 py-2">{r.line}</td>
                  <td className="num whitespace-nowrap px-4 py-2">{r.date ?? ''}</td>
                  <td className="max-w-[16rem] truncate px-4 py-2 font-semibold">{r.note}</td>
                  <td className="px-4 py-2">{r.category ?? ''}</td>
                  <td className="num px-4 py-2 text-right font-semibold">{r.amount ?? ''}</td>
                  <td className="px-4 py-2" title={r.problem}>
                    <StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.rows.length > 30 && <p className="px-1 text-[12px] text-[var(--et-muted)]">Showing the first 30 of {c.rows} rows.</p>}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <PillButton variant="light" className="bg-[var(--et-row)]" onClick={() => show(null)}>
          Cancel
        </PillButton>
        <PillButton variant="dark" icon={FileUp} dot loading={busy || settling} disabled={c.new === 0} onClick={() => void run()}>
          {c.new === 0 ? 'Nothing new to import' : `Import ${c.new} ${c.new === 1 ? 'expense' : 'expenses'}`}
        </PillButton>
      </div>
    </div>
  );
}

function History(): React.JSX.Element | null {
  const list = useLive(() => api.imports(), ['imports'], []);
  const [confirmEl, confirm] = useConfirm();
  const items = list.data?.imports ?? [];
  if (items.length === 0) return null;
  const undo = async (id: string, added: number): Promise<void> => {
    if (!(await confirm(`The ${added} ${added === 1 ? 'expense' : 'expenses'} it added are deleted, including any you edited since.`, 'Undo this import?', 'Undo'))) return;
    try {
      const r = await api.undoImport(id);
      toast.success(`${r.removed} removed`);
    } catch {
      /* toasted */
    }
  };
  return (
    <Card delay={2}>
      <CardHeader title="Past imports" />
      <div className="flex flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--et-row)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold">{i.filename}</span>
              <span className="block text-[12px] text-[var(--et-muted)]">
                {ago(i.created)} · {i.added} added · {i.skipped} skipped
              </span>
            </div>
            {i.status === 'undone' ? (
              <StatusPill tone="neutral">Undone</StatusPill>
            ) : (
              <PillButton variant="light" icon={RotateCcw} className="h-9 px-4" onClick={() => void undo(i.id, i.added)}>
                Undo
              </PillButton>
            )}
          </div>
        ))}
      </div>
      {confirmEl}
    </Card>
  );
}

function ExportBox(): React.JSX.Element {
  const [range, setRange] = useState('this_month');
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(today());
  const [busy, setBusy] = useState(false);
  const bounds = (): [string, string] => {
    const t = today();
    const m = thisMonth();
    switch (range) {
      case 'last_month':
        return [`${addMonths(m, -1)}-01`, lastDay(addMonths(m, -1))];
      case 'this_year':
        return [`${t.slice(0, 4)}-01-01`, t];
      case 'last_12':
        return [`${addMonths(m, -11)}-01`, t];
      case 'all':
        return ['1970-01-01', t];
      case 'custom':
        return [from, to];
      default:
        return [`${m}-01`, t];
    }
  };
  const go = async (): Promise<void> => {
    const [f, e] = bounds();
    setBusy(true);
    try {
      const r = await api.exportCsv(f, e);
      if (r.rows === 0) toast.info('No expenses in that range');
      else download(r.filename, r.content);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <PillSelect
        soft
        label="Range"
        value={range}
        onChange={setRange}
        className="w-52"
        options={[
          { value: 'this_month', label: 'This month' },
          { value: 'last_month', label: 'Last month' },
          { value: 'this_year', label: 'This year' },
          { value: 'last_12', label: 'Last 12 months' },
          { value: 'all', label: 'Everything' },
          { value: 'custom', label: 'Choose dates' },
        ]}
      />
      {range === 'custom' && (
        <>
          <label className="flex flex-col gap-2">
            <span className="px-1 text-[13px] font-semibold text-[var(--et-ink-2)]">From</span>
            <input type="date" value={from} onChange={(e) => e.target.value !== '' && setFrom(e.target.value)} className={softInput} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="px-1 text-[13px] font-semibold text-[var(--et-ink-2)]">To</span>
            <input type="date" value={to} onChange={(e) => e.target.value !== '' && setTo(e.target.value)} className={softInput} />
          </label>
        </>
      )}
      <PillButton variant="dark" icon={Download} dot loading={busy} onClick={() => void go()}>
        Download CSV
      </PillButton>
    </div>
  );
}

export function ImportExportPage(): React.JSX.Element {
  return (
    <div>
      <PageHeader title="Import and export" subtitle="Bring in bank statements, take your data with you." />
      <div className="flex flex-col gap-5">
        <Card delay={1}>
          <CardHeader title="Import a statement" subtitle="CSV from your bank or card" />
          <ImportBox />
        </Card>
        <History />
        <Card delay={3}>
          <CardHeader title="Export" subtitle="Every expense in a range, as a CSV file" />
          <ExportBox />
        </Card>
      </div>
    </div>
  );
}
