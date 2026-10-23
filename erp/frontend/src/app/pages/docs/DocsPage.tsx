/**
 * One list for every document type (quotes to supplier credits): what is
 * open at a glance (money owed with its aging, or what is left to deliver
 * and invoice), filter chips with counts, search, a party and a date range,
 * and the documents themselves. Filters live in the URL.
 */
import { useEffect, useMemo, useState } from 'react';
import { CreditCard, FileText, Plus, Sparkles } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AskAgent } from '../../components/AskAgent.tsx';
import { SplitBar } from '../../components/charts.tsx';
import { Chips, SearchBox, useDebounced } from '../../components/controls.tsx';
import { AGING, DateRangeButton, DocStatusPill, PartyFilterButton, PartyLink, bucketOf, canDoc, canPay, listDay, lowerType, moneyOf, roleOf } from '../../components/sales/parts.tsx';
import { DOC_FILTERS, DOC_TYPE_PLURAL, docSide, docStatus } from '../../components/status.ts';
import { DataTable, Pager, SelectionBar } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Card, Empty, Figure, LoadError, PageHeader, PillButton } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { money, plural } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { PAGE_OF_TYPE, navigate, replaceQuery } from '../../lib/router.ts';
import type { DocType } from '../../lib/router.ts';
import type { DocList, DocRow, PartyDetail } from '../../lib/types/sales.ts';
import type { PageProps } from '../../routes.tsx';

const LIMIT = 50;

/* ---------------------------------------------------------------- summary */

interface MoneySummary {
  open: number;
  openCount: number;
  overdue: number;
  overdueCount: number;
  buckets: Record<string, number>;
  paidMonth: number | null;
  paidCount: number;
  currency: string;
}

function monthStart(): string {
  return `${today().slice(0, 7)}-01`;
}

/** What is owed on invoices or bills, how late it is, and what came in this month. */
function MoneyStrip({ type, onFilter }: { type: 'invoice' | 'bill'; onFilter: (status: string) => void }): React.JSX.Element | null {
  const me = useMe();
  const sales = type === 'invoice';
  const s = useLive(
    async (): Promise<MoneySummary> => {
      const page = (offset: number): Promise<DocList> => op<DocList>('docs.list', { type, status: 'unpaid', limit: 500, offset, sort: 'due', desc: false }, { quiet: true });
      const [open, paid] = await Promise.all([
        page(0),
        op<{ total: number; total_base: number }>('payments.list', { direction: sales ? 'in' : 'out', status: 'posted', from: monthStart(), limit: 1 }, { quiet: true }).catch(() => null),
      ]);
      // Every open document counts in the aging, however many there are (500 a page).
      const rest = Array.from({ length: Math.min(40, Math.ceil(open.total / 500) - 1) }, (_, i) => (i + 1) * 500);
      const more = await Promise.all(rest.map(page));
      const all = [...open.docs, ...more.flatMap((m) => m.docs)];
      const buckets: Record<string, number> = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
      let overdue = 0;
      let overdueCount = 0;
      for (const d of all) {
        const base = d.total > 0 ? Math.round((d.balance * d.total_base) / d.total) : d.balance;
        const b = bucketOf(d.status === 'overdue' ? d.days_overdue : 0);
        buckets[b] = (buckets[b] ?? 0) + base;
        if (d.status === 'overdue') {
          overdue += base;
          overdueCount += 1;
        }
      }
      return { open: open.open_base, openCount: open.total, overdue, overdueCount, buckets, paidMonth: paid?.total_base ?? null, paidCount: paid?.total ?? 0, currency: open.currency };
    },
    [...READS.docs, 'payments'],
    [type],
  );
  const d = s.data;
  if (d === null) {
    // A summary only: when it cannot load, the list below says why.
    if (s.error !== null) return null;
    return (
      <div className="mb-5 grid grid-cols-1 gap-5 @min-[640px]:grid-cols-12">
        <span className="erp-skeleton block h-[188px] rounded-[24px] @min-[640px]:col-span-7" />
        <span className="erp-skeleton block h-[188px] rounded-[24px] @min-[640px]:col-span-5" />
      </div>
    );
  }
  const cur = d.currency;
  const parts = AGING.map((a) => ({ key: a.key, label: a.label, value: d.buckets[a.key] ?? 0, valueText: money(d.buckets[a.key] ?? 0, cur, 'short'), fill: a.fill, onClick: () => onFilter(a.key === 'current' ? 'unpaid' : 'overdue') }));
  return (
    <div className="mb-5 grid grid-cols-1 gap-5 @min-[640px]:grid-cols-12">
      <Card tone="dark" className="@min-[640px]:col-span-7" delay={1}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-[var(--erp-on-dark-muted)]">{sales ? 'Owed to you' : 'You owe'}</p>
            <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(d.open, cur)}</p>
            <p className="text-[13px] text-[var(--erp-on-dark-muted)]">{plural(d.openCount, sales ? 'open invoice' : 'open bill')}</p>
          </div>
        </div>
        <div className="mt-5">
          <SplitBar parts={parts} height={12} legend={false} dark />
          <ul className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2 @min-[480px]:grid-cols-5">
            {AGING.map((a) => (
              <li key={a.key} className="min-w-0">
                <span className="flex items-center gap-1.5 text-[12px] text-[var(--erp-on-dark-muted)]">
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: a.fill }} />
                  <span className="truncate">{a.key === 'current' ? 'Not due' : `${a.short} days`}</span>
                </span>
                <span className="num block truncate text-[13px] font-bold">{money(d.buckets[a.key] ?? 0, cur, 'short')}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <Card tone="sand" className="grid grid-cols-2 items-start gap-5 @min-[640px]:col-span-5 @min-[640px]:grid-cols-1" delay={2}>
        <div className="flex min-w-0 flex-col items-start gap-3 @min-[640px]:flex-row @min-[640px]:justify-between">
          <Figure label="Overdue" value={money(d.overdue, cur, 'short')} tone={d.overdue > 0 ? 'red' : 'ink'} sub={d.overdueCount > 0 ? plural(d.overdueCount, sales ? 'invoice' : 'bill') : 'Nothing is late'} onClick={d.overdueCount > 0 ? () => onFilter('overdue') : undefined} />
          {sales && d.overdueCount > 0 && can(me, 'sales', 'edit') && <AskAgent kind="collections_requested" label="Chase them" variant="light" size="sm" align="start" />}
        </div>
        <div className="min-w-0 @min-[640px]:border-t @min-[640px]:border-[var(--erp-line)] @min-[640px]:pt-4">
          {d.paidMonth !== null ? (
            <Figure label={sales ? 'Paid in this month' : 'Paid out this month'} value={money(d.paidMonth, cur, 'short')} tone={sales && d.paidMonth > 0 ? 'green' : 'ink'} sub={plural(d.paidCount, 'payment')} />
          ) : (
            <Figure label="Open" value={plural(d.openCount, sales ? 'invoice' : 'bill')} />
          )}
        </div>
      </Card>
    </div>
  );
}

/** Orders: what is left to deliver (receive) and to invoice (bill). Quotes: what is out, expired, won. */
function FlowStrip({ type, onFilter }: { type: DocType; onFilter: (status: string) => void }): React.JSX.Element | null {
  const order = type === 'sales_order' || type === 'purchase_order';
  const keys = order ? ['to_fulfil', 'to_bill'] : ['sent', 'expired'];
  const s = useLive(
    async () => {
      const r = await Promise.all(keys.map((k) => op<DocList>('docs.list', { type, status: k, limit: 1 }, { quiet: true })));
      return r.map((x) => ({ count: x.total, value: x.total_base, currency: x.currency, counts: x.counts }));
    },
    READS.docs,
    [type],
  );
  const d = s.data;
  if (d === null) return s.error !== null ? null : <span className="erp-skeleton mb-5 block h-[112px] rounded-[24px]" />;
  const [a, b] = d;
  if (a === undefined || b === undefined) return null;
  const cur = a.currency;
  const sales = docSide(type) === 'sales';
  const tiles = order
    ? [
        { key: 'to_fulfil', label: sales ? 'To deliver' : 'To receive', count: a.count, value: a.value },
        { key: 'to_bill', label: sales ? 'To invoice' : 'To bill', count: b.count, value: b.value },
      ]
    : [
        { key: 'sent', label: 'Waiting on customers', count: a.count, value: a.value },
        { key: 'expired', label: 'Expired', count: b.count, value: b.value },
      ];
  const won = a.counts['accepted'] ?? 0;
  const lost = a.counts['declined'] ?? 0;
  return (
    <Card tone="sand" className="mb-5" delay={1}>
      <div className={cn('grid grid-cols-2 gap-5', !order && '@min-[480px]:grid-cols-3')}>
        {tiles.map((t) => (
          <Figure key={t.key} label={t.label} value={money(t.value, cur, 'short')} sub={plural(t.count, order ? 'order' : 'quote')} tone={t.key === 'expired' && t.count > 0 ? 'red' : 'ink'} onClick={() => onFilter(t.key)} />
        ))}
        {!order && <Figure label="Win rate" value={won + lost > 0 ? `${Math.round((won / (won + lost)) * 100)}%` : 'None yet'} sub={`${won} accepted, ${lost} declined`} />}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export function DocsPage({ query, type }: PageProps & { type: DocType }): React.JSX.Element {
  const me = useMe();
  const page = PAGE_OF_TYPE[type];
  const side = docSide(type);
  const role = roleOf(type);
  const money_ = moneyOf(type);
  const status = query.get('status') ?? '';
  const q = query.get('q') ?? '';
  const party = query.get('party') ?? '';
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  const offset = Math.max(0, Number(query.get('offset') ?? '0') || 0);
  const [text, setText] = useState(q);
  const dq = useDebounced(text, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const setQuery = (patch: Record<string, string | undefined>): void => {
    const next = { status, q, party, from, to, offset: offset > 0 ? String(offset) : undefined, ...patch };
    if (!('offset' in patch)) next.offset = undefined;
    replaceQuery(page, next);
  };

  // The address may change under the box (Back, a chip, a link); keep what is being typed when it says the same.
  useEffect(() => setText((t) => (t.trim() === q ? t : q)), [q]);
  useEffect(() => {
    if (dq.trim() !== q) setQuery({ q: dq.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  useEffect(() => setSelected(new Set()), [type, status, q, party, from, to, offset]);

  const canSee = canDoc(me, type, 'view');
  const list = useLive(
    () => (!canSee ? Promise.resolve(null) : op<DocList>('docs.list', { type, status: status !== '' ? status : undefined, q: q !== '' ? q : undefined, party: party !== '' ? party : undefined, from: from !== '' ? from : undefined, to: to !== '' ? to : undefined, limit: LIMIT, offset }, { quiet: true })),
    [...READS.docs, 'parties'],
    [type, status, q, party, from, to, offset, canSee],
  );
  const partyInfo = useLive(() => (party === '' ? Promise.resolve(null) : op<PartyDetail>('parties.get', { party }, { quiet: true }).catch(() => null)), ['parties'], [party]);

  const data = list.data;
  const rows = data?.docs ?? [];
  const counts = data?.counts ?? {};
  const filters = DOC_FILTERS[type] ?? [];
  const chipOptions = [{ value: '', label: 'All', count: counts['all'] }, ...filters.map((f) => ({ value: f.value, label: f.label, count: counts[f.value], alert: f.alert }))];
  const canNew = canDoc(me, type, 'edit');
  const selectable = (type === 'invoice' && (can(me, 'sales', 'edit') || canPay(me, side))) || (type === 'bill' && canPay(me, side));
  const selRows = rows.filter((r) => selected.has(r.id));
  const selParties = [...new Set(selRows.map((r) => r.party.id))];
  const selOverdue = selRows.filter((r) => r.status === 'overdue').length;

  const dueHead = money_ ? 'Due' : type === 'quote' ? 'Valid until' : type === 'sales_order' || type === 'purchase_order' ? 'Expected' : '';
  const dueCell = (r: DocRow): React.ReactNode => {
    if (money_) {
      if (r.status === 'overdue') return <span className="font-semibold text-[var(--erp-red-text)]">{plural(r.days_overdue, 'day')} overdue</span>;
      if (r.status === 'paid' || r.status === 'used') return <span className="text-[var(--erp-muted)]">{r.status === 'paid' ? 'Paid' : 'Used'}</span>;
      return r.due_date !== '' ? <span className={cn(r.state === 'draft' && 'text-[var(--erp-muted)]')}>{listDay(r.due_date)}</span> : '';
    }
    if (type === 'quote') return r.valid_until === '' ? '' : r.status === 'expired' ? <span className="font-semibold text-[var(--erp-red-text)]">Expired</span> : listDay(r.valid_until);
    return r.expected_date !== '' ? listDay(r.expected_date) : <span className="text-[var(--erp-muted)]">Not set</span>;
  };

  const columns = useMemo<Column<DocRow>[]>(() => {
    const cols: Column<DocRow>[] = [
      {
        key: 'number',
        label: 'Number',
        width: '112px',
        sort: (r) => r.number,
        render: (r) => (r.number !== '' ? <span className="num truncate font-semibold">{r.number}</span> : <span className="font-semibold text-[var(--erp-muted)]">Draft</span>),
      },
      {
        key: 'party',
        label: side === 'sales' ? 'Customer' : 'Supplier',
        width: 'minmax(0, 1.6fr)',
        sort: (r) => r.party.name.toLowerCase(),
        render: (r) => (
          <span className="flex min-w-0 flex-col">
            <PartyLink id={r.party.id} name={r.party.name} role={role} />
            {r.reference !== '' && <span className="truncate text-[12px] text-[var(--erp-muted)]">{r.reference}</span>}
          </span>
        ),
      },
      { key: 'date', label: 'Date', width: '92px', hide: 'lg', sort: (r) => r.date, render: (r) => <span className="text-[var(--erp-ink-2)]">{r.date !== '' ? listDay(r.date) : ''}</span> },
    ];
    if (dueHead !== '') cols.push({ key: 'due', label: dueHead, width: '132px', sort: (r) => (money_ ? r.due_date : type === 'quote' ? r.valid_until : r.expected_date), render: dueCell });
    if (type !== 'delivery' && type !== 'goods_receipt') cols.push({ key: 'total', label: 'Total', align: 'right', width: '124px', sort: (r) => r.total_base, render: (r) => <span className="font-semibold">{money(r.total, r.currency)}</span> });
    if (money_) cols.push({ key: 'balance', label: type === 'credit_note' || type === 'supplier_credit' ? 'Left' : 'Balance', align: 'right', width: '116px', hide: 'xl', sort: (r) => r.balance, render: (r) => (r.state === 'posted' && r.balance > 0 ? money(r.balance, r.currency) : <span className="text-[var(--erp-muted)]">{r.state === 'posted' ? money(0, r.currency) : ''}</span>) });
    if (type === 'delivery' || type === 'goods_receipt') cols.push({ key: 'lines', label: 'Lines', align: 'right', width: '88px', render: (r) => r.lines_count });
    cols.push({
      key: 'status',
      label: 'Status',
      width: '148px',
      render: (r) => (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <DocStatusPill status={r.status} />
          {r.prepared_actor === 'agent' && (
            <span title="Prepared by your AI agent" className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--erp-accent-soft)] text-[var(--erp-ink)]">
              <Sparkles size={12} aria-hidden />
              <span className="sr-only">Prepared by your AI agent</span>
            </span>
          )}
        </span>
      ),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, side, role]);

  const plural_ = DOC_TYPE_PLURAL[type] ?? type;
  const filtered = status !== '' || q !== '' || party !== '' || from !== '' || to !== '';

  if (!canSee) {
    return (
      <>
        <PageHeader title={plural_} />
        <Card>
          <Empty icon={FileText} title={`Your role cannot see ${plural_.toLowerCase()}`}>
            Ask an administrator for access to {side === 'sales' ? 'Sales' : 'Purchasing'}.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <div className={cn(selected.size > 0 && 'pb-20')}>
      <PageHeader
        title={plural_}
        subtitle={data !== null ? `${plural(data.total, lowerType(type), plural_.toLowerCase())}${filtered ? ' match' : ''}${type !== 'delivery' && type !== 'goods_receipt' ? ` · ${money(data.total_base, data.currency)}` : ''}` : undefined}
        actions={
          canNew ? (
            <PillButton icon={Plus} dot onClick={() => navigate('doc-new', { type, party: party !== '' ? party : undefined })}>
              New {lowerType(type)}
            </PillButton>
          ) : undefined
        }
      />

      {(type === 'invoice' || type === 'bill') && <MoneyStrip type={type} onFilter={(st) => setQuery({ status: st })} />}
      {(type === 'sales_order' || type === 'purchase_order' || type === 'quote') && <FlowStrip type={type} onFilter={(st) => setQuery({ status: st })} />}

      <Chips ariaLabel={`Filter ${plural_.toLowerCase()}`} value={status} onChange={(v) => setQuery({ status: v })} options={chipOptions} className="mb-3" />
      <div className="relative z-20 mb-5 flex flex-col gap-2 @min-[480px]:flex-row @min-[480px]:items-center">
        <SearchBox value={text} onChange={setText} placeholder={`Number, reference or ${role}`} ariaLabel={`Search ${plural_.toLowerCase()}`} className="min-w-0 flex-1" />
        <div className="grid grid-cols-2 gap-2 @min-[480px]:flex">
          <PartyFilterButton role={role} id={party} name={partyInfo.data?.name ?? ''} onChange={(id) => setQuery({ party: id })} />
          <DateRangeButton value={{ from, to }} onChange={(r) => setQuery({ from: r.from, to: r.to })} />
        </div>
      </div>

      {list.error !== null && data === null ? (
        <LoadError message={list.error} onRetry={list.reload} />
      ) : (
        <Card delay={2} className="!p-3 @min-[640px]:!p-4">
          <DataTable<DocRow>
            ariaLabel={plural_}
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.loading}
            onOpen={(r) => navigate('doc', { id: r.id })}
            selected={selectable ? selected : undefined}
            onSelect={selectable ? setSelected : undefined}
            rowTone={(r) => (r.status === 'overdue' ? 'alert' : r.status === 'void' || r.status === 'cancelled' ? 'muted' : undefined)}
            mobile={(r) => ({
              title: r.party.name !== '' ? r.party.name : 'No party',
              sub: (
                <span className="flex items-center gap-1.5">
                  <span className="num">{r.number !== '' ? r.number : 'Draft'}</span>
                  <span>·</span>
                  {money_ && r.status === 'overdue' ? <span className="font-semibold text-[var(--erp-red-text)]">{plural(r.days_overdue, 'day')} late</span> : <span>{r.date !== '' ? dayLabel(r.date) : ''}</span>}
                  {r.prepared_actor === 'agent' && <Sparkles size={12} aria-label="Prepared by your AI agent" />}
                </span>
              ),
              right: type === 'delivery' || type === 'goods_receipt' ? plural(r.lines_count, 'line') : money(money_ && r.state === 'posted' ? r.balance : r.total, r.currency),
              rightSub: docStatus(r.status).label,
            })}
            empty={
              <Empty
                icon={FileText}
                title={filtered ? `No ${plural_.toLowerCase()} match` : `No ${plural_.toLowerCase()} yet`}
                action={
                  filtered ? (
                    <PillButton variant="soft" onClick={() => replaceQuery(page, {})}>
                      Show all
                    </PillButton>
                  ) : canNew ? (
                    <PillButton icon={Plus} dot onClick={() => navigate('doc-new', { type })}>
                      New {lowerType(type)}
                    </PillButton>
                  ) : undefined
                }
              >
                {filtered ? 'Try another filter or search.' : `${plural_} you make show here.`}
              </Empty>
            }
          />
          {data !== null && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={(o) => setQuery({ offset: o > 0 ? String(o) : undefined })} />}
        </Card>
      )}

      <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        {type === 'invoice' && can(me, 'sales', 'edit') && selOverdue > 0 && <AskAgent kind="collections_requested" label="Ask your AI agent to send reminders" variant="accent" size="sm" />}
        {canPay(me, side) && selParties.length === 1 && (
          <PillButton
            variant={type === 'invoice' && selOverdue > 0 ? 'soft' : 'accent'}
            size="sm"
            icon={CreditCard}
            onClick={() => navigate('payments', { new: side === 'sales' ? 'in' : 'out', party: selParties.length === 1 ? selParties[0] : undefined })}
          >
            Record payment
          </PillButton>
        )}
      </SelectionBar>
    </div>
  );
}
