/**
 * Reports: net sales, number of sales, average sale and gross profit for
 * any days (with the change against the same number of days before),
 * sales over the day or over the days, payment methods, and a breakdown by
 * product, category, staff, customer, payment, discount, tax, weekday or
 * register. Everything exports to CSV. Your AI agent can be asked a
 * question about the numbers.
 */
import { useMemo, useState } from 'react';
import { Download, MessageSquareText, Send } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { duration, percent, qty as qtyText } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { download } from '../lib/print.ts';
import { navigate } from '../lib/router.ts';
import type { BreakdownBy, BreakdownRow } from '../lib/types.ts';
import { Bars, Columns } from '../components/charts.tsx';
import { DateRange, Delta, Kpi, presetRange } from '../components/common.tsx';
import type { Range } from '../components/common.tsx';
import { Button, Modal, PageHeader, Panel, Select, Stat, Tabs, textareaCls } from '../components/ui.tsx';

const BREAKDOWNS: { value: BreakdownBy; label: string; one: string }[] = [
  { value: 'product', label: 'Products', one: 'Product' },
  { value: 'category', label: 'Categories', one: 'Category' },
  { value: 'staff', label: 'Staff', one: 'Staff member' },
  { value: 'customer', label: 'Customers', one: 'Customer' },
  { value: 'tender', label: 'Payments', one: 'Payment' },
  { value: 'discount', label: 'Discounts', one: 'Discount' },
  { value: 'tax', label: 'Taxes', one: 'Tax rate' },
  { value: 'weekday', label: 'Weekdays', one: 'Weekday' },
  { value: 'hour', label: 'Hours of the day', one: 'Hour' },
  { value: 'day', label: 'Days', one: 'Day' },
  { value: 'register', label: 'Registers', one: 'Register' },
];

type Col = { key: keyof BreakdownRow; label: string; money?: boolean };

const COLUMNS: Record<string, Col[]> = {
  product: [
    { key: 'qty', label: 'Sold' },
    { key: 'net_sales', label: 'Net sales', money: true },
    { key: 'discounts', label: 'Discounts', money: true },
    { key: 'cost', label: 'Cost', money: true },
    { key: 'profit', label: 'Profit', money: true },
  ],
  people: [
    { key: 'orders', label: 'Sales' },
    { key: 'total', label: 'Total', money: true },
    { key: 'average', label: 'Average', money: true },
    { key: 'discounts', label: 'Discounts', money: true },
    { key: 'returns', label: 'Returns' },
    { key: 'tips', label: 'Tips', money: true },
  ],
  time: [
    { key: 'orders', label: 'Sales' },
    { key: 'total', label: 'Total', money: true },
    { key: 'average', label: 'Average', money: true },
    { key: 'tips', label: 'Tips', money: true },
  ],
  tender: [
    { key: 'count', label: 'Payments' },
    { key: 'amount', label: 'Amount', money: true },
  ],
  discount: [
    { key: 'uses', label: 'Used' },
    { key: 'amount', label: 'Given', money: true },
  ],
  tax: [
    { key: 'base', label: 'Taxed sales', money: true },
    { key: 'tax', label: 'Tax', money: true },
  ],
};

function columnsFor(by: BreakdownBy): Col[] {
  if (by === 'product' || by === 'category') return COLUMNS['product'] ?? [];
  if (by === 'staff' || by === 'customer' || by === 'register') return COLUMNS['people'] ?? [];
  if (by === 'weekday' || by === 'day' || by === 'hour') return COLUMNS['time'] ?? [];
  return COLUMNS[by] ?? [];
}

function AskDialog({ open, onClose, range }: { open: boolean; onClose: () => void; range: Range }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.ask('question', { body: text.trim() + (range.from !== '' ? '\n\n(Looking at ' + range.from + (range.to !== range.from ? ' to ' + range.to : '') + ' in Reports.)' : '') });
      toast.success(r.asked ? 'Asked your AI agent; the answer arrives in Requests' : r.message);
      setText('');
      onClose();
      navigate('requests');
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ask your AI agent"
      description="About sales, products, staff or customers; it answers from the store's own numbers."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Send} loading={busy} disabled={text.trim().length < 4} onClick={() => void send()}>
            Ask
          </Button>
        </>
      }
    >
      <textarea autoFocus className={textareaCls} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Which products sell best on weekends, and which barely sell at all?" />
    </Modal>
  );
}

export function ReportsPage(): React.JSX.Element {
  const { money } = useStore();
  const [range, setRange] = useState<Range>(presetRange('7d'));
  const [register, setRegister] = useState('');
  const [staff, setStaff] = useState('');
  const [by, setBy] = useState<BreakdownBy>('product');
  const [asking, setAsking] = useState(false);
  const [exporting, setExporting] = useState('');
  const regs = useLive(() => api.registers(), ['registers'], []);
  const team = useLive(() => api.staff(), ['staff'], []);
  const scope = { from: range.from, to: range.to, register: register || undefined, staff: staff || undefined };
  const deps = [range.from, range.to, register, staff];
  const watch = ['orders', 'payments'] as const;
  const sum = useLive(() => api.summary(scope), [...watch], deps, 500);
  const oneDay = range.from === range.to;
  const timeline = useLive(() => api.breakdown(oneDay ? 'hour' : 'day', { ...scope, limit: 400 }), [...watch], [...deps, oneDay], 500);
  const tenders = useLive(() => api.breakdown('tender', { ...scope, limit: 20 }), [...watch], deps, 500);
  const table = useLive(() => api.breakdown(by, { ...scope, limit: by === 'day' ? 400 : 100 }), [...watch], [...deps, by], 500);
  // Hours worked from the time clock, for sales per hour by staff member.
  const clock = useLive(() => (by === 'staff' ? api.timeclock({ from: range.from, to: range.to }) : Promise.resolve(null)), ['timeclock'], [by, range.from, range.to]);
  const minutesBy = new Map((clock.data?.totals ?? []).map((t) => [t.staff.id, t.minutes]));

  const s = sum.data?.summary ?? null;
  const prev = sum.data?.previous ?? null;

  const columns = useMemo(() => {
    const rows = timeline.data?.rows ?? [];
    if (oneDay) {
      const byHour = new Map(rows.map((r) => [Number(r.key), r]));
      const hours = rows.length === 0 ? [] : Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= Math.min(...rows.map((r) => Number(r.key))) - 1 && h <= Math.max(...rows.map((r) => Number(r.key))) + 1);
      return hours.map((h) => {
        const r = byHour.get(h);
        return { key: String(h), label: String(h).padStart(2, '0'), value: r?.total ?? 0, note: r !== undefined ? (r.orders ?? 0) + ' sales' : undefined };
      });
    }
    // Every day of the range, with the days without sales as empty columns.
    const out: { key: string; label: string; value: number; note?: string | undefined }[] = [];
    const byDay = new Map(rows.map((r) => [r.key, r]));
    const [y, m, d] = range.from.split('-').map(Number);
    const cur = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
    for (let i = 0; i < 400; i++) {
      const key = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
      if (key > range.to) break;
      const r = byDay.get(key);
      out.push({ key, label: cur.getDate() === 1 || i === 0 ? cur.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : String(cur.getDate()), value: r?.total ?? 0, note: r !== undefined ? (r.orders ?? 0) + ' sales' : undefined });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [timeline.data, oneDay, range.from, range.to]);

  const exportCsv = async (kind: string): Promise<void> => {
    setExporting(kind);
    try {
      download(await api.exportSales(kind, scope));
    } catch {
      // Shown by the transport.
    } finally {
      setExporting('');
    }
  };

  const cols = columnsFor(by);
  const rows = table.data?.rows ?? [];

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={sum.data !== null ? sum.data.days + (sum.data.days === 1 ? ' day' : ' days') + (prev !== null ? ', compared with ' + prev.from + (prev.to !== prev.from ? ' to ' + prev.to : '') : '') : undefined}
        actions={
          <>
            <Button icon={MessageSquareText} onClick={() => setAsking(true)}>
              Ask your AI agent
            </Button>
            <Button icon={Download} loading={exporting === 'lines'} onClick={() => void exportCsv('lines')}>
              Items sold
            </Button>
            <Button icon={Download} loading={exporting === 'orders'} onClick={() => void exportCsv('orders')}>
              Sales
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRange value={range} onChange={setRange} />
        {(regs.data?.registers.length ?? 0) > 1 && <Select ariaLabel="Register" value={register} onChange={setRegister} className="w-40" options={[{ value: '', label: 'All registers' }, ...(regs.data?.registers ?? []).map((r) => ({ value: r.id, label: r.name }))]} />}
        <Select ariaLabel="Staff" value={staff} onChange={setStaff} className="w-40" options={[{ value: '', label: 'Everyone' }, ...(team.data?.staff ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Net sales" value={s !== null ? money.fmt(s.net_sales) : ''} note={s !== null && prev !== null ? <span>{prev.net_sales !== 0 ? <Delta now={s.net_sales} before={prev.net_sales} /> : null} before {money.fmt(prev.net_sales)}</span> : undefined} />
        <Kpi label="Sales" value={s?.sales ?? ''} note={s !== null && prev !== null ? <span>{prev.sales !== 0 ? <Delta now={s.sales} before={prev.sales} /> : null} before {prev.sales}</span> : undefined} />
        <Kpi label="Average sale" value={s !== null ? money.fmt(s.average_sale) : ''} note={s !== null && prev !== null ? <span>{prev.average_sale !== 0 ? <Delta now={s.average_sale} before={prev.average_sale} /> : null} before {money.fmt(prev.average_sale)}</span> : undefined} />
        <Kpi label="Gross profit" value={s !== null ? money.fmt(s.profit) : ''} note={s !== null ? percent(s.margin) + ' margin' : undefined} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title={oneDay ? 'Sales by hour' : 'Sales by day'} subtitle="Totals with tax">
          <Columns data={columns} format={money.fmt} every={oneDay ? 2 : Math.max(1, Math.ceil(columns.length / 12))} />
        </Panel>
        <Panel title="Payments">
          <Bars rows={(tenders.data?.rows ?? []).map((r) => ({ key: r.key, label: r.label, value: r.amount ?? 0, note: (r.count ?? 0) + 'x' }))} format={money.fmt} />
        </Panel>
      </div>

      {s !== null && (
        <Panel title="Summary" className="mb-4">
          <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Stat label="Gross sales" value={money.fmt(s.gross_sales)} />
              <Stat label="Discounts" value={money.fmt(-s.discounts)} />
              <Stat label="Returns" value={money.fmt(-s.returns)} />
              <Stat label="Net sales" value={money.fmt(s.net_sales)} />
            </div>
            <div>
              <Stat label="Tax" value={money.fmt(s.tax)} />
              <Stat label="Tips" value={money.fmt(s.tips)} />
              <Stat label="Gift cards sold" value={money.fmt(s.gift_cards)} />
              <Stat label="Cash rounding" value={money.fmt(s.rounding)} />
            </div>
            <div>
              <Stat label="Collected" value={money.fmt(s.collected)} />
              <Stat label="Cost of goods" value={money.fmt(s.cost)} />
              <Stat label="Items sold" value={qtyText(s.items_sold)} />
              <Stat label="Items returned" value={qtyText(s.items_returned)} />
            </div>
          </div>
        </Panel>
      )}

      <Panel
        title="Breakdown"
        padded={false}
        actions={
          <Button size="sm" icon={Download} loading={exporting === by} onClick={() => void exportCsv(by)}>
            CSV
          </Button>
        }
      >
        <Tabs label="Breakdown" value={by} onChange={setBy} options={BREAKDOWNS.map((b) => ({ value: b.value, label: b.label }))} className="overflow-x-auto" />
        {rows.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-[var(--ps-muted)]">Nothing in these days</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ps-table">
              <thead>
                <tr>
                  <th>{BREAKDOWNS.find((b) => b.value === by)?.one ?? ''}</th>
                  {cols.map((c) => (
                    <th key={c.key} className="text-right">
                      {c.label}
                    </th>
                  ))}
                  {by === 'staff' && <th className="text-right">Hours worked</th>}
                  {by === 'staff' && <th className="text-right">Sales per hour</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="max-w-[280px] truncate font-semibold">{r.label}</td>
                    {cols.map((c) => {
                      const v = r[c.key];
                      const n = typeof v === 'number' ? v : 0;
                      return (
                        <td key={c.key} className={cn('num text-right', c.key === 'profit' && n < 0 && 'text-[var(--ps-red-text)]')}>
                          {c.money === true ? money.fmt(Math.round(n)) : qtyText(n)}
                        </td>
                      );
                    })}
                    {by === 'staff' && <td className="num text-right">{(minutesBy.get(r.key) ?? 0) > 0 ? duration(minutesBy.get(r.key) ?? 0) : ''}</td>}
                    {by === 'staff' && <td className="num text-right">{(minutesBy.get(r.key) ?? 0) > 0 ? money.fmt(Math.round(((r.total ?? 0) * 60) / (minutesBy.get(r.key) ?? 1))) : ''}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <AskDialog open={asking} onClose={() => setAsking(false)} range={range} />
    </div>
  );
}
