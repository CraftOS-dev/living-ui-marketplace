/**
 * Reports over trading days, laid out as a dashboard: where the money came
 * from (the ring, by category), when it came (by hour of the day or by day),
 * the best sellers and the other breakdowns on the left; on the right the
 * dark card with what was collected and the key figures, each against the
 * period before, then how it was paid, and gross profit (where products have
 * a cost), discounts and returns. Exports for a spreadsheet or the
 * accountant. The Activity tab is the audit trail: who did what, and who
 * approved it.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Ban,
  Banknote,
  Boxes,
  ChartColumn,
  CreditCard,
  Download,
  FileUp,
  History,
  KeyRound,
  Lock,
  LockOpen,
  Package,
  Percent,
  Printer,
  QrCode,
  ReceiptText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Undo2,
  UserCog,
  UserRound,
  Users,
  Utensils,
  Wallet,
} from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { download } from '../lib/csv.ts';
import { ORDER_TYPE_LABEL, addDays, dateTime, dayLabel, money, percent, plural } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import type { AuditEvent, ReportSummary, TenderKind } from '../lib/types.ts';
import { Change, ColumnChart, Ring, StatTile, ringColor } from '../components/Charts.tsx';
import type { RingSlice } from '../components/Charts.tsx';
import { Badge, Button, Card, CardHeader, Chip, Empty, IconBadge, LevelBar, PageHeader, Popover, SearchField, Select, Spinner, Tabs, menuItem, pillInput, rowCls } from '../components/ui.tsx';

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'this_month' | 'custom';

const RANGES: [Range, string][] = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', '7 days'],
  ['month', '30 days'],
  ['this_month', 'This month'],
  ['custom', 'Days...'],
];

function rangeOf(r: Range, today: string, from: string, to: string): { from: string; to: string } {
  if (r === 'today') return { from: today, to: today };
  if (r === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) };
  if (r === 'week') return { from: addDays(today, -6), to: today };
  if (r === 'month') return { from: addDays(today, -29), to: today };
  if (r === 'this_month') return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: from || today, to: to || today };
}

const TENDER_ICON: Record<TenderKind, LucideIcon> = { cash: Banknote, card: CreditCard, qr: QrCode, other: Wallet };

/* ------------------------------------------------------------ breakdowns */

interface Line {
  key: string;
  lead?: ReactNode;
  name: string;
  note: string;
  value: string;
}

const FIRST = 10;

/** One breakdown: a white card of soft rows (what, how many, how much). */
function Breakdown({ title, lines, empty, columns = false, className }: { title: string; lines: Line[]; empty: string; columns?: boolean; className?: string }): React.JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, FIRST);
  return (
    <Card className={className ?? ''}>
      <CardHeader title={title} />
      {lines.length === 0 ? (
        <p className="text-[13px] text-[var(--ps-muted)]">{empty}</p>
      ) : (
        <ul className={cn('grid grid-cols-1 gap-2', columns && 'sm:grid-cols-2')}>
          {shown.map((l) => (
            <li key={l.key} className={cn(rowCls, 'flex min-w-0 items-center gap-3 px-3 py-2.5')}>
              {l.lead}
              <span className={cn('min-w-0 flex-1', l.lead === undefined && 'pl-1')}>
                <span className="block truncate text-[14px] font-semibold">{l.name}</span>
                <span className="num block truncate text-[12px] text-[var(--ps-muted)]">{l.note}</span>
              </span>
              <span className="num shrink-0 pr-1 text-[14px] font-bold">{l.value}</span>
            </li>
          ))}
        </ul>
      )}
      {lines.length > FIRST && (
        <div className="mt-3 flex justify-center">
          <Button size="sm" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${lines.length}`}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** A small mark at the start of a breakdown row. */
function Rank({ n }: { n: number }): React.JSX.Element {
  return (
    <span aria-hidden className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ps-card)] text-[12px] font-bold">
      {n}
    </span>
  );
}

/* --------------------------------------------------------------- summary */

/** One key figure in the dark card. */
function Figure({ label, value, children }: { label: string; value: string; children?: ReactNode }): React.JSX.Element {
  return (
    <li className="rounded-[18px] bg-[var(--ps-dark-2)] px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] font-semibold leading-5 text-[var(--ps-muted)]">{label}</span>
        <span className="num shrink-0 text-[15px] font-bold">{value}</span>
      </div>
      {children}
    </li>
  );
}

function Summary({ r, today }: { r: ReportSummary; today: string }): React.JSX.Element {
  const [hot, setHot] = useState<string | null>(null);
  const unit = 10 ** r.currency_decimals;
  const m = (n: number): string => money(n, r.currency, r.currency_decimals);
  // The number in the ring: no cents once it reaches four digits.
  const headline = (n: number): string => (Math.abs(n) >= 1000 * unit ? money(Math.round(n / unit), r.currency, 0) : m(n));
  const compact = (n: number): string => {
    const v = n / unit;
    return Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}K` : v.toLocaleString('en-US', { maximumFractionDigits: r.currency_decimals });
  };
  const orders = (n: number): string => (n === 1 ? '1 order' : `${n} orders`);
  const k = r.kpis;
  const p = r.previous;
  const oneDay = r.from === r.to;
  const period = oneDay ? dayLabel(r.from) : `${dayLabel(r.from)} to ${dayLabel(r.to)}`;

  // Columns: the hours that traded (at least 08 to 18), or each day.
  const hours = r.by_hour.filter((h) => h.orders > 0 || h.collected !== 0);
  const first = hours.length > 0 ? Math.min(...hours.map((h) => h.hour)) : 8;
  const last = hours.length > 0 ? Math.max(...hours.map((h) => h.hour)) : 20;
  const thisHour = r.from === today ? new Date().getHours() : -1;
  const hourCols = r.by_hour
    .filter((h) => h.hour >= Math.min(first, 8) && h.hour <= Math.max(last, 18))
    .map((h) => ({
      key: String(h.hour),
      label: `${String(h.hour).padStart(2, '0')}:00 to ${String(h.hour + 1).padStart(2, '0')}:00`,
      tick: h.hour % 2 === 0 ? String(h.hour).padStart(2, '0') : '',
      value: h.collected,
      detail: `${m(h.collected)} · ${orders(h.orders)}`,
      now: h.hour === thisHour,
    }));
  const step = r.by_day.length > 16 ? Math.ceil(r.by_day.length / 8) : 1;
  const dayCols = r.by_day.map((d, i) => ({
    key: d.day,
    label: d.day.length === 7 ? d.day : dayLabel(d.day),
    tick: i % step === 0 ? (d.day.length === 7 ? d.day.slice(2) : d.day.slice(8)) : '',
    value: d.collected,
    detail: `${m(d.collected)} · ${orders(d.orders)}`,
    now: d.day === today,
  }));
  const cols = oneDay ? hourCols : dayCols;
  const hasNow = cols.some((c) => c.now && c.value > 0);

  // The ring: net sales by category, the five biggest and then the rest.
  const cats = r.categories.filter((c) => c.net > 0).sort((a, b) => b.net - a.net);
  const catTotal = cats.reduce((s, c) => s + c.net, 0);
  const share = (n: number): number => (catTotal > 0 ? Math.round((n / catTotal) * 1000) / 10 : 0);
  const slices: RingSlice[] = cats.slice(0, 5).map((c, i) => ({ key: c.name, label: c.name, value: c.net, amount: m(c.net), share: share(c.net), ...ringColor(i) }));
  const rest = cats.slice(5).reduce((s, c) => s + c.net, 0);
  if (rest > 0) slices.push({ key: ' other', label: 'Other', value: rest, amount: m(rest), share: share(rest), ...ringColor(0, true) });

  const margin = k.costed_sales > 0 ? Math.round((k.gross_profit / k.costed_sales) * 100) : null;
  const paid = r.tenders.reduce((s, t) => s + Math.max(0, t.amount), 0);

  const extra: { title: string; lines: Line[]; empty: string }[] = [
    { title: 'Categories', empty: 'Nothing sold', lines: r.categories.map((x) => ({ key: x.name, name: x.name, note: `${x.qty} sold`, value: m(x.net) })) },
    { title: 'Staff', empty: 'No sales', lines: r.staff.map((x) => ({ key: x.name, lead: <IconBadge icon={UserRound} size={32} tone="card" />, name: x.name, note: orders(x.orders), value: m(x.collected) })) },
    ...(r.order_types.some((x) => x.type !== '')
      ? [
          {
            title: 'Order types',
            empty: '',
            lines: r.order_types.map((x) => ({ key: x.type, lead: <IconBadge icon={Utensils} size={32} tone="card" />, name: x.type !== '' ? (ORDER_TYPE_LABEL[x.type] ?? x.type) : 'Not set', note: orders(x.orders), value: m(x.collected) })),
          },
        ]
      : []),
    { title: 'Discounts given', empty: 'No discounts', lines: r.discounts.map((x) => ({ key: x.name, lead: <IconBadge icon={Percent} size={32} tone="card" />, name: x.name, note: plural(x.sales, 'sale'), value: m(x.amount) })) },
    {
      title: 'Tax',
      empty: 'No tax',
      lines: r.taxes.map((x) => ({ key: `${x.rate_bp} ${x.name}`, name: `${percent(x.rate_bp)} · ${x.name}`, note: `On sales of ${m(r.price_mode === 'inclusive' ? x.gross : x.base)}`, value: m(x.tax) })),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
      <div className="contents lg:col-span-8 lg:flex lg:flex-col lg:gap-5">
        {/* Where the money came from */}
        <Card tone="sand" className="order-2 lg:order-none" delay={1}>
          <CardHeader title="Where the money came from" subtitle="Net sales by category" />
          <div className="flex flex-col-reverse items-center gap-6 md:flex-row md:items-center md:justify-between">
            <div className="w-full md:max-w-[280px]">
              {slices.length === 0 ? (
                <p className="text-[13px] text-[var(--ps-ink-2)]">No sales in these days</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {slices.map((sl) => (
                    <li key={sl.key} className="flex items-center gap-3 py-0.5" onMouseEnter={() => setHot(sl.key)} onMouseLeave={() => setHot(null)}>
                      <span aria-hidden className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: sl.fill }} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{sl.label}</span>
                      <span className="num text-[13px] font-bold">{sl.amount}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Ring
              slices={slices}
              centerValue={headline(k.collected)}
              centerCaption="collected"
              label={slices.length === 0 ? 'Net sales by category: none' : `Net sales by category: ${slices.map((sl) => `${sl.label} ${sl.amount}`).join(', ')}`}
              size={300}
              active={hot}
              onActive={setHot}
            />
          </div>
        </Card>

        {/* When it came */}
        <Card className="order-3 lg:order-none" delay={2}>
          <CardHeader
            title={oneDay ? 'Collected by hour' : 'Collected by day'}
            subtitle={period}
            action={
              <div className="hidden items-center gap-3 text-[12px] font-semibold text-[var(--ps-ink-2)] sm:flex">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-full bg-[var(--ps-ink)]" /> Collected
                </span>
                {hasNow && (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="size-2.5 rounded-full bg-[var(--ps-accent)]" /> {oneDay ? 'This hour' : 'Today'}
                  </span>
                )}
              </div>
            }
          />
          {cols.every((c) => c.value === 0) ? <Empty icon={ChartColumn} title="No sales in these days" compact /> : <ColumnChart columns={cols} format={compact} unit={unit} label={oneDay ? 'Collected by hour' : 'Collected by day'} />}
        </Card>

        <Breakdown
          title="Top products"
          empty="Nothing sold"
          columns
          className="order-6 lg:order-none"
          lines={r.products.map((x, i) => ({ key: x.name, lead: <Rank n={i + 1} />, name: x.name, note: `${x.qty} sold`, value: m(x.net) }))}
        />

        <div className="order-7 grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start lg:order-none">
          {extra.map((t, i) => (
            <Breakdown key={t.title} title={t.title} empty={t.empty} lines={t.lines} className={i === extra.length - 1 && extra.length % 2 === 1 ? 'md:col-span-2' : ''} columns={i === extra.length - 1 && extra.length % 2 === 1} />
          ))}
        </div>
      </div>

      <div className="contents lg:col-span-4 lg:flex lg:flex-col lg:gap-5">
        {/* What was collected, and the key figures */}
        <Card tone="dark" className="order-1 lg:order-none" delay={2}>
          <CardHeader title="Collected" subtitle={period} action={<IconBadge icon={Wallet} size={36} tone="dark" />} />
          <p className="num truncate text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{m(k.collected)}</p>
          <Change now={k.collected} before={p.collected} surface="dark" className="mt-2" />
          <ul className="mt-5 flex flex-col gap-2">
            <Figure label={`Net sales (${r.price_mode === 'inclusive' ? 'tax taken out' : 'before tax'})`} value={m(k.net_sales)}>
              <Change now={k.net_sales} before={p.net_sales} surface="dark-row" className="mt-2" />
            </Figure>
            <Figure label="Orders" value={k.orders.toLocaleString('en-US')}>
              <Change now={k.orders} before={p.orders} surface="dark-row" className="mt-2" />
            </Figure>
            <Figure label="Average sale" value={m(k.average)}>
              <Change now={k.average} before={p.average} surface="dark-row" className="mt-2" />
            </Figure>
            <Figure label="Tax" value={m(k.tax)}>
              <p className="mt-1 text-[12px] text-[var(--ps-muted)]">{k.service_charge !== 0 ? `Service charge ${m(k.service_charge)}` : `${plural(k.items, 'item')} sold`}</p>
            </Figure>
          </ul>
        </Card>

        {/* How it was paid */}
        <Card className="order-4 lg:order-none" delay={3}>
          <CardHeader title="Payments" />
          {r.tenders.length === 0 ? (
            <p className="text-[13px] text-[var(--ps-muted)]">No payments</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {r.tenders.map((t) => {
                const ratio = paid > 0 ? Math.max(0, t.amount) / paid : 0;
                return (
                  <li key={t.name} className={cn(rowCls, 'px-3 py-3')}>
                    <div className="flex items-center gap-3">
                      <IconBadge icon={TENDER_ICON[t.kind]} size={36} tone="card" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">{t.name}</span>
                        <span className="num block text-[12px] leading-4 text-[var(--ps-muted)]">
                          {plural(t.count, 'payment')} · {Math.round(ratio * 100)}%
                        </span>
                      </span>
                      <span className="num shrink-0 pr-1 text-[14px] font-bold">{m(t.amount)}</span>
                    </div>
                    <LevelBar ratio={ratio} className="mt-3" />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="order-5 grid grid-cols-1 gap-5 sm:grid-cols-3 lg:order-none lg:grid-cols-1">
          <StatTile
            icon={TrendingUp}
            label="Gross profit"
            value={k.costed_sales > 0 ? m(k.gross_profit) : 'No costs set'}
            now={k.gross_profit}
            before={k.costed_sales > 0 ? p.gross_profit : null}
            hint={margin !== null ? `${margin}% margin on products with a cost` : 'Add costs to products to see it'}
          />
          <StatTile icon={Percent} label="Discounts" value={m(k.discounts)} now={k.discounts} before={p.discounts} upIsGood={false} />
          <StatTile icon={Undo2} label="Returns" value={m(k.returns)} now={k.returns} before={p.returns} upIsGood={false} hint={k.refunds > 0 ? plural(k.refunds, 'refund') : undefined} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- activity */

type Group = 'all' | 'money' | 'exceptions' | 'changes' | 'agent';

const GROUPS: Group[] = ['all', 'money', 'exceptions', 'changes', 'agent'];
const GROUP_LABEL: Record<Group, string> = { all: 'Everything', money: 'Sales and cash', exceptions: 'Approvals and voids', changes: 'Changes', agent: 'Your AI agent' };

const KIND_ICON: Record<string, LucideIcon> = {
  sale: ReceiptText,
  refund: Undo2,
  exchange: ArrowLeftRight,
  cash_move: Banknote,
  shift_open: LockOpen,
  shift_close: Lock,
  override: ShieldAlert,
  approval: ShieldCheck,
  ticket_void: Ban,
  login_failed: ShieldAlert,
  pin_locked: KeyRound,
  reprint: Printer,
  staff_change: UserCog,
  settings_change: Settings,
  catalog_change: Package,
  stock_change: Boxes,
  customer_change: Users,
  import: FileUp,
};

/** Kinds a manager looks for first: they wear the warning color. */
const FLAGGED = ['override', 'ticket_void', 'login_failed', 'pin_locked'];

function Event({ ev }: { ev: AuditEvent }): React.JSX.Element {
  const flagged = FLAGGED.includes(ev.kind);
  // The agent's badge sits at the end of the row, or under the words on a phone.
  const agent = (className: string): React.JSX.Element | null =>
    ev.actor === 'agent' ? (
      <Badge tone="agent" className={className}>
        <Sparkles size={12} aria-hidden /> Your AI agent
      </Badge>
    ) : null;
  return (
    <li className={cn(rowCls, 'flex min-w-0 items-center gap-3 px-3 py-2.5')}>
      <IconBadge icon={KIND_ICON[ev.kind] ?? History} size={36} tone={flagged ? 'none' : 'card'} className={cn('self-start sm:self-center', flagged && 'bg-[var(--ps-amber)]/22 text-[var(--ps-amber-text)]')} />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="max-w-full break-words text-[14px] font-semibold">{ev.summary}</span>
        <span className="text-[12px] text-[var(--ps-muted)]">
          {ev.actor === 'agent' ? '' : ev.actor === 'system' ? 'The app · ' : `${ev.staff}${ev.approver !== '' ? ` · approved by ${ev.approver}` : ''} · `}
          {dateTime(ev.created)}
        </span>
        {agent('mt-1.5 sm:hidden')}
      </span>
      {agent('hidden sm:inline-flex')}
    </li>
  );
}

function Activity(): React.JSX.Element {
  const [group, setGroup] = useState<Group>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(50);
  const d = useLive(() => api.audit({ group, q, limit }), ['audit'], [group, q, limit]);
  const events = d.data?.events ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div className="ps-rise ps-d1 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField value={q} onChange={setQ} placeholder="Receipt, name or what happened" label="Search the activity" tone="card" className="w-full lg:w-[340px] lg:shrink-0" />
        <div role="radiogroup" aria-label="Kind of activity" className="ps-no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {GROUPS.map((g) => (
            <Chip key={g} active={group === g} onClick={() => setGroup(g)}>
              {GROUP_LABEL[g]}
            </Chip>
          ))}
        </div>
      </div>
      <Card delay={2}>
        {d.data === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : events.length === 0 ? (
          <Empty icon={History} title="Nothing here yet" />
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((ev) => (
              <Event key={ev.id} ev={ev} />
            ))}
          </ul>
        )}
      </Card>
      {d.data !== null && d.data.total > events.length && (
        <div className="flex justify-center">
          <Button variant="light" onClick={() => setLimit(limit + 50)}>
            Show 50 more
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function ReportsPage(): React.JSX.Element {
  const { settings, registers } = useApp();
  const today = settings?.today ?? '';
  const [tab, setTab] = useState<'sales' | 'activity'>('sales');
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [register, setRegister] = useState('');
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const days = rangeOf(range, today, from, to);
  const d = useLive(() => api.report({ from: days.from, to: days.to, register }), ['sales'], [days.from, days.to, register]);
  const exportCsv = async (what: 'sales' | 'lines' | 'payments'): Promise<void> => {
    setMenu(false);
    setExporting(true);
    try {
      const res = await api.exportCsv({ what, from: days.from, to: days.to });
      download(res.filename, res.csv);
    } catch {
      /* toasted */
    } finally {
      setExporting(false);
    }
  };
  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={tab === 'activity' ? 'Who did what, and who approved it' : d.data !== null ? `${d.data.from === d.data.to ? dayLabel(d.data.from) : `${dayLabel(d.data.from)} to ${dayLabel(d.data.to)}`} · ${d.data.kpis.orders === 1 ? '1 order' : `${d.data.kpis.orders.toLocaleString('en-US')} orders`}` : undefined}
        actions={
          tab === 'sales' ? (
            <div className="relative">
              <Button ref={menuRef} variant="light" icon={Download} loading={exporting} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)}>
                Export
              </Button>
              <Popover open={menu} onClose={() => setMenu(false)} keep={menuRef} align="right" className="w-64">
                <button type="button" className={menuItem} onClick={() => void exportCsv('sales')}>
                  Sales (one row per receipt)
                </button>
                <button type="button" className={menuItem} onClick={() => void exportCsv('lines')}>
                  Items sold (one row per line)
                </button>
                <button type="button" className={menuItem} onClick={() => void exportCsv('payments')}>
                  Payments
                </button>
              </Popover>
            </div>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-5">
        <Tabs
          value={tab}
          onChange={setTab}
          label="Reports"
          className="ps-rise"
          options={[
            { value: 'sales', label: 'Sales' },
            { value: 'activity', label: 'Activity' },
          ]}
        />
        {tab === 'sales' ? (
          <>
            <div className="ps-rise ps-d1 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
              <div role="radiogroup" aria-label="Days" className="ps-no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
                {RANGES.map(([v, l]) => (
                  <Chip key={v} active={range === v} onClick={() => setRange(v)}>
                    {l}
                  </Chip>
                ))}
              </div>
              {range === 'custom' && (
                <div className="flex gap-2">
                  <input type="date" aria-label="From" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className={cn(pillInput, 'h-10 min-w-0 flex-1 px-4 text-[13px] font-semibold lg:w-[160px] lg:flex-none')} />
                  <input type="date" aria-label="To" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={cn(pillInput, 'h-10 min-w-0 flex-1 px-4 text-[13px] font-semibold lg:w-[160px] lg:flex-none')} />
                </div>
              )}
              {registers.length > 1 && (
                <Select tone="card" ariaLabel="Register" value={register} onChange={setRegister} options={[{ value: '', label: 'Every register' }, ...registers.map((x) => ({ value: x.id, label: x.name }))]} className="w-full lg:ml-auto lg:w-[200px]" />
              )}
            </div>
            {d.data === null ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : (
              <Summary r={d.data} today={today} />
            )}
          </>
        ) : (
          <Activity />
        )}
      </div>
    </div>
  );
}
