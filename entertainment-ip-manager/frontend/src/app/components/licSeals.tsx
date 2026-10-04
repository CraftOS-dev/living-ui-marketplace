/**
 * Authenticity seals (証紙): orders with quantity and cost, issue with a
 * serial range, the licensee's report of used, void and returned seals,
 * and the control that compares seals used with the manufactured quantity
 * on royalty statements (a positive variance is flagged).
 */
import { useState } from 'react';
import { Plus, Stamp } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { errText, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtMoney, fmtNumber, today } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { PartyRec, ProductRec, SealOrderRec } from '../lib/records.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { RecordPicker } from './pickers.tsx';
import { EmptyHint, EnumPill, ErrorBox, Loading, Notice, Pill, Ref, Section, TONE_TEXT } from './ui.tsx';
import { canDelete } from './deleteRecord.tsx';
import { DateField, NumberField, RowDelete, expandOne, numOf, numStr } from './licShared.tsx';

export interface VarianceRow {
  product: string;
  name: string;
  issued: number;
  used: number;
  void: number;
  returned: number;
  unaccounted: number;
  manufactured_reported: number;
  variance: number;
  flag: boolean;
}

const PRODUCT_SEARCH = ['name', 'ref', 'sku', 'jan'];
const productLabel = (p: ProductRec): string => `${p.ref} ${p.name}`.trim();

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

export function OrderSealsDialog({ productId, onClose }: { productId?: string | undefined; onClose: () => void }): React.JSX.Element {
  const { homeCurrency } = useApp();
  const [product, setProduct] = useState(productId ?? '');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState(homeCurrency);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const quantity = Math.floor(numOf(qty));
  const submit = async (): Promise<void> => {
    if (product === '' || quantity <= 0) return;
    setBusy(true);
    try {
      await op<{ id: string; status: string }>('seals/order', { product_id: product, quantity, unit_cost: numOf(cost), currency, notes: notes.trim() });
      toast.success(t('Seal order recorded'));
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Order seals')}
      description={t('Record a request for authenticity seals. Issue them with a serial range once they are printed.')}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={product === '' || quantity <= 0}>
            {t('Record order')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {productId === undefined && (
          <RecordPicker<ProductRec> collection="products" label={t('Product')} value={product} onChange={(id) => setProduct(id)} labelOf={productLabel} searchFields={PRODUCT_SEARCH} placeholder={t('Search products')} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label={t('Quantity')} value={qty} onChange={setQty} min={1} step={1} />
          <NumberField label={t('Unit cost per seal')} value={cost} onChange={setCost} suffix={currency} min={0} />
        </div>
        <Select label={t('Currency')} value={currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={(e) => setCurrency(e.target.value)} />
        <Textarea label={t('Notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}

export function IssueSealsDialog({ order, onClose }: { order: SealOrderRec; onClose: () => void }): React.JSX.Element {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [issued, setIssued] = useState(today());
  const [cost, setCost] = useState(numStr(order.unit_cost));
  const [busy, setBusy] = useState(false);
  const partial = (from.trim() === '') !== (to.trim() === '');
  const submit = async (): Promise<void> => {
    if (partial) return;
    setBusy(true);
    try {
      const r = await op<{ id: string; serial_from: string; serial_to: string; status: string }>('seals/issue', {
        order_id: order.id,
        serial_from: from.trim(),
        serial_to: to.trim(),
        issued_date: issued,
        unit_cost: cost.trim() === '' ? '' : numOf(cost),
      });
      toast.success(t('Seals issued: {from} to {to}', { from: r.serial_from, to: r.serial_to }));
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Issue seals')}
      description={t('{n} seals. Leave the serial numbers empty and the next free range is assigned.', { n: fmtNumber(order.quantity) })}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={partial}>
            {t('Issue')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('First serial number')} value={from} className="font-mono" onChange={(e) => setFrom(e.target.value)} />
          <Input label={t('Last serial number')} value={to} className="font-mono" onChange={(e) => setTo(e.target.value)} />
        </div>
        {partial && <p className="text-xs text-red-600 dark:text-red-400">{t('Enter both serial numbers, or neither.')}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField label={t('Issued on')} value={issued} onChange={setIssued} />
          <NumberField label={t('Unit cost per seal')} value={cost} onChange={setCost} suffix={order.currency} min={0} />
        </div>
      </div>
    </Dialog>
  );
}

export function ReconcileSealsDialog({ order, onClose }: { order: SealOrderRec; onClose: () => void }): React.JSX.Element {
  const [used, setUsed] = useState(String(order.used || 0));
  const [voided, setVoided] = useState(String(order.void || 0));
  const [returned, setReturned] = useState(String(order.returned || 0));
  const [busy, setBusy] = useState(false);
  const total = numOf(used) + numOf(voided) + numOf(returned);
  const left = order.quantity - total;
  const submit = async (): Promise<void> => {
    if (left < 0) return;
    setBusy(true);
    try {
      const r = await op<{ id: string; status: string }>('seals/reconcile', { order_id: order.id, used: numOf(used), void: numOf(voided), returned: numOf(returned) });
      toast.success(r.status === 'reconciled' ? t('Seals reconciled: every seal is accounted for.') : t('Seal counts saved'));
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Reconcile seals')}
      description={t('What the licensee reports for serials {from} to {to} ({n} issued).', { from: order.serial_from, to: order.serial_to, n: fmtNumber(order.quantity) })}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={left < 0}>
            {t('Save counts')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label={t('Used')} value={used} onChange={setUsed} min={0} step={1} />
          <NumberField label={t('Void')} value={voided} onChange={setVoided} min={0} step={1} />
          <NumberField label={t('Returned')} value={returned} onChange={setReturned} min={0} step={1} />
        </div>
        {left < 0 ? (
          <Notice tone="bad">{t('Used, void and returned add up to more than the {n} issued.', { n: fmtNumber(order.quantity) })}</Notice>
        ) : left === 0 ? (
          <Notice tone="good">{t('Every seal is accounted for; the order closes as reconciled.')}</Notice>
        ) : (
          <p className="text-xs text-[var(--agent-app-muted)]">{t('{n} seals still unaccounted for.', { n: fmtNumber(left) })}</p>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

type SealDialog = { kind: 'issue' | 'reconcile'; order: SealOrderRec } | null;

/** Seal orders with their serials and counts, and the issue and reconcile actions. */
export function SealOrderTable({ orders, showProduct, tableId }: { orders: SealOrderRec[]; showProduct: boolean; tableId: string }): React.JSX.Element {
  const { can } = useApp();
  const [dialog, setDialog] = useState<SealDialog>(null);
  const productOf = (o: SealOrderRec): ProductRec | null => expandOne<ProductRec>(o, 'product');
  const licenseeOf = (o: SealOrderRec): string => expandOne<PartyRec>(o, 'licensee')?.name ?? '';
  const unaccounted = (o: SealOrderRec): number => (o.status === 'requested' || o.status === 'cancelled' ? 0 : o.quantity - o.used - o.void - o.returned);

  const columns: Col<SealOrderRec>[] = [
    ...(showProduct
      ? [
          {
            key: 'product',
            label: t('Product'),
            value: (o: SealOrderRec) => productOf(o)?.name ?? '',
            render: (o: SealOrderRec) => {
              const p = productOf(o);
              return p !== null ? (
                <a className="block max-w-[14rem] truncate font-medium hover:underline" href={href('product', p.id, { tab: 'seals' })}>
                  {p.name}
                </a>
              ) : (
                ''
              );
            },
          },
          { key: 'licensee', label: t('Licensee'), value: licenseeOf, render: (o: SealOrderRec) => <span className="block max-w-[12rem] truncate">{licenseeOf(o)}</span> },
        ]
      : []),
    { key: 'status', label: t('Status'), render: (o) => <EnumPill field="seal_orders.status" value={o.status} /> },
    { key: 'quantity', label: t('Quantity'), align: 'right', value: (o) => o.quantity, render: (o) => fmtNumber(o.quantity) },
    {
      key: 'serials',
      label: t('Serial numbers'),
      value: (o) => o.serial_from,
      render: (o) => (o.serial_from !== '' ? <Ref className="whitespace-nowrap">{`${o.serial_from} - ${o.serial_to}`}</Ref> : <span className="text-xs text-[var(--agent-app-muted)]">{t('Not issued')}</span>),
    },
    { key: 'used', label: t('Used'), align: 'right', value: (o) => o.used, render: (o) => fmtNumber(o.used) },
    { key: 'void', label: t('Void'), align: 'right', value: (o) => o.void, render: (o) => fmtNumber(o.void) },
    { key: 'returned', label: t('Returned'), align: 'right', value: (o) => o.returned, render: (o) => fmtNumber(o.returned) },
    {
      key: 'unaccounted',
      label: t('Unaccounted'),
      align: 'right',
      value: unaccounted,
      render: (o) => <span className={cn(unaccounted(o) > 0 && TONE_TEXT.warn)}>{fmtNumber(unaccounted(o))}</span>,
    },
    { key: 'ordered_date', label: t('Ordered'), value: (o) => d10(o.ordered_date), render: (o) => <span className="whitespace-nowrap">{fmtDate(o.ordered_date)}</span>, optional: true },
    { key: 'issued_date', label: t('Issued on'), value: (o) => d10(o.issued_date), render: (o) => <span className="whitespace-nowrap">{fmtDate(o.issued_date)}</span> },
    {
      key: 'cost',
      label: t('Seal cost'),
      align: 'right',
      value: (o) => o.quantity * o.unit_cost,
      render: (o) => (o.unit_cost > 0 ? <span className="whitespace-nowrap">{fmtMoney(o.quantity * o.unit_cost, o.currency)}</span> : ''),
      optional: true,
    },
    ...(can.licensing || canDelete(can, 'seal_orders')
      ? [
          {
            key: 'actions',
            label: t('Actions'),
            sortable: false,
            value: () => '',
            render: (o: SealOrderRec) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {can.licensing && o.status === 'requested' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDialog({ kind: 'issue', order: o })}>
                    {t('Issue')}
                  </Button>
                )}
                {can.licensing && (o.status === 'issued' || o.status === 'reconciled') && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDialog({ kind: 'reconcile', order: o })}>
                    {t('Reconcile')}
                  </Button>
                )}
                <RowDelete collection="seal_orders" id={o.id} label={t('Delete this seal order')} />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <DataTable<SealOrderRec>
        tableId={tableId}
        exportName="seal-orders"
        rows={orders}
        columns={columns}
        dense
        empty={<EmptyHint compact icon={Stamp} title={t('No seal orders yet')} message={t('Seal orders appear here when a licensee asks for seals or you record an order.')} />}
      />
      {dialog?.kind === 'issue' && <IssueSealsDialog order={dialog.order} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'reconcile' && <ReconcileSealsDialog order={dialog.order} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Seals used against the manufactured quantity reported on statements. */
export function VarianceTable({ rows, showProduct = true }: { rows: VarianceRow[]; showProduct?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-[11px] uppercase tracking-wider text-[var(--agent-app-muted)]">
            {showProduct && <th className="px-3 py-2 text-left font-semibold">{t('Product')}</th>}
            <th className="px-3 py-2 text-right font-semibold">{t('Issued')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('Used')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('Void')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('Returned')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('Unaccounted')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('Manufactured (reported)')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('Variance')}</th>
            <th className="px-3 py-2 text-left font-semibold">{t('Check')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product} className={cn('border-b border-[var(--agent-app-border)]/60 last:border-0', r.flag && 'bg-red-500/5')}>
              {showProduct && (
                <td className="px-3 py-2">
                  <a className="block max-w-[16rem] truncate hover:underline" href={href('product', r.product, { tab: 'seals' })}>
                    {r.name}
                  </a>
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.issued)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.used)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.void)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.returned)}</td>
              <td className={cn('px-3 py-2 text-right tabular-nums', r.unaccounted > 0 && TONE_TEXT.warn)}>{fmtNumber(r.unaccounted)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.manufactured_reported)}</td>
              <td className={cn('px-3 py-2 text-right font-medium tabular-nums', r.variance > 0 ? TONE_TEXT.bad : r.variance < 0 ? TONE_TEXT.warn : '')}>
                {r.variance > 0 ? `+${fmtNumber(r.variance)}` : fmtNumber(r.variance)}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {r.flag ? (
                  <Pill tone="bad" title={t('More seals were used than the statements say were manufactured.')}>
                    {t('More used than reported')}
                  </Pill>
                ) : r.issued === 0 ? (
                  <span className="text-xs text-[var(--agent-app-muted)]">{t('No seals issued')}</span>
                ) : (
                  <Pill tone="good">{t('Matches')}</Pill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Product page panel                                                  */
/* ------------------------------------------------------------------ */

export function ProductSealsPanel({ productId }: { productId: string }): React.JSX.Element {
  const { can } = useApp();
  const orders = useCollection<SealOrderRec>('seal_orders', { filter: `product = ${q(productId)}`, sort: '-created' });
  const variance = useLiveAsync(() => op<{ rows: VarianceRow[] }>('seals/variance', { product_id: productId }), [productId], ['seal_orders', 'royalty_lines']);
  const [ordering, setOrdering] = useState(false);
  const rows = variance.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t('Seal orders')}
        meta={orders.records.length > 0 ? String(orders.records.length) : undefined}
        flush
        actions={
          can.licensing ? (
            <Button size="sm" variant="outline" onClick={() => setOrdering(true)}>
              <Plus size={13} aria-hidden /> {t('Order seals')}
            </Button>
          ) : undefined
        }
      >
        {orders.loading ? <Loading /> : orders.error !== null && orders.records.length === 0 ? <div className="p-4"><ErrorBox message={orders.error} onRetry={orders.refresh} /></div> : <SealOrderTable orders={orders.records} showProduct={false} tableId="product-seal-orders" />}
      </Section>
      <Section title={t('Seals used against manufactured quantity')}>
        <p className="mb-3 text-xs leading-relaxed text-[var(--agent-app-muted)]">
          {t('Seals the licensee reports as used, compared with the manufactured quantity on royalty statements. More seals used than manufactured means unreported production.')}
        </p>
        {variance.loading ? <Loading /> : variance.error !== null ? <ErrorBox message={variance.error} onRetry={variance.reload} /> : rows.length === 0 ? <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Nothing to compare yet.')}</p> : <VarianceTable rows={rows} showProduct={false} />}
      </Section>
      {ordering && <OrderSealsDialog productId={productId} onClose={() => setOrdering(false)} />}
    </div>
  );
}
