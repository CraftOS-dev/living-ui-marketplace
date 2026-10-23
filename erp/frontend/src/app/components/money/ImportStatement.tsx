/**
 * Import a bank statement: drop the CSV the bank gives you, check the
 * columns the app found (and correct any), see the first lines read the
 * way they will be imported, then import. Lines already here are skipped,
 * so importing an overlapping statement twice is safe. An import can be
 * undone from the Imports tab.
 */
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { AlertTriangle, Check, FileUp, RefreshCw, Upload } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { errMessage, op, opForm } from '../../lib/api.ts';
import { dayLabel, shortDay } from '../../lib/dates.ts';
import type { Bank, ImportPreview } from '../../lib/types/money.ts';
import { Segmented } from '../controls.tsx';
import { ScreenBar } from '../FullScreen.tsx';
import { Notice, PillButton, PillSelect, Skeleton, StatusPill, Toggle } from '../ui.tsx';
import { Signed } from './bits.tsx';
import { Step } from './Step.tsx';

const FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'MM-DD-YYYY', 'DD.MM.YYYY', 'YYYY/MM/DD', 'YYYY.MM.DD', 'DD/MM/YY', 'MM/DD/YY', 'DD-MM-YY', 'DD.MM.YY', 'D MMM YYYY', 'MMM D YYYY', 'YYYYMMDD'];

type ColKey = 'date_col' | 'amount_col' | 'debit_col' | 'credit_col' | 'description_col' | 'reference_col';

export function ImportStatement({ bank, onClose, onDone }: { bank: Bank; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<'read' | 'adjust' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const read = async (f: File): Promise<void> => {
    setFile(f);
    setPreview(null);
    setError(null);
    setBusy('read');
    try {
      setPreview(await opForm<ImportPreview>('bank.import-preview', { bank: bank.id }, { file: f }, { quiet: true }));
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const mappingParams = (p: ImportPreview, change: Partial<Record<ColKey, number | null>> & { date_format?: string; decimal?: string; flip?: boolean; has_header?: boolean }): Record<string, string | number | boolean> => {
    const m = { ...p.mapping, ...change };
    const col = (v: number | null | undefined): number => (v === null || v === undefined ? -1 : v);
    return {
      date_col: col(m.date_col),
      amount_col: col(m.amount_col),
      debit_col: col(m.debit_col),
      credit_col: col(m.credit_col),
      description_col: col(m.description_col),
      reference_col: col(m.reference_col),
      date_format: m.date_format,
      decimal: m.decimal,
      flip: m.flip,
      has_header: m.has_header,
    };
  };

  const adjust = async (change: Parameters<typeof mappingParams>[1]): Promise<void> => {
    if (preview === null) return;
    setBusy('adjust');
    setError(null);
    try {
      setPreview(await op<ImportPreview>('bank.import-preview', { bank: bank.id, import_id: preview.import_id, ...mappingParams(preview, change) }, { quiet: true }));
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const run = async (): Promise<void> => {
    if (preview === null) return;
    setBusy('run');
    try {
      const r = await op<{ added: number; skipped: number; duplicates: number; invalid: number }>('bank.import-run', { import_id: preview.import_id, ...mappingParams(preview, {}) });
      toast.success(`${r.added} ${r.added === 1 ? 'line' : 'lines'} imported${r.skipped > 0 ? `, ${r.skipped} skipped` : ''}`);
      onDone();
      onClose();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f !== undefined) void read(f);
  };

  const p = preview;
  const split = p !== null && p.mapping.amount_col === null;
  const colOptions = (p?.columns ?? []).map((c) => ({ value: String(c.index), label: `${c.name}${c.sample[0] !== undefined && c.sample[0] !== '' ? `  (${c.sample[0].slice(0, 24)})` : ''}` }));
  const withNone = [{ value: '-1', label: 'None' }, ...colOptions];
  const colValue = (v: number | null): string => (v === null ? '-1' : String(v));
  const setCol = (k: ColKey, v: string): void => void adjust({ [k]: v === '-1' ? null : Number(v) });
  const formats = [...new Set([...(p?.date_formats ?? []), p?.mapping.date_format ?? '', ...FORMATS].filter((x) => x !== ''))];

  const s1 = p !== null ? 'done' : 'current';
  const s2 = p === null ? 'todo' : 'done';
  const s3 = p === null ? 'todo' : 'current';

  return (
    <div className="pb-12">
      <ScreenBar title="Import a statement" sub={`Into ${bank.name} (${bank.currency})`} onClose={onClose} />
      <div className="mx-auto w-full max-w-[1180px] px-4 @min-[640px]:px-8">
        <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] min-[1100px]:gap-5">
          <div className="flex min-w-0 flex-col gap-4 min-[1100px]:gap-5">
            <Step n={1} state={s1} title="The statement file" delay={1}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                className={cn('flex flex-col items-center gap-3 rounded-[22px] border-2 border-dashed px-5 py-8 text-center transition-colors', drag ? 'border-[var(--erp-ink)] bg-[var(--erp-accent-soft)]' : 'border-[var(--erp-line)] bg-[var(--erp-row)]')}
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-[var(--erp-card)]">
                  <FileUp size={20} aria-hidden />
                </span>
                {file !== null ? (
                  <span>
                    <span className="block text-[14px] font-bold">{file.name}</span>
                    <span className="block text-[12px] text-[var(--erp-muted)]">{p !== null ? `${p.counts.total} rows${p.date_from !== '' ? `, ${shortDay(p.date_from)} to ${shortDay(p.date_to)}` : ''}` : busy === 'read' ? 'Reading' : ''}</span>
                  </span>
                ) : (
                  <span>
                    <span className="block text-[14px] font-bold">Drop the CSV your bank gave you</span>
                    <span className="block text-[12px] text-[var(--erp-muted)]">Most banks export one from online banking</span>
                  </span>
                )}
                <PillButton variant="light" size="sm" icon={Upload} loading={busy === 'read'} onClick={() => input.current?.click()}>
                  {file !== null ? 'Choose another file' : 'Choose a file'}
                </PillButton>
                <input
                  ref={input}
                  type="file"
                  accept=".csv,text/csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f !== undefined) void read(f);
                    e.target.value = '';
                  }}
                />
              </div>
              {error !== null && (
                <div className="mt-3">
                  <Notice tone="bad" icon={AlertTriangle}>
                    {error}
                  </Notice>
                </div>
              )}
            </Step>

            <Step n={2} state={s2} title="How to read it" delay={2} hint={busy === 'adjust' ? 'Reading again' : p !== null ? 'Found by the app' : undefined}>
              {p === null ? (
                <p className="text-[13px] text-[var(--erp-muted)]">The app finds the date, amount and description columns. Correct any here.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <PillSelect soft label="Date" value={colValue(p.mapping.date_col)} onChange={(v) => setCol('date_col', v)} options={colOptions} />
                  <Segmented
                    ariaLabel="Amounts"
                    value={split ? 'split' : 'one'}
                    onChange={(v) => {
                      if (v === 'one') {
                        const pick = p.mapping.credit_col ?? p.mapping.debit_col ?? p.columns.find((c) => c.kind === 'amount')?.index ?? 0;
                        void adjust({ amount_col: pick, debit_col: null, credit_col: null });
                      } else {
                        const amounts = p.columns.filter((c) => c.kind === 'amount').map((c) => c.index);
                        void adjust({ amount_col: null, debit_col: amounts[0] ?? 0, credit_col: amounts[1] ?? amounts[0] ?? 0 });
                      }
                    }}
                    options={[
                      { value: 'one', label: 'One amount column' },
                      { value: 'split', label: 'Money in and out apart' },
                    ]}
                    className="w-full"
                  />
                  {split ? (
                    <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
                      <PillSelect soft label="Money out" value={colValue(p.mapping.debit_col)} onChange={(v) => setCol('debit_col', v)} options={colOptions} />
                      <PillSelect soft label="Money in" value={colValue(p.mapping.credit_col)} onChange={(v) => setCol('credit_col', v)} options={colOptions} />
                    </div>
                  ) : (
                    <PillSelect soft label="Amount" value={colValue(p.mapping.amount_col)} onChange={(v) => setCol('amount_col', v)} options={colOptions} />
                  )}
                  <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
                    <PillSelect soft label="Description" value={colValue(p.mapping.description_col)} onChange={(v) => setCol('description_col', v)} options={withNone} />
                    <PillSelect soft label="Reference" value={colValue(p.mapping.reference_col)} onChange={(v) => setCol('reference_col', v)} options={withNone} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
                    <PillSelect soft label="Dates look like" value={p.mapping.date_format} onChange={(v) => void adjust({ date_format: v })} options={formats.map((f) => ({ value: f, label: f }))} />
                    <PillSelect
                      soft
                      label="Numbers look like"
                      value={p.mapping.decimal}
                      onChange={(v) => void adjust({ decimal: v })}
                      options={[
                        { value: '.', label: '1,234.56' },
                        { value: ',', label: '1.234,56' },
                      ]}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <SwitchRow title="Money in shows as negative" text="Turn on when the bank writes deposits with a minus" checked={p.mapping.flip} onChange={(v) => void adjust({ flip: v })} />
                    <SwitchRow title="The first row is a header" text="Column names, not a transaction" checked={p.mapping.has_header} onChange={(v) => void adjust({ has_header: v })} />
                  </div>
                </div>
              )}
            </Step>
          </div>

          <Step n={3} state={s3} title="Check and import" delay={3}>
            {p === null ? (
              busy === 'read' ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : (
                <p className="text-[13px] text-[var(--erp-muted)]">The first lines show here, read the way they will be imported.</p>
              )
            ) : (
              <div className={cn('flex flex-1 flex-col gap-4', busy === 'adjust' && 'pointer-events-none')}>
                <div className="grid grid-cols-3 gap-2">
                  <Count label="New lines" value={p.counts.new} tone="ink" />
                  <Count label="Already here" value={p.counts.duplicate} tone="muted" />
                  <Count label="Cannot read" value={p.counts.invalid} tone={p.counts.invalid > 0 ? 'bad' : 'muted'} />
                </div>
                {p.counts.new > 0 && (
                  <p className="text-[13px] text-[var(--erp-ink-2)]">
                    <Signed minor={p.money_in} currency={p.currency} /> in and <Signed minor={-p.money_out} currency={p.currency} /> out
                    {p.date_from !== '' ? `, ${shortDay(p.date_from)} to ${shortDay(p.date_to)}` : ''}.
                  </p>
                )}
                <ul className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-1">
                  {p.rows.map((r) => (
                    <li key={r.row} className={cn('flex items-center gap-3 rounded-[16px] px-3 py-2', r.status === 'invalid' ? 'bg-[var(--erp-red)]/10' : 'bg-[var(--erp-row)]')}>
                      <span className="num w-16 shrink-0 text-[12px] font-semibold text-[var(--erp-ink-2)]">{r.date !== '' ? shortDay(r.date) : `Row ${r.row}`}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{r.description !== '' ? r.description : '(no description)'}</span>
                        {r.problem !== '' && <span className="block truncate text-[12px] text-[var(--erp-red-text)]">{r.problem}</span>}
                      </span>
                      {r.amount !== null && <Signed minor={r.amount} currency={p.currency} className="shrink-0 text-[13px]" />}
                      {r.status !== 'new' && (
                        <StatusPill tone={r.status === 'invalid' ? 'bad' : 'neutral'} size="sm">
                          {r.status === 'invalid' ? 'Skipped' : 'Already here'}
                        </StatusPill>
                      )}
                    </li>
                  ))}
                </ul>
                {p.counts.total > p.rows.length && <p className="text-[12px] text-[var(--erp-muted)]">The first {p.rows.length} of {p.counts.total} rows.</p>}
                <div className="mt-auto pt-2">
                  <PillButton icon={busy === 'adjust' ? RefreshCw : Check} dot loading={busy === 'run'} disabled={p.counts.new === 0 || busy !== null} onClick={() => void run()} className="h-14 w-full text-[15px]">
                    {p.counts.new === 0 ? 'Nothing new to import' : `Import ${p.counts.new} ${p.counts.new === 1 ? 'line' : 'lines'}`}
                  </PillButton>
                  <p className="mt-2 text-center text-[12px] text-[var(--erp-muted)]">{p.date_to !== '' ? `Last line ${dayLabel(p.date_to)}` : ''}</p>
                </div>
              </div>
            )}
          </Step>
        </div>
      </div>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: 'ink' | 'muted' | 'bad' }): React.JSX.Element {
  return (
    <div className={cn('rounded-[18px] p-3', tone === 'ink' ? 'erp-on-dark bg-[var(--erp-dark)] text-[var(--erp-on-dark)]' : 'bg-[var(--erp-row)]')}>
      <span className={cn('block text-[12px]', tone === 'ink' ? 'text-[var(--erp-on-dark-muted)]' : 'text-[var(--erp-muted)]')}>{label}</span>
      <span className={cn('num block text-[26px] font-extrabold leading-8', tone === 'bad' && 'text-[var(--erp-red-text)]')}>{value}</span>
    </div>
  );
}

function SwitchRow({ title, text, checked, onChange }: { title: string; text: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="block text-[12px] text-[var(--erp-muted)]">{text}</span>
      </span>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

