/**
 * Orders: every sale, refund and exchange, newest first, one card each.
 * Search by receipt number, ticket name, customer or order number (or scan a
 * receipt); filter by day, kind and how it was paid. The selected sale shows
 * beside the list (in a dialog on narrow screens): its receipt as printed,
 * what was returned from it, the approvals it carried, and the actions:
 * reprint, email it through your AI agent, or return items.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, ChevronRight, Mail, Printer, Receipt as ReceiptIcon, ReceiptText, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, dateTime, dayLabel, money, time } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import { useScanner } from '../lib/scanner.ts';
import type { Sale, SaleKind, SaleListItem } from '../lib/types.ts';
import { printReceipt } from '../components/printReceipt.tsx';
import { Receipt } from '../components/Receipt.tsx';
import { APPROVAL_LABEL } from '../components/Approval.tsx';
import { Badge, Button, Card, Chip, Empty, IconBadge, Modal, PageHeader, SearchField, Segmented, Select, Spinner, inputCls, rowCls } from '../components/ui.tsx';

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'all';

const KIND_LABEL: Record<SaleKind, string> = { sale: 'Sale', refund: 'Refund', exchange: 'Exchange' };
const KIND_ICON: Record<SaleKind, LucideIcon> = { sale: ReceiptText, refund: Undo2, exchange: ArrowLeftRight };

const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: 'all', label: 'All' },
];

const KINDS: { value: 'all' | SaleKind; label: string }[] = [
  { value: 'all', label: 'Every kind' },
  { value: 'sale', label: 'Sales' },
  { value: 'refund', label: 'Refunds' },
  { value: 'exchange', label: 'Exchanges' },
];

function rangeDays(r: Range, today: string): { from: string; to: string } {
  if (r === 'today') return { from: today, to: today };
  if (r === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) };
  if (r === 'week') return { from: addDays(today, -6), to: today };
  if (r === 'month') return { from: addDays(today, -29), to: today };
  return { from: '', to: '' };
}

/** Whether the list and the selected sale fit side by side. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)');
    const on = (): void => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** The round mark of a sale's kind: a receipt, a refund or an exchange. */
function KindBadge({ kind, size = 44 }: { kind: SaleKind; size?: number }): React.JSX.Element {
  return (
    <IconBadge
      icon={KIND_ICON[kind]}
      size={size}
      tone={kind === 'sale' ? 'row' : 'none'}
      className={cn(kind === 'refund' && 'bg-[var(--ps-red)]/14 text-[var(--ps-red-text)]', kind === 'exchange' && 'bg-[var(--ps-amber)]/22 text-[var(--ps-amber-text)]')}
    />
  );
}

/** The receipt as printed, on its paper; scaled down when the column is narrower than the paper. */
function Paper({ sale, width, barcode }: { sale: Sale; width: 58 | 80; barcode: boolean }): React.JSX.Element {
  const room = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const paper = (width * 96) / 25.4;
  useEffect(() => {
    const el = room.current;
    if (el === null) return;
    const fit = (): void => setZoom(Math.min(1, el.clientWidth / paper));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [paper]);
  return (
    <div className="rounded-[22px] bg-[var(--ps-row)] p-2 sm:p-3">
      <div ref={room} className="flex min-w-0 justify-center overflow-hidden">
        <div style={{ zoom }} className="shrink-0 overflow-hidden rounded-[14px] bg-[var(--ps-paper)]">
          <Receipt sale={sale} width={width} barcode={barcode} />
        </div>
      </div>
    </div>
  );
}

const relatedRow = cn(rowCls, 'flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] font-semibold text-[var(--ps-ink)]');

function RelatedMark({ icon: Icon }: { icon: LucideIcon }): React.JSX.Element {
  return (
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ps-card)] text-[var(--ps-ink-2)]">
      <Icon size={14} />
    </span>
  );
}

/** The selected sale: beside the list on wide screens, a dialog on narrow ones. */
function Detail({ id, wide, onClose }: { id: string; wide: boolean; onClose: () => void }): React.JSX.Element {
  const { settings, staff, currency, exp } = useApp();
  const d = useLive(() => api.sale(id), ['sales'], [id]);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const sale: Sale | null = d.data;
  useEffect(() => setEmail(''), [id]);

  const staffName = (sid: string): string => staff.find((s) => s.id === sid)?.name ?? 'A manager';
  const send = async (s: Sale): Promise<void> => {
    setSending(true);
    try {
      await api.emailReceipt(s.id, email.trim());
      toast.success('Your AI agent will email the receipt');
    } catch {
      /* toasted */
    } finally {
      setSending(false);
    }
  };

  const loading = (
    <div className="flex justify-center py-10">
      <Spinner />
    </div>
  );

  const actions = (s: Sale): React.JSX.Element => {
    const returnable = s.kind !== 'refund' && s.lines.some((l) => l.qty > 0 && l.qty - l.returned > 0);
    const total = s.total + s.rounding;
    return (
      <>
        <div className="@container">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <KindBadge kind={s.kind} size={48} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-[22px]">{s.number}</p>
              <p className="truncate text-[13px] text-[var(--ps-muted)]">
                {KIND_LABEL[s.kind]} · {dateTime(s.created)}
              </p>
            </div>
            {/* The total sits beside the number when there is room, under it when there is not. */}
            <span className={cn('num shrink-0 basis-full pl-[60px] text-[26px] font-extrabold leading-[34px] tracking-[-0.01em] @[22rem]:basis-auto @[22rem]:pl-0', total < 0 && 'text-[var(--ps-red-text)]')}>
              {money(total, currency, exp)}
            </span>
          </div>
        </div>
        {s.training && (
          <div className="flex">
            <Badge tone="warn">Training</Badge>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            icon={Printer}
            className="flex-1"
            onClick={() => {
              void api.reprint(s.id).catch(() => undefined);
              printReceipt(s, settings?.receipt_width ?? '80', settings?.receipt_barcode ?? true, true);
            }}
          >
            Print
          </Button>
          {returnable && (
            <Button variant="primary" icon={RotateCcw} dot className="flex-1" onClick={() => navigate('register', { return: s.number })}>
              Return items
            </Button>
          )}
        </div>
        {!s.training && (
          <div className="flex gap-2">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email the receipt to" aria-label="Email address" className={cn(inputCls, 'flex-1')} />
            <Button icon={Mail} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} loading={sending} onClick={() => void send(s)}>
              Send
            </Button>
          </div>
        )}
      </>
    );
  };

  const related = (s: Sale): React.JSX.Element | null =>
    s.returns.length > 0 || s.returns_from.length > 0 || s.approvals.length > 0 ? (
      <div className="flex flex-col gap-2">
        {s.returns_from.map((r) => (
          <button key={r.id} type="button" onClick={() => replaceQuery('orders', { id: r.id })} className={cn(relatedRow, 'hover:bg-[var(--ps-row-hover)]')}>
            <RelatedMark icon={RotateCcw} />
            <span className="min-w-0 flex-1">Returns items from {r.number}</span>
            <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ps-muted)]" />
          </button>
        ))}
        {s.returns.map((r) => (
          <button key={r.id} type="button" onClick={() => replaceQuery('orders', { id: r.id })} className={cn(relatedRow, 'hover:bg-[var(--ps-row-hover)]')}>
            <RelatedMark icon={RotateCcw} />
            <span className="min-w-0 flex-1">
              {KIND_LABEL[r.kind]} {r.number}, {dayLabel(r.created.slice(0, 10))} {time(r.created)}
            </span>
            <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ps-muted)]" />
          </button>
        ))}
        {s.approvals.map((a, i) => (
          <div key={i} className={relatedRow}>
            <RelatedMark icon={ShieldCheck} />
            <span className="min-w-0 flex-1 text-[var(--ps-ink-2)]">
              {APPROVAL_LABEL[a.action]} approved by {staffName(a.approver)}
            </span>
          </div>
        ))}
      </div>
    ) : null;

  const paper = (s: Sale): React.JSX.Element => <Paper sale={s} width={settings?.receipt_width === '58' ? 58 : 80} barcode={settings?.receipt_barcode ?? true} />;

  if (!wide) {
    return (
      <Modal open xl onClose={onClose} title="Receipt">
        {sale === null ? (
          loading
        ) : (
          <div className="flex flex-col gap-3">
            <div className="ps-on-card flex flex-col gap-3 rounded-[22px] bg-[var(--ps-card)] p-4">
              {actions(sale)}
              {related(sale)}
            </div>
            {paper(sale)}
          </div>
        )}
      </Modal>
    );
  }
  return (
    <section aria-label="Selected sale" className="ps-rise ps-on-card flex max-h-[calc(100vh-64px)] min-w-0 flex-col gap-3 rounded-[24px] bg-[var(--ps-card)] p-5">
      {sale === null ? (
        loading
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-3">{actions(sale)}</div>
          <div className="ps-no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[22px]">
            {related(sale)}
            {paper(sale)}
          </div>
        </>
      )}
    </section>
  );
}

function SaleCard({ r, selected, showDay, today, delay, onSelect }: { r: SaleListItem; selected: boolean; showDay: boolean; today: string; delay: number; onSelect: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const who = [r.name, r.customer_name].filter((x) => x !== '').join(' · ');
  const count = Math.abs(r.items);
  const meta = [`${showDay ? `${dayLabel(r.business_day, today)} ` : ''}${time(r.created)}`, r.staff_name, count === 1 ? '1 item' : `${count} items`, r.order_no > 0 ? `Order ${r.order_no}` : '', r.tenders.join(', ')].filter((x) => x !== '').join(' · ');
  return (
    <li className={cn('ps-rise', delay > 0 && `ps-d${delay}`)}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'ps-on-card flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-[24px] bg-[var(--ps-card)] p-4 text-left transition-transform hover:-translate-y-0.5',
          selected && 'ring-2 ring-[var(--ps-ink)]',
        )}
      >
        <KindBadge kind={r.kind} />
        <span className="min-w-0 flex-1">
          {/* The ticket or customer drops under the number when the card is too narrow for both. */}
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[14px] leading-5">
            <span className="shrink-0 font-bold">{r.number}</span>
            {who !== '' && <span className="min-w-[4.5rem] flex-1 truncate font-semibold text-[var(--ps-ink-2)]">{who}</span>}
          </span>
          <span className="num mt-0.5 block text-[12px] leading-4 text-[var(--ps-muted)] sm:truncate">{meta}</span>
        </span>
        {(r.kind !== 'sale' || r.training) && (
          <span className="order-last flex basis-full flex-wrap gap-1.5 pl-14 sm:order-none sm:basis-auto sm:pl-0">
            {r.kind !== 'sale' && <Badge tone={r.kind === 'refund' ? 'bad' : 'warn'}>{KIND_LABEL[r.kind]}</Badge>}
            {r.training && <Badge tone="warn">Training</Badge>}
          </span>
        )}
        <span className={cn('num shrink-0 text-[15px] font-bold', r.collected < 0 && 'text-[var(--ps-red-text)]')}>{money(r.collected, currency, exp)}</span>
      </button>
    </li>
  );
}

export function OrdersPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { settings, registers, currency, exp } = useApp();
  const today = settings?.today ?? '';
  const selected = query.get('id') ?? '';
  const [range, setRange] = useState<Range>((query.get('range') as Range | null) ?? 'today');
  const [kind, setKind] = useState<'all' | SaleKind>('all');
  const [tender, setTender] = useState('');
  const [register, setRegister] = useState('');
  const [q, setQ] = useState('');
  const [training, setTraining] = useState(false);
  const [limit, setLimit] = useState(50);
  const wide = useWide();
  const days = rangeDays(range, today);
  const list = useLive(
    () => api.sales({ from: days.from, to: days.to, kind, tender_kind: tender, register, q: q.trim(), training, limit }),
    ['sales'],
    [days.from, days.to, kind, tender, register, q, training, limit],
  );
  const rows: SaleListItem[] = list.data?.sales ?? [];
  const select = (id: string): void => replaceQuery('orders', { id, range });

  // A scanned receipt opens it.
  useScanner((code) => {
    api
      .lookup(code)
      .then((hit) => {
        if (hit.type === 'sale') select(hit.sale.id);
        else toast.error(`No receipt "${code}"`);
      })
      .catch(() => undefined);
  });

  const totalShown = useMemo(() => rows.reduce((s, r) => s + r.collected, 0), [rows]);
  const showDay = range !== 'today' && range !== 'yesterday';

  return (
    <div>
      <PageHeader title="Orders" subtitle={list.data !== null ? `${list.data.total === 1 ? '1 sale' : `${list.data.total} sales`}` : undefined} />
      <div className="flex flex-col gap-5">
        <div className="ps-rise ps-d1 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SearchField value={q} onChange={setQ} placeholder="Receipt, ticket, customer or order number" label="Search orders" tone="card" className="min-w-[14rem] flex-1" />
            <div className="flex w-full gap-3 sm:w-auto">
              <Select
                ariaLabel="Paid by"
                tone="card"
                value={tender}
                onChange={setTender}
                options={[
                  { value: '', label: 'Any payment' },
                  { value: 'cash', label: 'Cash' },
                  { value: 'card', label: 'Card' },
                  { value: 'qr', label: 'QR' },
                  { value: 'other', label: 'Other' },
                ]}
                className="flex-1 sm:w-44 sm:flex-none"
              />
              {registers.length > 1 && (
                <Select ariaLabel="Register" tone="card" value={register} onChange={setRegister} options={[{ value: '', label: 'Every register' }, ...registers.map((r) => ({ value: r.id, label: r.name }))]} className="flex-1 sm:w-44 sm:flex-none" />
              )}
            </div>
          </div>
          {/* On phones each row of pills runs to the screen's edges and scrolls sideways. */}
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-6">
            <div className="ps-no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              <div role="radiogroup" aria-label="Kind" className="contents">
                {KINDS.map((k) => (
                  <Chip key={k.value} active={kind === k.value} onClick={() => setKind(k.value)}>
                    {k.label}
                  </Chip>
                ))}
              </div>
              <Chip active={training} onClick={() => setTraining(!training)}>
                Training
              </Chip>
            </div>
            <div className="ps-no-scrollbar -mx-4 flex overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
              <Segmented label="Days" value={range} onChange={setRange} options={RANGES} className="max-w-none shrink-0 flex-nowrap bg-[var(--ps-card)] [&>button]:px-2.5 sm:[&>button]:px-3.5" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          <section aria-label="Sales" className="flex min-w-0 flex-col gap-3 lg:col-span-7">
            <div className="flex min-h-6 items-center justify-between gap-3 px-1">
              <h2 className="truncate text-[14px] font-bold">{range === 'all' ? 'All days' : dayLabel(days.from, today) + (days.to !== days.from ? ` to ${dayLabel(days.to, today)}` : '')}</h2>
              <span className="num shrink-0 text-[13px] font-semibold text-[var(--ps-ink-2)]">{rows.length > 0 ? money(totalShown, currency, exp) : ''}</span>
            </div>
            {list.loading && list.data === null ? (
              <Card>
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              </Card>
            ) : rows.length === 0 ? (
              <Card>
                <Empty icon={ReceiptIcon} title={q.trim() !== '' ? `Nothing matches "${q.trim()}"` : 'No sales in these days'} />
              </Card>
            ) : (
              <>
                <ul className="flex flex-col gap-3">
                  {rows.map((r, i) => (
                    <SaleCard key={r.id} r={r} selected={r.id === selected} showDay={showDay} today={today} delay={Math.min(5, i + 1)} onSelect={() => select(r.id)} />
                  ))}
                </ul>
                {list.data !== null && list.data.total > rows.length && (
                  <div className="flex justify-center pt-1">
                    <Button variant="light" onClick={() => setLimit(limit + 50)}>
                      Show 50 more
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
          {wide && (
            <aside className="min-w-0 lg:sticky lg:top-8 lg:col-span-5">
              {selected !== '' ? (
                <Detail id={selected} wide onClose={() => replaceQuery('orders', { range })} />
              ) : (
                <Card delay={2}>
                  <Empty icon={ReceiptIcon} title="No sale selected" compact />
                </Card>
              )}
            </aside>
          )}
        </div>
      </div>
      {!wide && selected !== '' && <Detail id={selected} wide={false} onClose={() => replaceQuery('orders', { range })} />}
    </div>
  );
}
