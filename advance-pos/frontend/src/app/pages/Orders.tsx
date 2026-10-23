/**
 * Sales: every paid sale, open ticket and cleared sale, searchable by
 * receipt number, customer or ticket name. A sale's page shows its lines,
 * payments, returns and history, and prints or sends its receipt; returns
 * start from it. Sales are permanent records: they are corrected with
 * returns, never edited or deleted.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Gift, Mail, Printer, ReceiptText, RotateCcw, ShoppingBag } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { qty as qtyText, when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { printReceipt, tenderName } from '../lib/print.ts';
import { back, href, navigate, replaceQuery } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import type { OrderSummary } from '../lib/types.ts';
import { DateRange, LoadMore, OrderBadge, SearchField, presetRange, useDebounced } from '../components/common.tsx';
import type { Range } from '../components/common.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { handToSell } from '../components/sell/intent.ts';
import { Badge, Button, Empty, Modal, PageHeader, Panel, Segmented, Stat, Toggle, inputCls } from '../components/ui.tsx';

type Status = 'paid' | 'open' | 'void' | 'all';

export function OrdersPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { money } = useStore();
  const { can } = useSession();
  const [status, setStatus] = useState<Status>(((query.get('status') as Status | null) ?? 'paid') as Status);
  const [range, setRange] = useState<Range>({ from: query.get('from') ?? presetRange('today').from, to: query.get('to') ?? presetRange('today').to });
  const [q, setQ] = useState(query.get('q') ?? '');
  const [returns, setReturns] = useState(false);
  const [pages, setPages] = useState(1);
  const term = useDebounced(q, 250);
  const reports = can('view_reports');

  useEffect(() => {
    replaceQuery('orders', { status: status === 'paid' ? '' : status, from: range.from, to: range.to, q: term });
    setPages(1);
  }, [status, range, term]);

  const list = useLive(
    () => api.orders({ status, q: term.trim() || undefined, from: status === 'open' ? undefined : range.from, to: status === 'open' ? undefined : range.to, returns: returns || undefined, limit: 50 * pages }),
    ['orders'],
    [status, range.from, range.to, term, returns, pages],
  );
  const rows = list.data?.orders ?? [];

  const total = rows.filter((o) => o.status === 'paid').reduce((a, o) => a + o.total, 0);

  return (
    <div>
      <PageHeader title="Sales" subtitle={reports ? 'Receipts, open tickets and cleared sales' : 'Today on this register'} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Which sales"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'paid', label: 'Paid' },
            { value: 'open', label: 'Open tickets' },
            { value: 'void', label: 'Cleared' },
            { value: 'all', label: 'All' },
          ]}
        />
        {status !== 'open' && reports && <DateRange value={range} onChange={setRange} />}
        <SearchField value={q} onChange={setQ} placeholder="Receipt, customer or ticket" className="w-full sm:w-64" />
        {status !== 'open' && (
          <label className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ps-ink-2)]">
            <Toggle checked={returns} onChange={setReturns} label="Only sales with returns" />
            With returns
          </label>
        )}
        {status === 'paid' && rows.length > 0 && <span className="num ml-auto text-[12px] text-[var(--ps-muted)]">{rows.length + (list.data?.more ? '+' : '')} sales &middot; {money.fmt(total)}</span>}
      </div>
      <Panel padded={false}>
        {list.loading && rows.length === 0 ? (
          <div className="py-10" />
        ) : rows.length === 0 ? (
          <Empty icon={ReceiptText} title={status === 'open' ? 'No open tickets' : 'No sales in these days'} compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>{status === 'open' ? 'Updated' : 'Time'}</th>
                  <th>Customer or ticket</th>
                  <th className="hidden md:table-cell">Staff</th>
                  <th className="text-right">Items</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o: OrderSummary) => (
                  <tr key={o.id} className="cursor-pointer" onClick={() => navigate('order', { id: o.id })}>
                    <td className="num font-semibold">
                      <a href={href('order', { id: o.id })} onClick={(e) => e.stopPropagation()} className="hover:underline">
                        {o.number !== '' ? o.number : 'Ticket'}
                      </a>
                    </td>
                    <td className="whitespace-nowrap text-[var(--ps-ink-2)]">{when(o.status === 'paid' ? o.paid_at : o.updated)}</td>
                    <td className="max-w-[220px] truncate">{o.customer !== null ? o.customer.name : o.label !== '' ? o.label : <span className="text-[var(--ps-muted)]">Walk-in</span>}</td>
                    <td className="hidden text-[var(--ps-ink-2)] md:table-cell">{o.staff}</td>
                    <td className="num text-right">{qtyText(o.items)}</td>
                    <td className={cn('num text-right font-semibold', o.total < 0 && 'text-[var(--ps-red-text)]')}>{money.fmt(o.total + o.tip)}</td>
                    <td>
                      <OrderBadge status={o.status} returnStatus={o.return_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore more={list.data?.more === true} loading={list.loading} onMore={() => setPages((p) => p + 1)} />
      </Panel>
    </div>
  );
}

function SendReceipt({ order, initial, onClose }: { order: string; initial: string; onClose: () => void }): React.JSX.Element {
  const [contact, setContact] = useState(initial);
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.ask('receipt', { order, contact: contact.trim() });
      toast.success(r.asked ? 'Your AI agent is sending the receipt' : r.message);
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Send the receipt"
      description="Your AI agent sends it by email or text message."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Mail} loading={busy} disabled={contact.trim() === ''} onClick={() => void send()}>
            Send
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input autoFocus className={inputCls} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone" aria-label="Email or phone" />
      </form>
    </Modal>
  );
}

export function OrderPage({ id }: { id: string }): React.JSX.Element {
  const { money } = useStore();
  const { can } = useSession();
  const o = useLive(() => api.order(id), ['orders', 'order_lines', 'payments'], [id]);
  const events = useLive(() => (can('view_reports') ? api.events({ order: id, limit: 50 }) : Promise.resolve(null)), ['events'], [id]);
  const [sending, setSending] = useState(false);
  const [printing, setPrinting] = useState<'receipt' | 'gift' | null>(null);
  const order = o.data?.order ?? null;

  if (order === null) {
    return o.error !== null ? (
      <Empty icon={ReceiptText} title="This sale could not be found" action={<Button onClick={() => navigate('orders')}>All sales</Button>}>
        {o.error}
      </Empty>
    ) : (
      <div className="py-16" />
    );
  }

  const print = async (gift: boolean): Promise<void> => {
    setPrinting(gift ? 'gift' : 'receipt');
    try {
      const r = await api.receipt(order.id);
      await printReceipt(r.receipt, money, gift);
    } catch {
      // Shown by the transport.
    } finally {
      setPrinting(null);
    }
  };

  const returnable = Object.values(order.returnable ?? {}).some((n) => n > 0);
  const title = order.status === 'open' ? (order.label !== '' ? order.label : 'Open ticket') : order.status === 'void' ? 'Cleared sale' : 'Receipt ' + order.number;

  return (
    <div>
      <div className="mb-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => back('orders')}>
          Sales
        </Button>
      </div>
      <PageHeader
        title={title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <OrderBadge status={order.status} returnStatus={order.return_status} />
            <span>{when(order.status === 'paid' ? order.paid_at : order.status === 'void' ? order.voided_at : order.updated)}</span>
            {order.register !== null && <span>&middot; {order.register.name}</span>}
            {order.closed_by !== '' && <span>&middot; {order.closed_by}</span>}
          </span>
        }
        actions={
          order.status === 'paid' ? (
            <>
              <Button icon={Printer} loading={printing === 'receipt'} onClick={() => void print(false)}>
                Print
              </Button>
              {order.total > 0 && (
                <Button icon={Gift} loading={printing === 'gift'} onClick={() => void print(true)}>
                  Gift receipt
                </Button>
              )}
              <Button icon={Mail} onClick={() => setSending(true)}>
                Send
              </Button>
              {returnable && (
                <Button variant="primary" icon={RotateCcw} onClick={() => handToSell({ kind: 'return', from: order.id })}>
                  Return items
                </Button>
              )}
            </>
          ) : order.status === 'open' ? (
            <>
              <DeleteButton collection="orders" id={order.id} name={title} variant="button" label="Clear" onDeleted={() => navigate('orders', { status: 'open' })} />
              <Button variant="primary" icon={ShoppingBag} onClick={() => handToSell({ kind: 'open', order: order.id })}>
                Open on the register
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Items" padded={false}>
            <div className="overflow-x-auto">
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Each</th>
                    <th className="text-right">Discount</th>
                    <th className="text-right">Tax</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l) => {
                    const src = l.return_of !== '' ? order.sources[l.return_of] : undefined;
                    const canBack = order.returnable?.[l.id];
                    return (
                      <tr key={l.id}>
                        <td className="py-1.5">
                          <span className="block font-semibold">
                            {l.name}
                            {l.variant_title !== '' && <span className="font-medium text-[var(--ps-ink-2)]"> &middot; {l.variant_title}</span>}
                          </span>
                          <span className="block text-[12px] text-[var(--ps-muted)]">
                            {[l.sku !== '' ? 'SKU ' + l.sku : '', l.modifiers.map((m) => m.name).join(', '), l.note, l.gift_code !== '' ? 'Card •••• ' + l.gift_code.slice(-4) : ''].filter((x) => x !== '').join(' · ')}
                          </span>
                          {src !== undefined && (
                            <a href={href('order', { id: src.order })} className="block text-[12px] font-semibold text-[var(--ps-red-text)] hover:underline">
                              Returned from receipt {src.number}
                              {l.restock ? '' : ', not restocked'}
                            </a>
                          )}
                          {l.returned_qty > 0 && <span className="block text-[12px] font-semibold text-[var(--ps-amber-text)]">{qtyText(l.returned_qty)} returned{canBack !== undefined && canBack > 0 ? ', ' + qtyText(canBack) + ' can still come back' : ''}</span>}
                          {l.price_override !== null && (
                            <span className="block text-[12px] text-[var(--ps-amber-text)]">
                              Price changed from {money.fmt(l.price_override.from)}
                              {l.price_override.approved_by !== '' ? ', approved by ' + l.price_override.approved_by : ''}
                            </span>
                          )}
                        </td>
                        <td className="num text-right">
                          {qtyText(l.qty)}
                          {l.unit !== '' ? ' ' + l.unit : ''}
                        </td>
                        <td className="num text-right">{money.fmt(l.unit_price + l.modifiers.reduce((a, m) => a + m.price, 0))}</td>
                        <td className="num text-right text-[var(--ps-green-text)]">{l.discount !== 0 ? money.fmt(-l.discount) : ''}</td>
                        <td className="num text-right text-[var(--ps-ink-2)]">{money.fmt(l.tax)}</td>
                        <td className={cn('num text-right font-semibold', l.total < 0 && 'text-[var(--ps-red-text)]')}>{money.fmt(l.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {(order.returns ?? []).length > 0 && (
            <Panel title="Returns from this sale">
              <ul className="flex flex-wrap gap-2">
                {(order.returns ?? []).map((r) => (
                  <li key={r.id}>
                    <a href={href('order', { id: r.id })} className="inline-flex items-center gap-1.5 rounded-[var(--ps-r)] border border-[var(--ps-line)] px-2 py-1 text-[12px] font-semibold hover:bg-[var(--ps-row)]">
                      {r.number !== '' ? 'Receipt ' + r.number : 'Open return'}
                      <ExternalLink size={12} />
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {events.data !== null && events.data !== undefined && events.data.events.length > 0 && (
            <Panel title="History" padded={false}>
              <ul className="divide-y divide-[var(--ps-hair)]">
                {events.data.events.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-3 px-3 py-2 text-[12px]">
                    <span className="w-32 shrink-0 text-[var(--ps-muted)]">{when(e.created)}</span>
                    <span className="min-w-0 flex-1">
                      {e.detail}
                      {e.approved_by !== null && <span className="text-[var(--ps-muted)]"> &middot; approved by {e.approved_by.name}</span>}
                    </span>
                    <span className="shrink-0 text-[var(--ps-ink-2)]">{e.actor === 'agent' ? 'Your AI agent' : (e.staff?.name ?? '')}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Totals">
            <Stat label="Subtotal" value={money.fmt(order.subtotal)} />
            {order.discount_total !== 0 && <Stat label={order.applied_discount !== null ? order.applied_discount.name : 'Discounts'} value={money.fmt(-order.discount_total)} />}
            {order.taxes.map((t) => (
              <Stat key={t.id + t.rate} label={t.name + ' ' + t.rate + '%'} value={money.fmt(t.tax)} />
            ))}
            {order.tax_exempt && <Stat label="Tax" value="Removed" />}
            {order.tip !== 0 && <Stat label="Tip" value={money.fmt(order.tip)} />}
            {order.rounding !== 0 && <Stat label="Cash rounding" value={money.fmt(order.rounding)} />}
            <div className="mt-1 border-t border-[var(--ps-hair)] pt-1">
              <Stat label="Total" value={<span className="text-[14px] font-bold">{money.fmt(order.due)}</span>} />
              {order.status === 'open' && order.balance !== 0 && <Stat label="Left to pay" value={money.fmt(order.balance)} />}
            </div>
            {order.points_earned !== 0 && <p className="mt-2 text-[12px] text-[var(--ps-muted)]">{order.points_earned > 0 ? 'Earned ' + order.points_earned + ' points' : 'Returned ' + -order.points_earned + ' points'}</p>}
          </Panel>

          <Panel title="Payments" padded={false}>
            {order.payments.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-[var(--ps-muted)]">No payments</p>
            ) : (
              <ul className="divide-y divide-[var(--ps-hair)]">
                {order.payments.map((p) => (
                  <li key={p.id} className={cn('flex items-start gap-2 px-3 py-2', p.status === 'voided' && 'text-[var(--ps-muted)]')}>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[13px] font-semibold', p.status === 'voided' && 'line-through')}>{tenderName(p.tender, p.label)}</span>
                      <span className="block text-[12px] text-[var(--ps-muted)]">
                        {[when(p.created), p.staff, p.reference, p.tender === 'cash' && p.change > 0 ? 'given ' + money.fmt(p.tendered) + ', change ' + money.fmt(p.change) : '', p.approved_by !== '' ? 'approved by ' + p.approved_by : ''].filter((x) => x !== '').join(' · ')}
                      </span>
                    </span>
                    {p.status === 'voided' ? <Badge tone="neutral">Voided</Badge> : <span className={cn('num text-[13px] font-semibold', p.amount < 0 && 'text-[var(--ps-red-text)]')}>{money.fmt(p.amount)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {order.customer !== null && (
            <Panel title="Customer">
              <a href={href('customer', { id: order.customer.id })} className="text-[13px] font-semibold hover:underline">
                {order.customer.name}
              </a>
              <p className="text-[12px] text-[var(--ps-muted)]">{[order.customer.phone, order.customer.email].filter((x) => x !== '').join(' · ')}</p>
            </Panel>
          )}
          {order.note !== '' && (
            <Panel title="Note">
              <p className="whitespace-pre-wrap text-[13px]">{order.note}</p>
            </Panel>
          )}
          {order.status === 'void' && order.void_reason !== '' && (
            <Panel title="Why it was cleared">
              <p className="text-[13px]">{order.void_reason}</p>
            </Panel>
          )}
        </div>
      </div>
      {sending && <SendReceipt order={order.id} initial={order.customer?.email || order.customer?.phone || ''} onClose={() => setSending(false)} />}
    </div>
  );
}
