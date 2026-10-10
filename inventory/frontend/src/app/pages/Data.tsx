/**
 * Import and export. Import a spreadsheet of items (CSV): each field is
 * matched to a column by its header and can be pointed at any column; the
 * preview shows what will be created, updated or skipped and why, before
 * anything changes. Quantities either set the stock (a stock take) or add to
 * it (a delivery). Every import can be undone. Export items, stock per place
 * and the history as CSV.
 */
import { useState } from 'react';
import { Download, FileDown, FileSpreadsheet, FileUp, History, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Segmented } from '../components/controls.tsx';
import { DropZone } from '../components/DropZone.tsx';
import { Card, CardHeader, Field, PageHeader, PillButton, PillSelect, StatusPill, TextLink, Toggle, useConfirm } from '../components/ui.tsx';
import { api, download } from '../lib/api.ts';
import { addDays, ago, today } from '../lib/dates.ts';
import { plural } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import type { ImportPreview } from '../lib/types.ts';
import { DateField } from './Orders.tsx';

const ACTION: Record<ImportPreview['rows'][number]['action'], { label: string; tone: 'good' | 'info' | 'bad' | 'neutral' }> = {
  create: { label: 'New', tone: 'good' },
  update: { label: 'Update', tone: 'info' },
  invalid: { label: 'Problem', tone: 'bad' },
  skip: { label: 'Empty', tone: 'neutral' },
};

function Importer(): React.JSX.Element {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      setPreview(await api.previewUpload(file));
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const repreview = async (options: Record<string, string | boolean>): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    try {
      setPreview(await api.preview(preview.import_id, options));
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const run = async (): Promise<void> => {
    if (preview === null) return;
    setRunning(true);
    try {
      const r = await api.runImport(preview.import_id, {});
      toast.success(r.message);
      setPreview(null);
    } catch {
      /* toasted */
    } finally {
      setRunning(false);
    }
  };
  const template = async (): Promise<void> => {
    try {
      const f = await api.exportTemplate();
      download(f.filename, f.content);
    } catch {
      /* toasted */
    }
  };

  if (preview === null) {
    return (
      <Card delay={1}>
        <CardHeader title="Import items" subtitle="From a spreadsheet saved as CSV" action={<FileSpreadsheet size={18} className="text-[var(--iv-ink-2)]" aria-hidden />} />
        <DropZone icon={FileUp} title="Drop a CSV file" hint="or click to choose one" accept=".csv,text/csv" busy={busy} onFiles={(f) => f[0] !== undefined && void upload(f[0])} />
        <div className="mt-4 flex flex-col gap-2 text-[13px] text-[var(--iv-ink-2)]">
          <p>
            Columns it understands: Name, SKU, Barcode, Category, Unit, Quantity, Location, Reorder point, Target level, Unit cost, Supplier and Description. Other names work too: you
            choose which column is which in the next step.
          </p>
          <p>Rows with a SKU (or a name) that already exists update that item; the others become new items. Nothing changes until you press Import.</p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <TextLink onClick={() => void template()}>Download an empty template</TextLink>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--iv-muted)]">
              <Sparkles size={13} aria-hidden /> Or give the file to your AI agent in chat
            </span>
          </div>
        </div>
      </Card>
    );
  }

  const c = preview.counts;
  const colOptions = [{ value: '-1', label: 'Not in this file' }, ...preview.columns.map((h, i) => ({ value: String(i), label: `${h || `Column ${i + 1}`}` }))];
  const todo = c.create + c.update;
  return (
    <Card delay={1}>
      <CardHeader
        title={preview.filename}
        subtitle={`${plural(c.rows, 'row')} read`}
        action={
          <TextLink tone="muted" onClick={() => setPreview(null)}>
            Choose another file
          </TextLink>
        }
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <StatusPill tone="good">{plural(c.create, 'new item')}</StatusPill>
        <StatusPill tone="info">{plural(c.update, 'update')}</StatusPill>
        {c.invalid > 0 && <StatusPill tone="bad">{plural(c.invalid, 'row')} with problems</StatusPill>}
        {c.skip > 0 && <StatusPill tone="neutral">{plural(c.skip, 'empty row')}</StatusPill>}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section>
          <p className="mb-2 text-[13px] font-bold">Which column is which</p>
          <ul className="flex flex-col gap-1.5">
            {preview.fields.map((f) => (
              <li key={f.key} className="flex items-center gap-3 rounded-[16px] bg-[var(--iv-row)] py-1.5 pl-4 pr-1.5">
                <span className="min-w-0 flex-1 text-[13px] font-semibold">{f.label}</span>
                <PillSelect ariaLabel={`Column for ${f.label}`} value={String(f.column)} onChange={(v) => void repreview({ [`map_${f.key}`]: v })} options={colOptions} className="w-48" />
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-4">
          <Field label="The quantities are">
            <Segmented
              ariaLabel="The quantities are"
              value={preview.quantities}
              onChange={(v) => void repreview({ quantities: v })}
              options={[
                { value: 'set', label: 'What is on the shelf' },
                { value: 'add', label: 'A delivery to add' },
              ]}
              className="w-full"
            />
          </Field>
          <div className="rounded-[20px] bg-[var(--iv-row)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold">Create missing categories, suppliers and places</span>
              <Toggle checked={preview.create_missing} onChange={(v) => void repreview({ create_missing: v })} label="Create missing categories, suppliers and places" />
            </div>
            {preview.create_missing && preview.creates.categories.length + preview.creates.suppliers.length + preview.creates.locations.length > 0 && (
              <p className="mt-2 text-[12px] text-[var(--iv-ink-2)]">
                Will add{' '}
                {[
                  preview.creates.categories.length > 0 ? `categories ${preview.creates.categories.join(', ')}` : null,
                  preview.creates.suppliers.length > 0 ? `suppliers ${preview.creates.suppliers.join(', ')}` : null,
                  preview.creates.locations.length > 0 ? `places ${preview.creates.locations.join(', ')}` : null,
                ]
                  .filter((x) => x !== null)
                  .join('; ')}
                .
              </p>
            )}
          </div>
          <PillButton variant="dark" icon={FileUp} dot loading={running} disabled={todo === 0 || busy} onClick={() => void run()} className="h-14 text-[15px]">
            {todo > 0 ? `Import ${plural(todo, 'item')}` : 'Nothing to import yet'}
          </PillButton>
          {c.invalid > 0 && todo > 0 && <p className="text-center text-[12px] text-[var(--iv-muted)]">Rows with problems are skipped; fix them in the file and import it again.</p>}
        </section>
      </div>

      <section className={cn('mt-6 transition-opacity', busy && 'opacity-50')}>
        <p className="mb-2 text-[13px] font-bold">First rows</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-y-1.5 text-left text-[13px]">
            <thead>
              <tr className="text-[12px] text-[var(--iv-muted)]">
                <th className="px-3 font-semibold">Row</th>
                <th className="px-3 font-semibold">Will</th>
                <th className="px-3 font-semibold">Name</th>
                <th className="px-3 font-semibold">SKU</th>
                <th className="px-3 font-semibold">Quantity</th>
                <th className="px-3 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.n} className="bg-[var(--iv-row)]">
                  <td className="num rounded-l-[14px] px-3 py-2 text-[var(--iv-muted)]">{r.n}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={ACTION[r.action].tone}>{ACTION[r.action].label}</StatusPill>
                  </td>
                  <td className="max-w-56 truncate px-3 py-2 font-semibold">{r.name}</td>
                  <td className="num px-3 py-2">{r.sku !== '' ? r.sku : <span className="text-[var(--iv-muted)]">automatic</span>}</td>
                  <td className="num px-3 py-2">{r.values['quantity'] ?? ''}</td>
                  <td className="rounded-r-[14px] px-3 py-2 text-[12px] text-[var(--iv-red-text)]">{r.errors.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.invalid.length > preview.rows.filter((r) => r.action === 'invalid').length && (
          <p className="mt-2 text-[12px] text-[var(--iv-muted)]">
            More problems further down: rows {preview.invalid.slice(0, 20).map((r) => r.n).join(', ')}
            {preview.invalid.length > 20 ? ' and more' : ''}.
          </p>
        )}
      </section>
    </Card>
  );
}

function ImportHistory(): React.JSX.Element | null {
  const list = useLive(() => api.imports(), ['imports'], []);
  const [confirmEl, confirm] = useConfirm();
  const rows = list.data?.imports ?? [];
  if (rows.length === 0) return null;
  const undo = async (id: string, name: string): Promise<void> => {
    const ok = await confirm(`Items "${name}" created are deleted, items it changed get their old details back, and its stock changes are reversed.`, 'Undo this import?', 'Undo import');
    if (!ok) return;
    try {
      const r = await api.undoImport(id);
      toast.success(r.message);
    } catch {
      /* toasted */
    }
  };
  const remove = async (id: string): Promise<void> => {
    try {
      await api.deleteImport(id);
      toast.success('Removed from the list');
    } catch {
      /* toasted */
    }
  };
  return (
    <Card delay={3}>
      <CardHeader title="Past imports" action={<History size={18} className="text-[var(--iv-ink-2)]" aria-hidden />} />
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--iv-row)] px-3 py-2.5">
            <FileSpreadsheet size={16} className="shrink-0 text-[var(--iv-ink-2)]" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold">{r.filename}</span>
              <span className="block text-[12px] text-[var(--iv-muted)]">
                {ago(r.created)} · {plural(r.added, 'new item')}, {plural(r.changed, 'update')}
                {r.skipped > 0 ? `, ${r.skipped} skipped` : ''}
              </span>
            </span>
            {r.status === 'undone' ? (
              <>
                <StatusPill tone="neutral">Undone</StatusPill>
                <button type="button" onClick={() => void remove(r.id)} aria-label="Remove from the list" className="flex size-8 items-center justify-center rounded-full hover:bg-[var(--iv-row-hover)]">
                  <Trash2 size={14} />
                </button>
              </>
            ) : (
              <PillButton variant="light" icon={Undo2} onClick={() => void undo(r.id, r.filename)} className="h-9 px-4 text-[13px]">
                Undo
              </PillButton>
            )}
          </li>
        ))}
      </ul>
      {confirmEl}
    </Card>
  );
}

function Exporter(): React.JSX.Element {
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<{ filename: string; content: string }>): Promise<void> => {
    setBusy(key);
    try {
      const f = await fn();
      download(f.filename, f.content);
    } catch {
      /* toasted */
    } finally {
      setBusy(null);
    }
  };
  const row = (key: string, title: string, text: string, fn: () => Promise<{ filename: string; content: string }>): React.JSX.Element => (
    <li className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--iv-row)] p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--iv-card)]">
        <FileDown size={17} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold">{title}</span>
        <span className="block text-[12px] text-[var(--iv-muted)]">{text}</span>
      </span>
      <PillButton variant="light" icon={Download} loading={busy === key} onClick={() => void run(key, fn)} className="h-9 px-4 text-[13px]">
        CSV
      </PillButton>
    </li>
  );
  return (
    <Card delay={2}>
      <CardHeader title="Export" subtitle="Opens in any spreadsheet" />
      <ul className="flex flex-col gap-2">
        {row('items', 'Items', 'Details and figures for every item. Edit it and import it back to change many items at once.', () => api.exportItems())}
        {row('stock', 'Stock by place', 'One row per item and place. Importing it back sets the stock to its numbers.', () => api.exportStock())}
      </ul>
      <div className="mt-2 rounded-[18px] bg-[var(--iv-row)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--iv-card)]">
            <History size={17} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold">History</span>
            <span className="block text-[12px] text-[var(--iv-muted)]">Every change between two days</span>
          </span>
          <PillButton variant="light" icon={Download} loading={busy === 'history'} onClick={() => void run('history', () => api.exportMovements(from, to))} className="h-9 px-4 text-[13px]">
            CSV
          </PillButton>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <DateField value={from} onChange={(d) => setFrom(d !== '' ? d : addDays(today(), -30))} label="From" onCard />
          <DateField value={to} onChange={(d) => setTo(d !== '' ? d : today())} label="To" onCard />
        </div>
      </div>
      <p className="mt-4 px-1 text-[12px] text-[var(--iv-muted)]">Exports are copies to work with elsewhere. The app itself is also backed up every day.</p>
    </Card>
  );
}

export function DataPage(): React.JSX.Element {
  return (
    <div>
      <PageHeader title="Import and export" subtitle="Bring a spreadsheet in, or take your data out" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-5 lg:col-span-8">
          <Importer />
          <ImportHistory />
        </div>
        <div className="lg:col-span-4">
          <Exporter />
        </div>
      </div>
    </div>
  );
}
