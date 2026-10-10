/**
 * Purchase orders: what was ordered from suppliers and how much has
 * arrived, filtered by status. Beside them, documents: drop a packing slip
 * or an invoice and your AI agent reads it and records what arrived.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ExternalLink, FileText, Plus, RotateCcw, Sparkles, Trash2, Truck, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Chips, SearchBox } from '../components/controls.tsx';
import { DropZone } from '../components/DropZone.tsx';
import { LocationSelect } from '../components/pickers.tsx';
import { Card, CardHeader, CircleButton, DayPicker, Empty, Field, Modal, PageHeader, PillButton, PillSelect, Popover, StatusPill, TextLink, softInput, useConfirm } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, dayLabel, today } from '../lib/dates.ts';
import { money, plural } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { Doc, Order, OrderStatus } from '../lib/types.ts';

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  ordered: { label: 'Ordered', tone: 'info' },
  partial: { label: 'Partly received', tone: 'warn' },
  received: { label: 'Received', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function OrderStatusPill({ order }: { order: Pick<Order, 'status' | 'closed_short' | 'late'> }): React.JSX.Element {
  if (order.status === 'received' && order.closed_short) return <StatusPill tone="good">Closed</StatusPill>;
  if (order.late) return <StatusPill tone="bad">Late</StatusPill>;
  const s = ORDER_STATUS[order.status];
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

type Filter = 'open' | 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled' | 'all';

/** A date chosen from a small calendar popover. */
export function DateField({
  value,
  onChange,
  label,
  placeholder = 'No date',
  onCard = false,
}: {
  value: string;
  onChange: (d: string) => void;
  label: string;
  placeholder?: string;
  /** On a row-colored surface: draw the field in the card color so it stands out. */
  onCard?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="relative flex items-center gap-2">
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-label={label} aria-expanded={open} className={cn(softInput, 'flex items-center gap-2.5 text-left', onCard && 'bg-[var(--iv-card)]')}>
        <CalendarDays size={16} className="shrink-0 text-[var(--iv-ink-2)]" aria-hidden />
        <span className={value === '' ? 'truncate text-[var(--iv-muted)]' : 'truncate'}>{value !== '' ? dayLabel(value) : placeholder}</span>
      </button>
      {value !== '' && <CircleButton icon={X} label={`Clear ${label.toLowerCase()}`} variant={onCard ? 'light' : 'row'} size={36} onClick={() => onChange('')} />}
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} className="w-[min(296px,calc(100vw-48px))] p-3">
        <DayPicker
          value={value !== '' ? value : today()}
          onPick={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

function NewOrder({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { suppliers, locations } = useApp();
  const [supplier, setSupplier] = useState('');
  const [location, setLocation] = useState(locations.find((l) => l.depth === 0)?.id ?? '');
  const [expected, setExpected] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const o = await api.createOrder({ supplier, location, expected_on: expected, note: note.trim() });
      onClose();
      navigate('order', { id: o.id });
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
      title="New purchase order"
      description="It starts as a draft: add the items, then mark it as ordered when you send it."
      footer={
        <>
          <PillButton variant="light" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant="dark" loading={busy} onClick={() => void create()}>
            Create draft
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <PillSelect soft label="Supplier" value={supplier} onChange={setSupplier} options={[{ value: '', label: 'No supplier' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
        <Field label="Deliver to">
          <LocationSelect value={location} onChange={setLocation} soft ariaLabel="Deliver to" />
        </Field>
        <Field label="Expected">
          <DateField value={expected} onChange={setExpected} label="Expected delivery" placeholder="From the supplier's lead time" />
        </Field>
        <Field label="Note for the supplier">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Optional" aria-label="Note" className={softInput} />
        </Field>
      </div>
    </Modal>
  );
}

function DocRow({ d }: { d: Doc }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const retry = async (): Promise<void> => {
    try {
      await api.retryDocument(d.id);
      toast.success('Sent to your AI agent again');
    } catch {
      /* toasted */
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm(d.batch !== '' ? 'The document is deleted. The stock it recorded stays.' : 'The document is deleted.', 'Delete this document?'))) return;
    try {
      await api.deleteDocument(d.id);
      toast.success('Deleted');
    } catch {
      /* toasted */
    }
  };
  const status: Record<Doc['status'], { label: string; tone: Tone; pulse: boolean }> = {
    waiting: { label: 'With your AI agent', tone: 'info', pulse: true },
    reading: { label: 'Being read', tone: 'info', pulse: true },
    done: { label: 'Recorded', tone: 'good', pulse: false },
    failed: { label: 'Could not read', tone: 'bad', pulse: false },
  };
  const s = status[d.status];
  return (
    <li className="flex gap-3 rounded-[18px] bg-[var(--iv-row)] p-3">
      <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0" aria-label="Open the document">
        {d.thumb !== null ? (
          <img src={d.thumb} alt="" className="h-14 w-11 rounded-[10px] object-cover" />
        ) : (
          <span className="flex h-14 w-11 items-center justify-center rounded-[10px] bg-[var(--iv-card)]">
            <FileText size={18} aria-hidden />
          </span>
        )}
      </a>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={s.tone} pulse={s.pulse}>
            {s.label}
          </StatusPill>
          <span className="text-[12px] text-[var(--iv-muted)]">{ago(d.created)}</span>
        </div>
        {d.summary !== '' && <p className="mt-1.5 text-[13px]">{d.summary}</p>}
        {d.error !== '' && <p className="mt-1.5 text-[13px] font-semibold text-[var(--iv-red-text)]">{d.error}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {d.order !== null && <TextLink onClick={() => navigate('order', { id: d.order?.id ?? '' })}>{d.order.number}</TextLink>}
          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--iv-muted)] hover:text-[var(--iv-ink)]">
            <ExternalLink size={12} aria-hidden /> Open
          </a>
          {d.status === 'failed' && (
            <button type="button" onClick={() => void retry()} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--iv-muted)] hover:text-[var(--iv-ink)]">
              <RotateCcw size={12} aria-hidden /> Try again
            </button>
          )}
        </div>
      </div>
      <CircleButton icon={Trash2} label="Delete document" variant="light" size={32} onClick={() => void remove()} />
      {confirmEl}
    </li>
  );
}

function Documents(): React.JSX.Element {
  const docs = useLive(() => api.documents(), ['documents'], []);
  const [busy, setBusy] = useState(false);
  const upload = async (files: File[]): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.addDocuments(files);
      toast.success(`${plural(r.documents.length, 'document')} sent to your AI agent`);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const list = docs.data?.documents ?? [];
  return (
    <Card delay={2}>
      <CardHeader title="Packing slips and invoices" subtitle="Your AI agent reads them and records what arrived" action={<Sparkles size={18} className="text-[var(--iv-ink-2)]" aria-hidden />} />
      <DropZone icon={FileText} title="Drop photos or PDFs" hint="or click to choose; up to 20 at once" accept="image/*,application/pdf" multiple busy={busy} onFiles={(f) => void upload(f.slice(0, 20))} />
      {list.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {list.slice(0, 12).map((d) => (
            <DocRow key={d.id} d={d} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OrdersPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { currency } = useApp();
  const [status, setStatus] = useState<Filter>((query.get('status') as Filter | null) ?? 'open');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => replaceQuery('orders', { status: status === 'open' ? '' : status }), [status]);

  const list = useLive(() => api.orders({ status, q, limit: 200 }), ['orders', 'order_lines', 'suppliers', 'items'], [status, q]);
  const data = list.data;
  const c = data?.counts;

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        subtitle={c !== undefined ? `${plural(c.open, 'open order')}${c.late > 0 ? `, ${c.late} late` : ''}` : ' '}
        actions={
          <PillButton variant="dark" icon={Plus} dot onClick={() => setCreating(true)}>
            New order
          </PillButton>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-4 lg:col-span-8">
          <div className="iv-rise iv-d1 flex flex-wrap items-center gap-3">
            <Chips
              ariaLabel="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'open', label: 'Open', ...(c !== undefined ? { count: c.open } : {}) },
                { value: 'draft', label: 'Drafts', ...(c !== undefined ? { count: c.draft } : {}) },
                { value: 'ordered', label: 'Ordered', ...(c !== undefined ? { count: c.ordered } : {}) },
                { value: 'partial', label: 'Partly received', ...(c !== undefined ? { count: c.partial } : {}) },
                { value: 'received', label: 'Received', ...(c !== undefined ? { count: c.received } : {}) },
                { value: 'cancelled', label: 'Cancelled', ...(c !== undefined ? { count: c.cancelled } : {}) },
                { value: 'all', label: 'All' },
              ]}
            />
            <SearchBox value={text} onChange={setText} placeholder="Search number, supplier, note" ariaLabel="Search orders" className="min-w-[14rem] flex-1" />
          </div>
          {data !== null && data.orders.length === 0 ? (
            <Card>
              <Empty icon={Truck} title={q !== '' ? 'Nothing matches' : status === 'open' ? 'No open orders' : 'No orders here'} action={<PillButton variant="light" onClick={() => navigate('reorder')}>See what to reorder</PillButton>}>
                Draft orders come from the Reorder page, from your AI agent, or from New order.
              </Empty>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {(data?.orders ?? []).map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => navigate('order', { id: o.id })}
                  className={`iv-rise iv-d${Math.min(5, i + 1)} flex flex-col gap-3 rounded-[24px] bg-[var(--iv-card)] p-4 text-left transition-shadow hover:shadow-[0_20px_40px_-30px_rgba(29,28,26,0.6)] md:p-5`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--iv-row)]">
                      <Truck size={18} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">
                        {o.number} · {o.supplier?.name ?? 'No supplier'}
                      </span>
                      <span className="block truncate text-[13px] text-[var(--iv-muted)]">
                        {plural(o.line_count, 'line')}
                        {o.status === 'draft' ? ` · started ${ago(o.created)}` : o.expected_on !== '' && o.status !== 'received' && o.status !== 'cancelled' ? ` · expected ${dayLabel(o.expected_on)}` : ''}
                        {o.status === 'received' && o.received_on !== '' ? ` · received ${dayLabel(o.received_on)}` : ''}
                      </span>
                    </span>
                    {o.origin === 'agent' && (
                      <span className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--iv-accent)]/25 px-2.5 text-[12px] font-semibold">
                        <Sparkles size={12} aria-hidden /> AI agent
                      </span>
                    )}
                    <OrderStatusPill order={o} />
                    <span className="num w-24 text-right text-[15px] font-bold">{money(o.value, currency)}</span>
                  </div>
                  {(o.status === 'ordered' || o.status === 'partial') && (
                    <span className="flex items-center gap-3">
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--iv-line)]">
                        <span className="block h-full rounded-full bg-[var(--iv-ink)] transition-[width] duration-500" style={{ width: `${Math.max(2, o.progress * 100)}%` }} />
                      </span>
                      <span className="num text-[12px] font-semibold text-[var(--iv-muted)]">{Math.round(o.progress * 100)}% arrived</span>
                    </span>
                  )}
                </button>
              ))}
              {data === null && Array.from({ length: 3 }, (_, i) => <span key={i} className="h-24 animate-pulse rounded-[24px] bg-[var(--iv-card)]" />)}
            </div>
          )}
        </div>
        <div className="lg:col-span-4">
          <Documents />
        </div>
      </div>
      {creating && <NewOrder onClose={() => setCreating(false)} />}
    </div>
  );
}
