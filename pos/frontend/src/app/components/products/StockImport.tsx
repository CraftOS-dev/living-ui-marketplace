/**
 * Stock and imports.
 *
 * Stock: products that count their stock, lowest first, as soft rows: what
 * is on hand against its alert level (and per size); receive a delivery,
 * correct it with a reason, or count what is there; every product's history
 * of moves.
 *
 * Imports: a menu photo, PDF or supplier list your AI agent reads (what the
 * agent adds waits on the Products page for your review), or a spreadsheet
 * you map column by column (added at once).
 */
import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ClipboardCheck, Download, FileSpreadsheet, FileText, FileUp, History, Image as ImageIcon, PackageCheck, PackagePlus, PencilLine, RotateCw, ShoppingBag, Sparkles, Trash2, Undo2, Upload } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { download, parseCsv } from '../../lib/csv.ts';
import { ago, dateTime, parseMoney, plural, qty as count } from '../../lib/format.ts';
import { iconFor, catVars } from '../../lib/icons.tsx';
import { useLive } from '../../lib/live.ts';
import type { ImportRec, StockItem, StockMove } from '../../lib/types.ts';
import { Badge, Button, Card, CardHeader, Chip, Empty, IconBadge, IconButton, LevelBar, Modal, Panel, SearchField, Select, Spinner, TextField, rowCls, useConfirm } from '../ui.tsx';

/** A white block inside a dialog. */
const subCard = 'ps-on-card rounded-[22px] bg-[var(--ps-card)] p-4';
/** A white pill on a soft row answers to the pointer with the row's darker tone. */
const onRow = 'hover:bg-[var(--ps-row-hover)]';

/* ------------------------------------------------------------------ stock */

type StockMode = 'receive' | 'count' | 'adjust';

const MODES: { value: StockMode; label: string; icon: LucideIcon }[] = [
  { value: 'receive', label: 'Received', icon: PackagePlus },
  { value: 'count', label: 'Counted', icon: ClipboardCheck },
  { value: 'adjust', label: 'Correction', icon: PencilLine },
];

function StockDialog({ item, initial, onClose }: { item: StockItem; initial: StockMode; onClose: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<StockMode>(initial);
  const [variant, setVariant] = useState(item.variants.length === 1 ? (item.variants[0]?.id ?? '') : '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(qty.trim());
  const valid = qty.trim() !== '' && Number.isInteger(n) && (mode === 'count' ? n >= 0 : mode === 'receive' ? n > 0 : n !== 0) && (item.variants.length === 0 || variant !== '') && (mode !== 'adjust' || reason.trim() !== '');
  const current = item.variants.length > 0 ? (item.variants.find((v) => v.id === variant)?.stock ?? null) : item.stock;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const base = { product: item.id, variant };
      if (mode === 'receive') await api.receiveStock({ ...base, qty: n, reason: reason.trim() || 'Delivery' });
      else if (mode === 'count') await api.countStock({ ...base, counted: n, reason: reason.trim() });
      else await api.adjustStock({ ...base, qty: n, reason: reason.trim() });
      toast.success('Stock saved');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      description={current !== null ? `${current} in stock now` : undefined}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Change" className={cn(subCard, 'grid grid-cols-3 gap-2 p-2')}>
          {MODES.map((m) => {
            const on = m.value === mode;
            const ModeIcon = m.icon;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(m.value)}
                className={cn('ps-press flex min-w-0 flex-col items-center gap-2 rounded-[18px] px-1 py-3', on ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-row)] hover:bg-[var(--ps-row-hover)]')}
              >
                <span aria-hidden className={cn('flex size-10 items-center justify-center rounded-full', on ? 'bg-[var(--ps-dot)] text-[var(--ps-on-dot)]' : 'bg-[var(--ps-card)] text-[var(--ps-ink)]')}>
                  <ModeIcon size={18} />
                </span>
                <span className="w-full truncate text-center text-[12px] font-semibold">{m.label}</span>
              </button>
            );
          })}
        </div>
        <div className={cn(subCard, 'flex flex-col gap-3')}>
          {item.variants.length > 0 && <Select label="Size" value={variant} onChange={setVariant} options={[{ value: '', label: 'Pick a size' }, ...item.variants.map((v) => ({ value: v.id, label: `${v.name} (${v.stock})` }))]} />}
          <TextField
            label={mode === 'receive' ? 'How many came in' : mode === 'count' ? 'How many are there' : 'Change (for example -2)'}
            value={qty}
            onChange={(v) => setQty(v.replace(/[^\d-]/g, '').slice(0, 8))}
            inputMode="numeric"
            autoFocus
            onEnter={() => void (valid && save())}
          />
          <TextField label={mode === 'adjust' ? 'Why' : 'Note (optional)'} value={reason} onChange={setReason} maxLength={200} placeholder={mode === 'adjust' ? 'Broken, expired, found...' : mode === 'receive' ? 'Delivery from...' : ''} />
        </div>
      </div>
    </Modal>
  );
}

const MOVE_KIND: Record<string, string> = { sale: 'Sold', refund: 'Returned', receive: 'Received', adjust: 'Correction', count: 'Counted' };
const MOVE_ICON: Record<StockMove['kind'], LucideIcon> = { sale: ShoppingBag, refund: Undo2, receive: PackagePlus, adjust: PencilLine, count: ClipboardCheck };

function MoveRow({ m }: { m: StockMove }): React.JSX.Element {
  const details = [m.sale_number || m.reason, m.actor === 'agent' ? '' : m.by, dateTime(m.created)].filter((x) => x !== '').join(' · ');
  return (
    <li className={cn(rowCls, 'flex items-center gap-3 p-3')}>
      <IconBadge icon={MOVE_ICON[m.kind] ?? History} tone="card" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[14px] font-bold">
            {MOVE_KIND[m.kind] ?? m.kind}
            {m.variant_name !== '' ? ` · ${m.variant_name}` : ''}
          </span>
          {m.actor === 'agent' && (
            <Badge tone="agent">
              <Sparkles size={12} aria-hidden /> Your AI agent
            </Badge>
          )}
        </span>
        <span className="block text-[12px] text-[var(--ps-muted)]">{details}</span>
      </span>
      <span className="num shrink-0 text-right">
        <span className={cn('block text-[14px] font-bold', m.qty < 0 ? 'text-[var(--ps-red-text)]' : 'text-[var(--ps-green-text)]')}>{m.qty > 0 ? `+${count(m.qty)}` : count(m.qty)}</span>
        <span className="block text-[12px] text-[var(--ps-muted)]">left {count(m.balance)}</span>
      </span>
    </li>
  );
}

function StockHistory({ item, onClose }: { item: StockItem; onClose: () => void }): React.JSX.Element {
  const d = useLive(() => api.stockHistory(item.id), ['stock'], [item.id]);
  return (
    <Modal open onClose={onClose} title={item.name} description="Stock history" wide>
      <div className={cn(subCard, 'p-2')}>
        {d.data === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : d.data.moves.length === 0 ? (
          <Empty icon={History} title="No stock moves yet" compact />
        ) : (
          <ul className="flex flex-col gap-2">
            {d.data.moves.map((m) => (
              <MoveRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** What is on hand against the alert level: the bar is full at three times the level, the tick marks it. */
function Level({ item }: { item: StockItem }): React.JSX.Element {
  const scale = item.low_stock > 0 ? item.low_stock * 3 : Math.max(item.stock, 1);
  return (
    <span className="relative block min-w-0 flex-1">
      <LevelBar ratio={item.stock / scale} tone={item.out ? 'bad' : item.low ? 'warn' : 'ink'} />
      {item.low_stock > 0 && <span aria-hidden className="absolute left-1/3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--ps-ink)]" />}
    </span>
  );
}

function StockRow({ it, onChange, onHistory }: { it: StockItem; onChange: (mode: StockMode) => void; onHistory: () => void }): React.JSX.Element {
  const I = iconFor(it.icon);
  const v = catVars(it.color);
  const sub = [it.category_name, it.low_stock > 0 ? `Alert at ${it.low_stock}` : ''].filter((x) => x !== '').join(' · ');
  const action = cn('flex-1 px-0 sm:flex-none sm:px-3.5', onRow);
  return (
    <li className={cn(rowCls, 'flex flex-col gap-3 p-3')}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="order-1 flex min-w-0 flex-1 basis-[55%] items-center gap-3 sm:basis-[220px]">
          {it.thumb_url !== '' ? (
            <img src={it.thumb_url} alt="" className="size-10 shrink-0 rounded-full object-cover" />
          ) : (
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ background: v.soft, color: v.text }}>
              <I size={18} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{it.name}</span>
            {sub !== '' && <span className="block truncate text-[12px] text-[var(--ps-muted)]">{sub}</span>}
          </span>
        </div>
        <IconButton icon={History} label={`History of ${it.name}`} variant="light" className={cn('order-2 sm:order-5', onRow)} onClick={onHistory} />
        <div className="order-3 flex w-full items-center gap-3 sm:w-auto sm:flex-1 sm:basis-[240px] xl:flex-none xl:basis-[340px]">
          <Level item={it} />
          <span className="num min-w-10 shrink-0 text-right text-[15px] font-bold">{it.stock}</span>
          <span className="flex w-[68px] shrink-0">
            {it.out ? (
              <Badge tone="bad" className="bg-[var(--ps-card)]">
                Out
              </Badge>
            ) : it.low ? (
              <Badge tone="warn" className="bg-[var(--ps-card)]">
                Low
              </Badge>
            ) : null}
          </span>
        </div>
        <div className="order-4 flex w-full gap-2 sm:ml-auto sm:w-auto">
          <Button size="sm" variant="light" className={action} onClick={() => onChange('receive')}>
            Received
          </Button>
          <Button size="sm" variant="light" className={action} onClick={() => onChange('adjust')}>
            Adjust
          </Button>
          <Button size="sm" variant="light" className={action} onClick={() => onChange('count')}>
            Count
          </Button>
        </div>
      </div>
      {it.variants.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 sm:pl-[52px] xl:grid-cols-3" aria-label={`Sizes of ${it.name}`}>
          {it.variants.map((x) => (
            <li key={x.id} className="flex h-10 items-center justify-between gap-3 rounded-full bg-[var(--ps-card)] px-4 text-[13px]">
              <span className="truncate font-semibold">{x.name}</span>
              <span className="num shrink-0 font-bold">{x.stock}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function StockTab(): React.JSX.Element {
  const [only, setOnly] = useState<'all' | 'low' | 'out'>('all');
  const [q, setQ] = useState('');
  const d = useLive(() => api.stock({ only, q }), ['stock', 'products', 'variants'], [only, q]);
  const [dialog, setDialog] = useState<{ item: StockItem; mode: StockMode } | null>(null);
  const [history, setHistory] = useState<StockItem | null>(null);
  const counts = d.data?.counts;
  return (
    <>
      <div className="ps-rise ps-d1 flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-2">
          <Chip active={only === 'all'} onClick={() => setOnly('all')} count={counts?.all}>
            All
          </Chip>
          <Chip active={only === 'low'} onClick={() => setOnly('low')} count={counts !== undefined ? counts.low + counts.out : undefined}>
            Low
          </Chip>
          <Chip active={only === 'out'} onClick={() => setOnly('out')} count={counts?.out}>
            Out
          </Chip>
        </div>
        <SearchField value={q} onChange={setQ} placeholder="Find a product" label="Find a product" tone="card" className="min-w-[13rem] flex-1" />
      </div>
      <Card delay={2} className="p-3 md:p-4">
        <CardHeader title="Stock" subtitle="Products that count their stock" className="px-2 pt-1" />
        {d.data === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : d.data.items.length === 0 ? (
          <Empty icon={PackageCheck} title={counts?.all === 0 ? 'No product counts its stock yet' : 'Nothing here'} compact>
            {counts?.all === 0 ? 'Turn on "Count its stock" in a product to follow it here.' : undefined}
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.data.items.map((it) => (
              <StockRow key={it.id} it={it} onChange={(mode) => setDialog({ item: it, mode })} onHistory={() => setHistory(it)} />
            ))}
          </ul>
        )}
      </Card>
      {dialog !== null && <StockDialog item={dialog.item} initial={dialog.mode} onClose={() => setDialog(null)} />}
      {history !== null && <StockHistory item={history} onClose={() => setHistory(null)} />}
    </>
  );
}

/* ------------------------------------------------------------------ import */

/** A dashed area that takes a dropped file or opens the file picker: a real file input under a label. */
function DropZone({ icon, title, hint, accept, sand = false, busy = false, onFile }: { icon: LucideIcon; title: string; hint?: string; accept: string; sand?: boolean; busy?: boolean; onFile: (f: File) => void }): React.JSX.Element {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f !== undefined && !busy) onFile(f);
      }}
      className={cn(
        'flex flex-col items-center gap-3 rounded-[22px] border-2 border-dashed px-6 py-8 text-center transition-colors has-[:focus-visible]:border-[var(--ps-ink)]',
        sand ? 'bg-[var(--ps-sand-2)]' : 'bg-[var(--ps-row)]',
        over ? 'border-[var(--ps-ink)]' : 'border-[var(--ps-track)] hover:border-[var(--ps-ink-2)]',
        busy ? 'cursor-progress' : 'cursor-pointer',
      )}
    >
      {busy ? (
        <span className="flex size-12 items-center justify-center">
          <Spinner size={22} />
        </span>
      ) : (
        <IconBadge icon={icon} size={48} tone={sand ? 'solid' : 'card'} />
      )}
      <span className="text-[15px] font-bold">{title}</span>
      {hint !== undefined && <span className="text-[13px] text-[var(--ps-muted)]">{hint}</span>}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f !== undefined) onFile(f);
        }}
      />
    </label>
  );
}

const FIELDS: { key: string; label: string; required: boolean; aliases: string[] }[] = [
  { key: 'name', label: 'Name', required: true, aliases: ['name', 'product', 'item', 'product name', 'item name'] },
  { key: 'category', label: 'Category', required: false, aliases: ['category', 'group', 'department'] },
  { key: 'price', label: 'Price', required: true, aliases: ['price', 'selling price', 'unit price', 'retail price'] },
  { key: 'sku', label: 'SKU', required: false, aliases: ['sku', 'code', 'item code', 'product code'] },
  { key: 'barcode', label: 'Barcode', required: false, aliases: ['barcode', 'ean', 'upc', 'gtin'] },
  { key: 'cost', label: 'Cost', required: false, aliases: ['cost', 'cost price', 'unit cost'] },
  { key: 'tax_class', label: 'Tax class', required: false, aliases: ['tax', 'tax class', 'tax rate'] },
  { key: 'stock', label: 'Stock', required: false, aliases: ['stock', 'quantity', 'qty', 'on hand', 'in stock'] },
  { key: 'description', label: 'Description', required: false, aliases: ['description', 'details'] },
];

/** What the import would refuse in a mapped row (the same checks the import makes). */
function rowProblems(r: Record<string, unknown>, exp: number): string[] {
  const text = (key: string): string | null => (key in r ? String(r[key] ?? '') : null);
  const name = text('name');
  if (name === '') return ['Left out'];
  const out: string[] = [];
  if (name !== null && name.length > 80) out.push('Name over 80 characters');
  const price = text('price');
  if (price !== null && parseMoney(price, exp) === null) out.push(price === '' ? 'No price' : 'Price is not an amount');
  const cost = text('cost');
  if (cost !== null && cost !== '' && parseMoney(cost, exp) === null) out.push('Cost is not an amount');
  const stock = text('stock');
  if (stock !== null && stock !== '' && !Number.isInteger(Number(stock))) out.push('Stock is not a whole number');
  return out;
}

function CsvImport(): React.JSX.Element {
  const { exp } = useApp();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const header = rows?.[0] ?? [];
  const body = rows?.slice(1) ?? [];
  const load = async (f: File): Promise<void> => {
    const parsed = parseCsv(await f.text());
    if (parsed.length < 2) {
      toast.error('The file has no rows under its header');
      return;
    }
    setFileName(f.name);
    setRows(parsed);
    const h = (parsed[0] ?? []).map((x) => x.trim().toLowerCase());
    const auto: Record<string, string> = {};
    for (const fld of FIELDS) {
      const i = h.findIndex((x) => fld.aliases.includes(x));
      auto[fld.key] = i >= 0 ? String(i) : '';
    }
    setMap(auto);
  };
  const ready = FIELDS.filter((f) => f.required).every((f) => (map[f.key] ?? '') !== '');
  const built = useMemo(
    () =>
      body.map((r) => {
        const o: Record<string, unknown> = {};
        for (const f of FIELDS) {
          const idx = map[f.key] ?? '';
          if (idx !== '') o[f.key] = (r[Number(idx)] ?? '').trim();
        }
        return o;
      }),
    [body, map],
  );
  // The rows as the import will number them, the ones with a problem first.
  const checked = useMemo(() => {
    let sent = 0;
    const all = built.map((row) => {
      const problems = rowProblems(row, exp);
      const named = String(row['name'] ?? '') !== '';
      if (named) sent += 1;
      return { row, problems, no: named ? sent : 0 };
    });
    const flagged = all.filter((x) => x.problems.length > 0);
    return { flagged: flagged.length, preview: [...flagged, ...all.filter((x) => x.problems.length === 0)].slice(0, 8) };
  }, [built, exp]);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.importProducts(built.filter((r) => String(r['name'] ?? '') !== ''));
      toast.success(`Added ${plural(res.created, 'product')}${res.categories_created > 0 ? ` and ${plural(res.categories_created, 'category', 'categories')}` : ''}`);
      setRows(null);
      setFileName('');
    } catch {
      /* toasted: the message names the row */
    } finally {
      setBusy(false);
    }
  };
  const extras = FIELDS.filter((f) => f.key !== 'name' && f.key !== 'price');
  return (
    <Panel
      title="From a spreadsheet"
      subtitle="CSV with a header row; you pick the columns"
      actions={
        <Button icon={Download} onClick={() => download('products_template.csv', 'Name,Category,Price,SKU,Barcode,Cost,Tax class,Stock,Description\r\nFlat white,Coffee,4.50,,,,,,\r\n')}>
          Template
        </Button>
      }
    >
      {rows === null ? (
        <DropZone icon={FileSpreadsheet} title="Choose a CSV file" hint="Or drop it here" accept=".csv,text/csv" onFile={(f) => void load(f)} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex min-h-10 min-w-0 flex-1 basis-[200px] items-center gap-3 rounded-full bg-[var(--ps-row)] py-1 pl-1 pr-4 text-[13px] font-semibold">
              <IconBadge icon={FileSpreadsheet} size={32} tone="card" />
              <span className="truncate">
                {fileName} · {body.length === 1 ? '1 row' : `${body.length} rows`}
              </span>
            </p>
            {checked.flagged > 0 && <Badge tone="warn">{checked.flagged === 1 ? '1 row has a problem' : `${checked.flagged} rows have a problem`}</Badge>}
          </div>
          <div className="grid grid-cols-1 items-end gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <Select
                key={f.key}
                label={`${f.label}${f.required ? '' : ' (optional)'}`}
                value={map[f.key] ?? ''}
                onChange={(v) => setMap({ ...map, [f.key]: v })}
                options={[{ value: '', label: f.required ? 'Pick a column' : 'Not in the file' }, ...header.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }))]}
              />
            ))}
          </div>
          <ul className="flex flex-col gap-2" aria-label="The first rows">
            {checked.preview.map((x, i) => {
              const details = extras
                .map((f) => ({ label: f.label, value: String(x.row[f.key] ?? '') }))
                .filter((e) => e.value !== '')
                .map((e) => `${e.label} ${e.value}`)
                .join(' · ');
              const name = String(x.row['name'] ?? '');
              return (
                <li key={i} className={cn(rowCls, 'flex flex-col gap-2 px-4 py-3')}>
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[14px] font-bold', name === '' && 'text-[var(--ps-ink-2)]')}>{name !== '' ? name : 'No name'}</span>
                      <span className="block truncate text-[12px] text-[var(--ps-muted)]">{[x.no > 0 ? `Row ${x.no}` : '', details].filter((s) => s !== '').join(' · ')}</span>
                    </span>
                    <span className="num shrink-0 text-[14px] font-bold">{String(x.row['price'] ?? '')}</span>
                  </div>
                  {x.problems.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {x.problems.map((p) => (
                        <Badge key={p} tone="bad" className="bg-[var(--ps-card)]">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setRows(null)}>Choose another file</Button>
            <Button variant="primary" icon={Upload} disabled={!ready} loading={busy} onClick={() => void run()}>
              Add {built.length === 1 ? '1 product' : `${built.length} products`}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

const IMPORT_STATUS: Record<ImportRec['status'], { label: string; tone: 'info' | 'good' | 'bad' | 'neutral' }> = {
  waiting: { label: 'Waiting for your AI agent', tone: 'neutral' },
  reading: { label: 'Your AI agent is reading it', tone: 'info' },
  done: { label: 'Done', tone: 'good' },
  failed: { label: 'Could not read it', tone: 'bad' },
};
const IMPORT_ICON: Record<ImportRec['kind'], LucideIcon> = { image: ImageIcon, pdf: FileText, sheet: FileSpreadsheet };

function AgentImport({ onReview }: { onReview: () => void }): React.JSX.Element {
  const d = useLive(() => api.imports(), ['imports', 'products'], []);
  const [busy, setBusy] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const now = Date.now();
  const since = (created: string): string => {
    const t = ago(created, now);
    return t === 'now' ? 'Just now' : `${t} ago`;
  };
  const add = async (f: File): Promise<void> => {
    const form = new FormData();
    form.append('file', f);
    setBusy(true);
    try {
      await api.addImport(form);
      toast.success('Your AI agent was asked to read it');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const remove = async (r: ImportRec): Promise<void> => {
    const ok = await confirm('Products it added stay.', `Delete ${r.filename}?`, 'Delete');
    if (!ok) return;
    try {
      await api.deleteImport(r.id);
    } catch {
      /* toasted */
    }
  };
  const drafts = d.data?.drafts ?? 0;
  const imports = d.data?.imports ?? [];
  return (
    <Panel
      tone="sand"
      title="From a menu or price list"
      subtitle="A photo, a PDF or a supplier's list: your AI agent reads it and adds the products for your review"
      actions={<IconBadge icon={Sparkles} size={36} tone="card" />}
    >
      <div className="flex flex-col gap-3">
        <DropZone icon={FileUp} title="Give your AI agent a menu" hint="Drop photos or PDFs" accept="image/*,application/pdf,.csv,.xlsx,.xls,.txt" sand busy={busy} onFile={(f) => void add(f)} />
        {drafts > 0 && (
          <div className="ps-on-card flex flex-wrap items-center gap-3 rounded-[28px] bg-[var(--ps-card)] p-1.5">
            <IconBadge icon={Sparkles} size={36} tone="solid" />
            <span className="min-w-0 flex-1 basis-[120px] text-[13px] font-bold">{drafts === 1 ? '1 product waits for your review' : `${drafts} products wait for your review`}</span>
            <Button size="sm" variant="primary" className="ml-auto" onClick={onReview}>
              Review
            </Button>
          </div>
        )}
        {imports.length > 0 && (
          <ul className="flex flex-col gap-2">
            {imports.map((r) => (
              <li key={r.id} className="ps-on-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] bg-[var(--ps-card)] p-3">
                <div className="flex min-w-0 flex-1 basis-[200px] items-start gap-3">
                  {r.thumb !== '' ? <img src={r.thumb} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <IconBadge icon={IMPORT_ICON[r.kind]} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold">{r.filename}</p>
                    <p className="text-[12px] text-[var(--ps-muted)]">
                      {since(r.created)}
                      {r.added_by === 'agent' ? ' · added by your AI agent' : ''}
                    </p>
                    {r.summary !== '' && <p className="mt-0.5 text-[12px] text-[var(--ps-ink-2)]">{r.summary}</p>}
                    {r.error !== '' && <p className="mt-0.5 text-[12px] font-semibold text-[var(--ps-red-text)]">{r.error}</p>}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Badge tone={IMPORT_STATUS[r.status].tone} pulse={r.status === 'reading'} className="mr-1">
                    {IMPORT_STATUS[r.status].label}
                  </Badge>
                  {r.status === 'failed' && <IconButton icon={RotateCw} label="Ask again" variant="secondary" size={36} onClick={() => void api.retryImport(r.id).catch(() => undefined)} />}
                  <IconButton icon={Trash2} label="Delete" variant="danger" size={36} onClick={() => void remove(r)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmEl}
    </Panel>
  );
}

export function ImportTab({ onReview }: { onReview: () => void }): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
      <AgentImport onReview={onReview} />
      <CsvImport />
    </div>
  );
}
