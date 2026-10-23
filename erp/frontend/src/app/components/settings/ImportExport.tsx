/**
 * Import and export. Import is two steps: the CSV is read and checked
 * (which column feeds which field, what would be added or changed, the
 * problems per row; nothing is written), then it runs in one go. Imports of
 * records can be undone while nothing uses them. Export saves CSV files of
 * what the person may see.
 */
import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, BookOpen, Boxes, Building2, Check, Download, FileDown, FileSpreadsheet, FileText, History, Landmark, Package, RotateCcw, Upload, Users } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op, opForm, saveText } from '../../lib/api.ts';
import { ago, today } from '../../lib/dates.ts';
import { plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import type { ImportKind, ImportPreview, ImportRecord, ImportRun } from '../../lib/types/settings.ts';
import type { Me } from '../../lib/types.ts';
import { humanize } from '../agent/words.ts';
import { ScreenBar, useFullScreen } from '../FullScreen.tsx';
import type { Option } from '../pickers.tsx';
import { DateField, WarehousePicker } from '../pickers.tsx';
import { Card, CardHeader, Empty, Field, Figure, Notice, PillButton, PillSelect, StatusPill, TextLink, useConfirm } from '../ui.tsx';

/* ------------------------------------------------------------- import */

interface KindInfo {
  kind: ImportKind;
  label: string;
  text: string;
  icon: LucideIcon;
  opening: boolean;
  allowed: (me: Me) => boolean;
}

const KINDS: KindInfo[] = [
  { kind: 'parties', label: 'Customers and suppliers', text: 'Names, codes, emails, addresses, terms and credit limits', icon: Building2, opening: false, allowed: (m) => can(m, 'sales', 'edit') || can(m, 'purchasing', 'edit') },
  { kind: 'items', label: 'Items', text: 'Products and services with SKUs, prices, taxes and reorder points', icon: Package, opening: false, allowed: (m) => can(m, 'inventory', 'edit') || can(m, 'sales', 'edit') || can(m, 'purchasing', 'edit') },
  { kind: 'accounts', label: 'Chart of accounts', text: 'Account codes, names and types', icon: BookOpen, opening: false, allowed: (m) => can(m, 'accounting', 'edit') },
  { kind: 'employees', label: 'Employees', text: 'People with job, department, manager, start date and pay', icon: Users, opening: false, allowed: (m) => can(m, 'people', 'edit') },
  { kind: 'opening_accounts', label: 'Opening account balances', text: 'Debit or credit per account at the cut-over', icon: Landmark, opening: true, allowed: (m) => can(m, 'accounting', 'full') },
  { kind: 'opening_documents', label: 'Open invoices and bills', text: 'What customers and suppliers still owe at the cut-over', icon: FileText, opening: true, allowed: (m) => can(m, 'accounting', 'full') },
  { kind: 'opening_stock', label: 'Opening stock', text: 'Quantity and cost per item at the cut-over', icon: Boxes, opening: true, allowed: (m) => can(m, 'accounting', 'full') && can(m, 'inventory', 'edit') },
];

const FIELD_LABEL: Record<string, string> = {
  tax_id: 'Tax number',
  billing_address: 'Billing address',
  shipping_address: 'Shipping address',
  contact_name: 'Contact person',
  credit_limit: 'Credit limit',
  sku: 'SKU',
  sale_price: 'Sale price',
  purchase_price: 'Purchase price',
  sale_tax: 'Sales tax',
  purchase_tax: 'Purchase tax',
  min_qty: 'Reorder point',
  max_qty: 'Target level',
  lead_time_days: 'Lead time (days)',
  job_title: 'Job title',
  start_date: 'Start date',
  pay_basic: 'Basic pay',
  pay_frequency: 'Pay frequency',
  due_date: 'Due date',
  unit_cost: 'Cost each',
  qty: 'Quantity',
};

function fieldLabel(f: string): string {
  return FIELD_LABEL[f] ?? humanize(f);
}

const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.kind, k.label]));

export function ImportExportSection(): React.JSX.Element {
  const me = useMe();
  const allowed = KINDS.filter((k) => k.allowed(me));
  const history = useLive(() => op<{ imports: ImportRecord[] }>('import.list', {}, { quiet: true }), ['imports'], []);
  const fs = useFullScreen();
  const [kind, setKind] = useState<KindInfo | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const template = async (k: ImportKind): Promise<void> => {
    try {
      const r = await op<{ filename: string; csv: string }>('import.template', { kind: k });
      saveText(r.csv, r.filename);
    } catch {
      /* shown */
    }
  };
  const undo = async (r: ImportRecord): Promise<void> => {
    if (!(await confirm(`Records ${r.filename} added are removed, unless something uses them already. Records it changed keep their changes.`, 'Undo this import?', 'Undo import'))) return;
    try {
      const res = await op<{ removed: number; kept_in_use: number; updated_not_reverted: number }>('import.undo', { import_id: r.id });
      toast.success(`Removed ${res.removed}${res.kept_in_use > 0 ? `; kept ${res.kept_in_use} already in use` : ''}`);
      history.reload();
    } catch {
      /* shown */
    }
  };

  const past = (history.data?.imports ?? []).filter((r) => r.status !== 'previewed');

  return (
    <div className="flex flex-col gap-5">
      {allowed.length > 0 && (
        <Card delay={1}>
          <CardHeader icon={Upload} title="Bring data in" subtitle="From a spreadsheet saved as CSV. You see every row before anything is written." />
          <div className="grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2 @min-[1300px]:grid-cols-3">
            {allowed.map((k) => {
              const Icon = k.icon;
              return (
                <div key={k.kind} className="flex flex-col rounded-[20px] bg-[var(--erp-row)] p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)]">
                      <Icon size={17} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold">{k.label}</p>
                      <p className="mt-0.5 text-[12px] leading-5 text-[var(--erp-muted)]">{k.text}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <PillButton
                      size="sm"
                      icon={Upload}
                      onClick={(e) => {
                        setKind(k);
                        fs.open(e.currentTarget);
                      }}
                    >
                      Import
                    </PillButton>
                    <PillButton size="sm" variant="ghost" icon={FileDown} onClick={() => void template(k.kind)}>
                      Template
                    </PillButton>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card delay={2}>
        <CardHeader icon={History} title="Past imports" />
        {past.length === 0 ? (
          <p className="text-[13px] text-[var(--erp-muted)]">Nothing imported yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {past.map((r) => {
              const undoable = r.status === 'imported' && ['parties', 'items', 'accounts', 'employees'].includes(r.kind) && KINDS.find((k) => k.kind === r.kind)?.allowed(me) === true;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)]">
                    <FileSpreadsheet size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{r.filename}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                      {KIND_LABEL[r.kind] ?? humanize(r.kind)} · {r.who} · {ago(r.created)}
                    </span>
                  </span>
                  <span className="num text-[13px] text-[var(--erp-ink-2)]">
                    {r.added} added
                    {r.skipped > 0 ? `, ${r.skipped} skipped` : ''}
                  </span>
                  <StatusPill tone={r.status === 'undone' ? 'neutral' : 'good'} size="sm">
                    {r.status === 'undone' ? 'Undone' : 'Imported'}
                  </StatusPill>
                  {undoable && (
                    <PillButton size="sm" variant="light" icon={RotateCcw} onClick={() => void undo(r)}>
                      Undo
                    </PillButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ExportCard me={me} />
      {confirmEl}
      {kind !== null &&
        fs.node(
          <ImportScreen
            info={kind}
            onClose={fs.close}
            onTemplate={() => void template(kind.kind)}
            onDone={() => {
              history.reload();
            }}
          />,
          { title: `Import ${kind.label.toLowerCase()}` },
        )}
    </div>
  );
}

function ImportScreen({ info, onClose, onTemplate, onDone }: { info: KindInfo; onClose: () => void; onTemplate: () => void; onDone: () => void }): React.JSX.Element {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [warehouse, setWarehouse] = useState<Option | null>(null);
  const [result, setResult] = useState<ImportRun | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const read = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const p = await opForm<ImportPreview>('import.preview', { kind: info.kind, date: info.opening ? date : undefined }, { file }, { quiet: true });
      setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remap = async (field: string, column: string): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    try {
      const p = await op<ImportPreview>('import.preview', { import_id: preview.import_id, mapping: { [field]: column === '' ? -1 : Number(column) } }, { quiet: true });
      setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async (): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await op<ImportRun>('import.run', { import_id: preview.import_id, date: info.opening ? date : undefined, warehouse: warehouse?.id }, { quiet: true });
      setResult(r);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mappedFields = preview?.fields.filter((f) => f.column >= 0).slice(0, 3) ?? [];
  const good = preview === null ? 0 : preview.counts.create + preview.counts.update;

  return (
    <div className="min-h-full">
      <ScreenBar
        title={`Import ${info.label.toLowerCase()}`}
        sub={result !== null ? 'Done' : preview === null ? 'Step 1 of 2: choose the file' : `Step 2 of 2: check ${preview.filename}`}
        onClose={onClose}
        actions={
          preview !== null && result === null ? (
            <PillButton icon={Check} dot loading={busy} disabled={good === 0 || (info.opening && date === '')} onClick={() => void run()}>
              Import {plural(good, 'row')}
            </PillButton>
          ) : undefined
        }
      />
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 pb-16 pt-2 @min-[640px]:px-8">
        {error !== null && (
          <Notice tone="bad" icon={AlertTriangle}>
            {error}
          </Notice>
        )}
        {result !== null ? (
          <Card>
            <Empty
              icon={Check}
              title="Imported"
              action={
                <PillButton icon={Check} onClick={onClose}>
                  Done
                </PillButton>
              }
            >
              {plural(result.added, 'row')} added{result.updated !== undefined && result.updated > 0 ? `, ${result.updated} updated` : ''}
              {result.skipped > 0 ? `, ${result.skipped} skipped with problems` : ''}.
            </Empty>
          </Card>
        ) : preview === null ? (
          <Card>
            {info.opening && (
              <div className="mb-5 grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
                <Field label="Cut-over date" hint="The day these balances are as at">
                  <DateField value={date} onChange={setDate} ariaLabel="Cut-over date" />
                </Field>
                {info.kind === 'opening_stock' && (
                  <Field label="Warehouse" hint="The main one when empty">
                    <WarehousePicker value={warehouse} onChange={setWarehouse} clearable />
                  </Field>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f !== undefined) void read(f);
              }}
              className={cn('flex w-full flex-col items-center gap-3 rounded-[22px] border-2 border-dashed px-6 py-14 text-center transition-colors', drag ? 'border-[var(--erp-ink)] bg-[var(--erp-row)]' : 'border-[var(--erp-line)] hover:bg-[var(--erp-row)]')}
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-[var(--erp-row)]">
                {busy ? <span className="size-6 animate-spin rounded-full border-2 border-[var(--erp-ink)] border-t-transparent" /> : <FileSpreadsheet size={26} strokeWidth={1.8} aria-hidden />}
              </span>
              <span className="text-[15px] font-bold">Drop the CSV here, or choose it</span>
              <span className="text-[13px] text-[var(--erp-muted)]">The first row names the columns. Nothing is written until you import.</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f !== undefined) void read(f);
                e.target.value = '';
              }}
            />
            <p className="mt-4 text-[13px] text-[var(--erp-ink-2)]">
              No file yet?{' '}
              <TextLink onClick={onTemplate}>
                Download the template <Download size={13} aria-hidden />
              </TextLink>
            </p>
          </Card>
        ) : (
          <>
            <Card tone="sand">
              <div className="grid grid-cols-2 gap-5 @min-[640px]:grid-cols-4">
                <Figure label="Rows" value={preview.counts.rows} />
                <Figure label="New" value={preview.counts.create} />
                <Figure label="Updates" value={preview.counts.update} />
                <Figure label="With problems" value={preview.counts.invalid} tone={preview.counts.invalid > 0 ? 'red' : 'ink'} sub={preview.counts.invalid > 0 ? 'Skipped when importing' : undefined} />
              </div>
            </Card>
            <div className="grid grid-cols-1 gap-5 @min-[1100px]:grid-cols-12">
              <Card className="@min-[1100px]:col-span-5">
                <CardHeader title="Columns" subtitle="Which column of the file fills each field" />
                <div className="flex flex-col">
                  {preview.fields.map((f) => (
                    <div key={f.field} className="grid grid-cols-1 items-center gap-2 border-b border-[var(--erp-line)] py-2.5 last:border-b-0 @min-[480px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                      <span className="text-[13px] font-semibold">
                        {fieldLabel(f.field)}
                        {f.required && <span className="text-[var(--erp-red-text)]"> required</span>}
                      </span>
                      <PillSelect
                        soft
                        ariaLabel={`Column for ${fieldLabel(f.field)}`}
                        value={f.column >= 0 ? String(f.column) : ''}
                        onChange={(v) => void remap(f.field, v)}
                        disabled={busy}
                        options={[{ value: '', label: 'Not in the file' }, ...preview.columns.map((c) => ({ value: String(c.index), label: c.name !== '' ? c.name : `Column ${c.index + 1}` }))]}
                      />
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="min-w-0 @min-[1100px]:col-span-7">
                <CardHeader title="Rows" subtitle={preview.counts.rows > preview.rows.length ? `The first ${preview.rows.length} of ${preview.counts.rows}` : undefined} />
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[520px] text-[13px]">
                    <thead>
                      <tr className="text-left text-[12px] font-semibold text-[var(--erp-muted)]">
                        <th className="px-2 pb-2 font-semibold">Row</th>
                        {mappedFields.map((f) => (
                          <th key={f.field} className="px-2 pb-2 font-semibold">
                            {fieldLabel(f.field)}
                          </th>
                        ))}
                        <th className="px-2 pb-2 font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.row} className={cn('border-t border-[var(--erp-line)] align-top', r.status === 'invalid' && 'bg-[var(--erp-red)]/6')}>
                          <td className="num px-2 py-2 text-[var(--erp-muted)]">{r.row}</td>
                          {mappedFields.map((f) => (
                            <td key={f.field} className="max-w-[200px] truncate px-2 py-2">
                              {r.values[f.field] ?? ''}
                            </td>
                          ))}
                          <td className="px-2 py-2">
                            {r.status === 'invalid' ? (
                              <span className="font-semibold text-[var(--erp-red-text)]">{r.problems.join('; ')}</span>
                            ) : (
                              <StatusPill tone={r.status === 'create' ? 'good' : 'info'} size="sm">
                                {r.status === 'create' ? 'New' : 'Update'}
                              </StatusPill>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            {info.opening && (
              <Card>
                <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
                  <Field label="Cut-over date">
                    <DateField value={date} onChange={setDate} ariaLabel="Cut-over date" />
                  </Field>
                  {info.kind === 'opening_stock' && (
                    <Field label="Warehouse" hint="The main one when empty">
                      <WarehousePicker value={warehouse} onChange={setWarehouse} clearable />
                    </Field>
                  )}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- export */

interface ExportKind {
  kind: string;
  label: string;
  dated: boolean;
  allowed: (me: Me) => boolean;
}

const EXPORTS: ExportKind[] = [
  { kind: 'parties', label: 'Customers and suppliers', dated: false, allowed: (m) => can(m, 'sales') || can(m, 'purchasing') },
  { kind: 'items', label: 'Items', dated: false, allowed: (m) => can(m, 'inventory') || can(m, 'sales') || can(m, 'purchasing') },
  { kind: 'stock', label: 'Stock on hand and value', dated: false, allowed: (m) => can(m, 'inventory') },
  { kind: 'documents', label: 'Documents', dated: true, allowed: (m) => can(m, 'sales') || can(m, 'purchasing') },
  { kind: 'document_lines', label: 'Document lines', dated: true, allowed: (m) => can(m, 'sales') || can(m, 'purchasing') },
  { kind: 'payments', label: 'Payments', dated: true, allowed: (m) => can(m, 'banking') || can(m, 'sales') || can(m, 'purchasing') },
  { kind: 'accounts', label: 'Chart of accounts', dated: false, allowed: (m) => can(m, 'accounting') },
  { kind: 'journal_lines', label: 'Journal lines (general ledger)', dated: true, allowed: (m) => can(m, 'accounting') },
  { kind: 'trial_balance', label: 'Trial balance', dated: true, allowed: (m) => can(m, 'accounting') },
  { kind: 'employees', label: 'Employees', dated: false, allowed: (m) => can(m, 'people') },
  { kind: 'timesheets', label: 'Timesheets', dated: true, allowed: (m) => can(m, 'projects') },
];

const DOC_TYPES: { value: string; label: string; side: 'sales' | 'purchasing' }[] = [
  { value: 'invoice', label: 'Invoices', side: 'sales' },
  { value: 'credit_note', label: 'Credit notes', side: 'sales' },
  { value: 'quote', label: 'Quotes', side: 'sales' },
  { value: 'sales_order', label: 'Sales orders', side: 'sales' },
  { value: 'delivery', label: 'Deliveries', side: 'sales' },
  { value: 'bill', label: 'Bills', side: 'purchasing' },
  { value: 'supplier_credit', label: 'Supplier credits', side: 'purchasing' },
  { value: 'purchase_order', label: 'Purchase orders', side: 'purchasing' },
  { value: 'goods_receipt', label: 'Goods receipts', side: 'purchasing' },
];

function ExportCard({ me }: { me: Me }): React.JSX.Element | null {
  const kinds = EXPORTS.filter((k) => k.allowed(me));
  const types = DOC_TYPES.filter((t) => can(me, t.side));
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [type, setType] = useState(types[0]?.value ?? 'invoice');
  const [busy, setBusy] = useState<string | null>(null);
  if (kinds.length === 0) return null;
  const run = async (k: ExportKind): Promise<void> => {
    setBusy(k.kind);
    try {
      const r = await op<{ filename: string; csv: string; rows?: number | undefined }>('export.csv', { kind: k.kind, from: k.dated ? from : undefined, to: k.dated ? to : undefined, type: k.kind === 'documents' || k.kind === 'document_lines' ? type : undefined });
      saveText(r.csv, k.kind === 'documents' || k.kind === 'document_lines' ? `${k.kind}-${type}-${today()}.csv` : r.filename);
      if (r.rows !== undefined) toast.success(`${plural(r.rows, 'row')} saved`);
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card delay={3}>
      <CardHeader icon={Download} title="Take data out" subtitle="CSV files that open in any spreadsheet, with what your role may see" />
      <div className="mb-4 grid grid-cols-1 gap-3 @min-[640px]:grid-cols-3">
        <Field label="From" hint="For dated exports">
          <DateField value={from} onChange={setFrom} ariaLabel="From" />
        </Field>
        <Field label="To">
          <DateField value={to} onChange={setTo} ariaLabel="To" />
        </Field>
        {types.length > 0 && <PillSelect label="Documents of type" soft value={type} onChange={setType} options={types.map((t) => ({ value: t.value, label: t.label }))} />}
      </div>
      <ul className="grid grid-cols-1 gap-2 @min-[640px]:grid-cols-2">
        {kinds.map((k) => (
          <li key={k.kind}>
            <button type="button" disabled={busy !== null} onClick={() => void run(k)} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--erp-row-hover)] disabled:opacity-60">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)]">
                {busy === k.kind ? <span className="size-4 animate-spin rounded-full border-2 border-[var(--erp-ink)] border-t-transparent" /> : <FileDown size={15} aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{k.label}</span>
                <span className="block truncate text-[12px] text-[var(--erp-muted)]">{k.dated ? 'In the dates above' : 'Everything'}{k.kind === 'documents' || k.kind === 'document_lines' ? `, ${DOC_TYPES.find((t) => t.value === type)?.label.toLowerCase() ?? ''}` : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
