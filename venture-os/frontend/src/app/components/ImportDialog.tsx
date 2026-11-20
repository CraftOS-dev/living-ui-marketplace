/**
 * Import a CSV or XLSX (Store OS ImportDialog, simplified to a line): pick
 * what it is (imports.targets; preset with `target`), drop the file (read in
 * the browser), check what each row would do (imports.preview matches the
 * columns by header synonyms; a column can be re-matched), then import in
 * batches of 200 (imports.run; one import record, each batch undoable).
 * The process is a StepTrack: File, Check, Import, Done.
 *
 *   <ImportDialog open onClose={...} target="companies" />
 */
import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { askPin, errMessage, op } from '../lib/api.ts';
import { num } from '../lib/format.ts';
import { changed, useOp } from '../lib/live.ts';
import { readTable } from '../lib/sheets.ts';
import type { Table } from '../lib/sheets.ts';
import { Meter } from './charts.tsx';
import { Button, ChipPicker, Dialog, Empty, FigureStrip, FileDrop, Notice, Select, Spinner, StepTrack } from './ui.tsx';

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  type: string;
  synonyms: string[];
}

export interface ImportTarget {
  target: string;
  module: string;
  label: string;
  /** Running it needs the approval PIN (opening balances): asked once for every batch. */
  pin: boolean;
  fields: ImportField[];
}

interface Counts {
  created: number;
  updated: number;
  skipped: number;
  error: number;
}

interface Preview {
  headers: string[];
  mapping: Record<string, string>;
  missing_required: string[];
  rows: number;
  results: { row: number; action: 'created' | 'updated' | 'skipped' | 'error'; message?: string | undefined }[];
  counts: Counts;
}

export function ImportDialog({ open, onClose, target: preset }: { open: boolean; onClose: () => void; target?: string | undefined }): React.JSX.Element | null {
  const targets = useOp<{ targets: ImportTarget[]; max_rows_per_call: number }>('imports.targets', {}, [], { name: 'imports.targets', skip: !open });
  const [target, setTarget] = useState(preset ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const [result, setResult] = useState<Counts | null>(null);
  const t = useMemo(() => targets.data?.targets.find((x) => x.target === target) ?? null, [targets.data, target]);
  const batch = targets.data?.max_rows_per_call ?? 200;

  useEffect(() => {
    if (!open) {
      setFile(null);
      setTable(null);
      setPreview(null);
      setStep(0);
      setError(null);
      setSent(0);
      setResult(null);
      setTarget(preset ?? '');
    }
  }, [open, preset]);

  const check = async (tb: Table, f: File | null, mapping?: Record<string, string>): Promise<void> => {
    if (t === null) return;
    setBusy(true);
    setError(null);
    try {
      const p = await op<Preview>('imports.preview', { target: t.target, headers: tb.headers, rows: tb.rows, mapping, file_name: f?.name }, { quiet: true });
      setPreview(p);
      setStep(1);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (f === undefined || t === null) return;
    setError(null);
    try {
      const tb = await readTable(f);
      if (tb.rows.length === 0) throw new Error('This file has no rows.');
      setFile(f);
      setTable(tb);
      await check(tb, f);
    } catch (e) {
      setError(errMessage(e));
    }
  };

  const run = async (): Promise<void> => {
    if (table === null || t === null || preview === null) return;
    setBusy(true);
    setError(null);
    setStep(2);
    let id = '';
    const sum: Counts = { created: 0, updated: 0, skipped: 0, error: 0 };
    try {
      // A target that needs the PIN asks it once (the dialog checks it), then every batch carries it.
      const pin = t.pin ? await askPin({ title: t.label }) : undefined;
      if (pin === null) {
        setStep(1);
        return;
      }
      for (let i = 0; i < table.rows.length; i += batch) {
        const r = await op<{ import: { id: string }; counts: Counts }>('imports.run', { target: t.target, headers: table.headers, rows: table.rows.slice(i, i + batch), mapping: preview.mapping, file_name: file?.name, import: id === '' ? undefined : id, pin }, { quiet: true });
        id = r.import.id;
        sum.created += r.counts.created;
        sum.updated += r.counts.updated;
        sum.skipped += r.counts.skipped;
        sum.error += r.counts.error;
        setSent(Math.min(table.rows.length, i + batch));
      }
      setResult(sum);
      setStep(4);
      changed('*');
    } catch (e) {
      setError(errMessage(e));
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const errors = preview?.results.filter((r) => r.action === 'error') ?? [];
  const footer =
    step === 4 ? (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    ) : step === 1 && preview !== null ? (
      <>
        <Button onClick={() => (setStep(0), setPreview(null))} disabled={busy}>
          Back
        </Button>
        <Button variant="primary" busy={busy} disabled={preview.missing_required.length > 0} onClick={() => void run()}>
          Import {num(preview.rows)}
        </Button>
      </>
    ) : undefined;
  return (
    <Dialog open onClose={onClose} title="Import" width={560} footer={footer}>
      <div className="flex flex-col gap-5">
        <StepTrack labels={['File', 'Check', 'Import', 'Done']} at={step} />
        {error !== null && <Notice tone="bad">{error}</Notice>}
        {targets.data === null ? (
          <div className="flex h-24 items-center justify-center text-[var(--vo-muted)]">
            <Spinner />
          </div>
        ) : targets.data.targets.length === 0 ? (
          <Empty icon={FileSpreadsheet} title="Nothing to import yet" />
        ) : step === 0 ? (
          <>
            {preset === undefined && <ChipPicker label="What" value={target} onChange={setTarget} options={targets.data.targets.map((x) => ({ value: x.target, label: x.label }))} />}
            {t !== null &&
              (busy ? (
                <div className="flex h-24 items-center justify-center text-[var(--vo-muted)]">
                  <Spinner />
                </div>
              ) : (
                <FileDrop label="Choose file" accept=".csv,.tsv,.txt,.xlsx" onFiles={(f) => void pick(f)}>
                  <FileSpreadsheet size={20} aria-hidden className="text-[var(--vo-muted)]" />
                </FileDrop>
              ))}
          </>
        ) : step === 1 && preview !== null && table !== null && t !== null ? (
          <>
            <FigureStrip
              items={[
                { label: 'New', value: num(preview.counts.created), tone: 'good' },
                { label: 'Updated', value: num(preview.counts.updated) },
                { label: 'Problems', value: num(preview.counts.error), tone: preview.counts.error > 0 ? 'warn' : undefined },
              ]}
            />
            <div className="flex flex-col divide-y divide-[var(--vo-hair)]">
              {t.fields.map((f) => {
                const header = Object.keys(preview.mapping).find((h) => preview.mapping[h] === f.key) ?? '';
                const sample = header !== '' ? (table.rows[0]?.[table.headers.indexOf(header)] ?? '') : '';
                const missing = preview.missing_required.includes(f.key);
                return (
                  <div key={f.key} className="grid min-h-11 grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 py-1.5">
                    <span className={missing ? 'text-[13px] font-medium text-[var(--vo-bad)]' : 'text-[13px] font-medium'}>{f.label}</span>
                    <Select
                      aria-label={f.label}
                      value={header}
                      disabled={busy}
                      onChange={(e) => {
                        const next: Record<string, string> = {};
                        for (const [h, k] of Object.entries(preview.mapping)) next[h] = k === f.key || h === e.target.value ? '' : k;
                        if (e.target.value !== '') next[e.target.value] = f.key;
                        void check(table, file, next);
                      }}
                    >
                      <option value="">{f.required ? 'Choose a column' : 'Skip'}</option>
                      {table.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                    <span className="vo-wrap truncate text-[12px] text-[var(--vo-muted)]">{sample}</span>
                  </div>
                );
              })}
            </div>
            {errors.length > 0 && (
              <ul className="vo-scroll max-h-36 overflow-y-auto rounded-[var(--vo-radius-sm)] bg-[var(--vo-sunk)] px-3 py-2 text-[12px]">
                {errors.map((p) => (
                  <li key={p.row} className="flex gap-3 py-0.5">
                    <span className="vo-mono w-12 shrink-0 text-[var(--vo-muted)]">{p.row}</span>
                    <span className="vo-wrap min-w-0">{p.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : step === 2 && table !== null ? (
          <Meter value={sent} max={table.rows.length} label="Imported" />
        ) : result !== null ? (
          <FigureStrip
            items={[
              { label: 'New', value: num(result.created), tone: 'good' },
              { label: 'Updated', value: num(result.updated) },
              { label: 'Skipped', value: num(result.skipped + result.error), tone: result.skipped + result.error > 0 ? 'warn' : undefined },
            ]}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
