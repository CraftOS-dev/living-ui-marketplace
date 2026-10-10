/**
 * One purchase order: its lines (editable until it is received), what has
 * arrived, and the next step for its status: mark as ordered (or let your
 * AI agent email it to the supplier), receive what arrived, close it short,
 * cancel or reopen. Receipts show in its history with Undo.
 */
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Check,
  CircleCheck,
  Copy,
  Download,
  FileText,
  History,
  Mail,
  PackageCheck,
  PackageOpen,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AskAgent } from '../components/AskAgent.tsx';
import { Menu, Stepper } from '../components/controls.tsx';
import { ItemSearch, LocationSelect } from '../components/pickers.tsx';
import { BatchCard, groupBatches } from '../components/rows.tsx';
import { useStockChange } from '../components/StockChange.tsx';
import { Card, CardHeader, CircleButton, Empty, Field, Modal, PillButton, PillSelect, TextLink, errMessage, softInput, useConfirm } from '../components/ui.tsx';
import { api, download } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, dayPhrase, today } from '../lib/dates.ts';
import { money, normalizeNumber, plain, plural, qty, symbolOf, unitCost } from '../lib/format.ts';
import { ItemThumb } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { back, navigate } from '../lib/router.ts';
import type { OrderDetail, OrderLine } from '../lib/types.ts';
import { DateField, OrderStatusPill } from './Orders.tsx';

function CostCell({ line, editable, currency }: { line: OrderLine; editable: boolean; currency: string }): React.JSX.Element {
  const [text, setText] = useState(line.unit_cost_e4 > 0 ? line.unit_cost : '');
  useEffect(() => setText(line.unit_cost_e4 > 0 ? line.unit_cost : ''), [line.unit_cost, line.unit_cost_e4]);
  if (!editable) return <span className="num text-[13px]">{line.unit_cost_e4 > 0 ? unitCost(line.unit_cost, currency) : '-'}</span>;
  const save = (): void => {
    const t = text.trim();
    const n = t === '' ? '0' : normalizeNumber(t, 4);
    if (n === null) {
      toast.error('Enter the cost like 2.35');
      setText(line.unit_cost_e4 > 0 ? line.unit_cost : '');
      return;
    }
    if (n === (line.unit_cost_e4 > 0 ? line.unit_cost : '0')) return;
    api.updateLine(line.id, { unit_cost: n }).catch(() => undefined);
  };
  return (
    <span className="relative inline-block w-28">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--iv-muted)]">{symbolOf(currency)}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        inputMode="decimal"
        placeholder="0.00"
        aria-label={`${line.item.name} cost per unit`}
        className="num h-9 w-full rounded-full bg-[var(--iv-card)] pl-7 pr-3 text-[13px] font-semibold outline-none ring-[var(--iv-ink)] focus-visible:ring-2"
      />
    </span>
  );
}

function ReceiveModal({ order, onClose }: { order: OrderDetail; onClose: () => void }): React.JSX.Element {
  const change = useStockChange();
  const open = order.lines.filter((l) => l.remaining > 0);
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.id, plain(l.remaining)])));
  const [location, setLocation] = useState(order.location?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receive = async (): Promise<void> => {
    const lines: { line: string; qty: string }[] = [];
    for (const l of open) {
      const n = normalizeNumber(qtys[l.id] ?? '0', l.item.fractional === true ? 3 : 0);
      if (n === null) {
        setError(`Check the quantity of ${l.item.name}`);
        return;
      }
      if (Number(n) > 0) lines.push({ line: l.id, qty: n });
    }
    if (lines.length === 0) {
      setError('Nothing to receive: every quantity is 0');
      return;
    }
    if (location === '') {
      setError('Choose where it goes');
      return;
    }
    setBusy(true);
    try {
      const r = await api.receive(order.id, { lines, location, ...(note.trim() !== '' ? { note: note.trim() } : {}) });
      onClose();
      change.saved(r.status === 'received' ? `${order.number} received in full` : `Received ${plural(lines.length, 'line')} of ${order.number}`, r.batch);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Receive ${order.number}`}
      description="Check what arrived. Lines that came short stay open for the rest."
      xl
      footer={
        <>
          <PillButton variant="light" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant="dark" icon={PackageCheck} loading={busy} onClick={() => void receive()}>
            Receive
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {open.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--iv-row)] p-3">
              <ItemThumb photo={l.item.photo} icon={l.item.icon} size={40} tone="card" rounded="rounded-[12px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold">{l.item.name}</span>
                <span className="block text-[12px] text-[var(--iv-muted)]">
                  {qty(l.remaining)} of {qty(l.qty)} {l.item.unit} still to come
                </span>
              </span>
              <span className="flex items-center gap-2">
                <button type="button" onClick={() => setQtys((q) => ({ ...q, [l.id]: '0' }))} className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-[var(--iv-muted)] hover:bg-[var(--iv-row-hover)]">
                  None
                </button>
                <Stepper value={qtys[l.id] ?? '0'} onChange={(v) => setQtys((q) => ({ ...q, [l.id]: v }))} fractional={l.item.fractional === true} min={0} ariaLabel={`${l.item.name} arrived`} size="sm" />
              </span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Put it in">
            <LocationSelect value={location} onChange={setLocation} soft ariaLabel="Where it goes" />
          </Field>
          <Field label="Note">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Optional, e.g. delivery note number" aria-label="Note" className={softInput} />
          </Field>
        </div>
        {error !== null && <p className="text-[13px] font-semibold text-[var(--iv-red-text)]">{error}</p>}
      </div>
    </Modal>
  );
}

function TextModal({ order, onClose }: { order: OrderDetail; onClose: () => void }): React.JSX.Element {
  const t = useLive(() => api.orderText(order.id), ['orders', 'order_lines'], [order.id]);
  const copy = async (): Promise<void> => {
    if (t.data === null) return;
    try {
      await navigator.clipboard.writeText(t.data.text);
      toast.success('Copied');
    } catch {
      toast.info('Select the text and copy it');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${order.number} as text`}
      description={t.data !== null && t.data.to !== '' ? `For ${t.data.to}` : 'Paste it into an email or a message to the supplier.'}
      wide
      footer={
        <>
          <PillButton variant="light" icon={Download} onClick={() => t.data !== null && download(`${order.number}.txt`, t.data.text, 'text/plain')}>
            Download
          </PillButton>
          <PillButton variant="dark" icon={Copy} onClick={() => void copy()}>
            Copy
          </PillButton>
        </>
      }
    >
      <textarea
        readOnly
        value={t.data?.text ?? ''}
        rows={12}
        aria-label="Order text"
        onFocus={(e) => e.target.select()}
        className="num w-full resize-none rounded-[20px] bg-[var(--iv-row)] p-4 text-[13px] leading-5 outline-none"
      />
    </Modal>
  );
}

export function OrderPage({ id }: { id: string }): React.JSX.Element {
  const { currency, suppliers } = useApp();
  const live = useLive(() => api.order(id), ['orders', 'order_lines', 'movements', 'documents', 'suppliers', 'items'], [id]);
  const o = live.data;
  const [receiving, setReceiving] = useState(false);
  const [showText, setShowText] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [expected, setExpected] = useState('');
  const [note, setNote] = useState('');
  const [confirmEl, confirm] = useConfirm();

  useEffect(() => {
    if (o !== null) setNote(o.note);
  }, [o?.note]); // eslint-disable-line react-hooks/exhaustive-deps

  if (o === null) {
    return live.error !== null ? (
      <Card>
        <Empty icon={PackageOpen} title="This order is gone" action={<PillButton variant="dark" onClick={() => navigate('orders')}>Back to orders</PillButton>}>
          It may have been deleted.
        </Empty>
      </Card>
    ) : (
      <span className="block h-72 animate-pulse rounded-[24px] bg-[var(--iv-card)]" />
    );
  }

  const editable = o.status === 'draft' || o.status === 'ordered' || o.status === 'partial';
  const act = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await fn();
      toast.success(done);
    } catch {
      /* toasted */
    }
  };
  const remove = async (): Promise<void> => {
    try {
      const p = await api.deleteOrder(o.id, true);
      const ok = await confirm(
        `${o.number} and its ${plural(p.lines, 'line')} are deleted.${p.receipts_kept_in_history > 0 ? ' Stock it already brought in stays.' : ''}`,
        'Delete this order?',
      );
      if (!ok) return;
      await api.deleteOrder(o.id);
      toast.success('Deleted');
      navigate('orders');
    } catch {
      /* toasted */
    }
  };
  const lead = o.supplier?.lead_time_days ?? 0;
  const batches = groupBatches(o.receipts);

  return (
    <div className="flex flex-col gap-5">
      <header className="iv-rise flex flex-wrap items-center gap-4">
        <CircleButton icon={ArrowLeft} label="Back" size={44} onClick={() => back('orders')} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-3 text-[26px] font-bold leading-[34px] tracking-[-0.01em]">
            {o.number}
            <OrderStatusPill order={o} />
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-[var(--iv-muted)]">
            {o.supplier?.name ?? 'No supplier'}
            {o.ordered_on !== '' ? ` · ordered ${dayPhrase(o.ordered_on)}` : ''}
            {o.expected_on !== '' && o.status !== 'received' ? ` · expected ${dayPhrase(o.expected_on)}` : ''}
            {o.received_on !== '' ? ` · received ${dayPhrase(o.received_on)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {o.status === 'draft' && (
            <>
              {o.supplier !== null && o.supplier.email !== '' && o.line_count > 0 && <AskAgent trigger="order_send_requested" params={{ order_id: o.id }} label="Email it with your AI agent" variant="light" />}
              <PillButton
                variant="dark"
                icon={Check}
                dot
                disabled={o.line_count === 0}
                onClick={() => {
                  setExpected(o.expected_on !== '' ? o.expected_on : lead > 0 ? addDays(today(), lead) : '');
                  setOrdering(true);
                }}
              >
                Mark as ordered
              </PillButton>
            </>
          )}
          {(o.status === 'ordered' || o.status === 'partial') && (
            <PillButton variant="dark" icon={PackageCheck} dot onClick={() => setReceiving(true)}>
              Receive
            </PillButton>
          )}
          {o.status === 'cancelled' && (
            <PillButton variant="light" icon={RotateCcw} onClick={() => void act(() => api.reopenOrder(o.id), 'Back as a draft')}>
              Reopen as draft
            </PillButton>
          )}
          <Menu
            items={[
              { label: 'Order as text', icon: FileText, onClick: () => setShowText(true) },
              { label: 'Back to draft', icon: Undo2, hidden: o.status !== 'ordered', onClick: () => void act(() => api.backToDraft(o.id), 'Back to draft') },
              {
                label: 'Close: the rest is not coming',
                icon: CircleCheck,
                hidden: o.status !== 'partial',
                onClick: () => void act(() => api.closeOrder(o.id), 'Closed'),
              },
              { label: 'Reopen', icon: RotateCcw, hidden: !(o.status === 'received' && o.closed_short), onClick: () => void act(() => api.reopenOrder(o.id), 'Reopened') },
              { label: 'Cancel the order', icon: Ban, hidden: !(o.status === 'draft' || o.status === 'ordered'), onClick: () => void act(() => api.cancelOrder(o.id), 'Cancelled') },
              { label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove() },
            ]}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-5 lg:col-span-8">
          {o.agent_note !== '' && (
            <Card tone="sand" className="flex gap-3 !py-4" delay={1}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)]">
                <Sparkles size={16} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold">Your AI agent's note</p>
                <p className="text-[14px] leading-[22px]">{o.agent_note}</p>
              </div>
            </Card>
          )}

          <Card delay={2}>
            <CardHeader
              title="Lines"
              subtitle={`${plural(o.line_count, 'line')} · ${qty(o.qty)} units${o.status !== 'draft' ? ` · ${qty(o.received)} arrived` : ''}`}
              action={editable ? <PillButton variant="soft" icon={Plus} onClick={() => setAdding(true)}>Add item</PillButton> : undefined}
            />
            {o.lines.length === 0 ? (
              <Empty icon={PackageOpen} title="No lines yet" action={editable ? <PillButton variant="dark" icon={Plus} dot onClick={() => setAdding(true)}>Add an item</PillButton> : undefined} />
            ) : (
              <ul className="flex flex-col gap-2">
                {o.lines.map((l) => (
                  <li key={l.id} className="flex flex-col gap-3 rounded-[18px] bg-[var(--iv-row)] p-3 md:flex-row md:items-center">
                    <button type="button" onClick={() => navigate('item', { id: l.item.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <ItemThumb photo={l.item.photo} icon={l.item.icon} size={42} tone="card" rounded="rounded-[12px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{l.item.name}</span>
                        <span className="block truncate text-[12px] text-[var(--iv-muted)]">
                          {l.item.sku}
                          {o.status !== 'draft' ? ` · ${qty(l.received)} of ${qty(l.qty)} arrived` : ''}
                        </span>
                        {o.status !== 'draft' && (
                          <span className="mt-1.5 block h-1.5 max-w-48 overflow-hidden rounded-full bg-[var(--iv-line)]">
                            <span className={cn('block h-full rounded-full', l.remaining === 0 ? 'bg-[var(--iv-green)]' : 'bg-[var(--iv-ink)]')} style={{ width: `${l.qty > 0 ? Math.max(3, Math.min(1, l.received / l.qty) * 100) : 0}%` }} />
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {editable ? (
                        <Stepper
                          size="sm"
                          value={plain(l.qty)}
                          min={l.received > 0 ? l.received : 0}
                          fractional={l.item.fractional === true}
                          ariaLabel={`${l.item.name} ordered`}
                          onChange={(v) => {
                            if (Number(v) <= 0) return;
                            api.updateLine(l.id, { qty: v }).catch(() => undefined);
                          }}
                        />
                      ) : (
                        <span className="num text-[13px] font-bold">
                          {qty(l.qty)} {l.item.unit}
                        </span>
                      )}
                      <CostCell line={l} editable={editable} currency={currency} />
                      <span className="num w-24 text-right text-[14px] font-bold">{money(l.total, currency)}</span>
                      {editable && l.received === 0 && (
                        <CircleButton icon={X} label={`Remove ${l.item.name}`} variant="light" size={32} onClick={() => void act(() => api.removeLine(l.id), 'Line removed')} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {o.lines.length > 0 && (
              <div className="mt-4 flex items-center justify-between border-t border-[var(--iv-line)] pt-4">
                <span className="text-[13px] text-[var(--iv-muted)]">Total</span>
                <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(o.value, currency)}</span>
              </div>
            )}
          </Card>

          <Card delay={3}>
            <CardHeader title="Received" subtitle={batches.length > 0 ? 'Each delivery, with Undo' : undefined} />
            {batches.length === 0 ? (
              <Empty icon={History} title="Nothing has arrived yet">
                {o.status === 'draft' ? 'Once it is ordered, receive deliveries here or let your AI agent read the packing slip.' : 'Receive deliveries here, or drop the packing slip on the Purchase orders page for your AI agent.'}
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {batches.map((b) => (
                  <BatchCard key={b[0]?.batch} rows={b} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-4">
          <Card delay={2}>
            <CardHeader title="Details" />
            <div className="flex flex-col gap-4">
              <PillSelect
                soft
                label="Supplier"
                value={o.supplier?.id ?? ''}
                onChange={(v) => void act(() => api.updateOrder(o.id, { supplier: v }), 'Supplier changed')}
                options={[{ value: '', label: 'No supplier' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
              />
              <Field label="Deliver to">
                <LocationSelect value={o.location?.id ?? ''} onChange={(v) => void act(() => api.updateOrder(o.id, { location: v }), 'Saved')} soft ariaLabel="Deliver to" />
              </Field>
              <Field label="Expected">
                <DateField value={o.expected_on} onChange={(d) => void act(() => api.updateOrder(o.id, { expected_on: d }), 'Saved')} label="Expected delivery" />
              </Field>
              <Field label="Note for the supplier">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => note !== o.note && void act(() => api.updateOrder(o.id, { note }), 'Saved')}
                  rows={3}
                  maxLength={1000}
                  placeholder="Optional"
                  aria-label="Note for the supplier"
                  className="w-full resize-none rounded-[20px] bg-[var(--iv-row)] px-5 py-3 text-[14px] outline-none ring-[var(--iv-ink)] focus-visible:ring-2"
                />
              </Field>
            </div>
          </Card>
          {o.supplier !== null && (
            <Card delay={3}>
              <CardHeader title={o.supplier.name} subtitle={o.supplier.contact !== '' ? o.supplier.contact : 'Supplier'} />
              <div className="flex flex-col gap-2 text-[13px]">
                {o.supplier.email !== '' && (
                  <a href={`mailto:${o.supplier.email}?subject=${encodeURIComponent(`Purchase order ${o.number}`)}`} className="inline-flex items-center gap-2 font-semibold hover:underline">
                    <Mail size={14} aria-hidden /> {o.supplier.email}
                  </a>
                )}
                {o.supplier.phone !== '' && <span className="num">{o.supplier.phone}</span>}
                {o.supplier.lead_time_days > 0 && <span className="text-[var(--iv-muted)]">Usually {plural(o.supplier.lead_time_days, 'day')} to arrive</span>}
                <TextLink tone="muted" onClick={() => navigate('suppliers', { id: o.supplier?.id ?? '' })} className="self-start">
                  Supplier details
                </TextLink>
              </div>
            </Card>
          )}
          {o.documents.length > 0 && (
            <Card delay={4}>
              <CardHeader title="Documents" />
              <ul className="flex flex-col gap-2">
                {o.documents.map((d) => (
                  <li key={d.id}>
                    <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-[16px] bg-[var(--iv-row)] px-3 py-2 text-[13px] hover:bg-[var(--iv-row-hover)]">
                      <FileText size={15} aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-semibold">{d.summary !== '' ? d.summary : d.file}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {receiving && <ReceiveModal order={o} onClose={() => setReceiving(false)} />}
      {showText && <TextModal order={o} onClose={() => setShowText(false)} />}
      <Modal open={adding} onClose={() => setAdding(false)} title={`Add to ${o.number}`} description="Already on the order? Its quantity goes up instead." wide>
        <ItemSearch
          autoFocus
          onPick={(it) => {
            setAdding(false);
            const n = it.reorder_qty > 0 ? plain(it.reorder_qty) : '1';
            void act(() => api.addLine(o.id, it.id, n), `Added ${it.name}`);
          }}
        />
      </Modal>
      <Modal
        open={ordering}
        onClose={() => setOrdering(false)}
        title={`Mark ${o.number} as ordered`}
        description="Do this once it is sent to the supplier. Its quantities then count as coming in."
        footer={
          <>
            <PillButton variant="light" onClick={() => setOrdering(false)}>
              Cancel
            </PillButton>
            <PillButton
              variant="dark"
              icon={Check}
              onClick={() => {
                setOrdering(false);
                void act(() => api.markOrdered(o.id, expected !== '' ? expected : undefined), 'Marked as ordered');
              }}
            >
              Mark as ordered
            </PillButton>
          </>
        }
      >
        <Field label="Expected delivery" hint={lead > 0 ? `${o.supplier?.name} usually takes ${plural(lead, 'day')}.` : undefined}>
          <DateField value={expected} onChange={setExpected} label="Expected delivery" />
        </Field>
      </Modal>
      {confirmEl}
    </div>
  );
}
