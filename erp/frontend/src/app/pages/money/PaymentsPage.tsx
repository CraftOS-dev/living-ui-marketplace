/**
 * Payments: money in from customers and out to suppliers. A summary of the
 * month on top, filters by state, then the list. "Record a payment" opens
 * the full-screen flow (also from ?new=in|out, with ?party= and ?doc=).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, Wallet } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AskAgent } from '../../components/AskAgent.tsx';
import { Chips, SearchBox, Segmented, useDebounced } from '../../components/controls.tsx';
import { useFullScreen } from '../../components/FullScreen.tsx';
import { DirIcon } from '../../components/money/bits.tsx';
import { methodLabel } from '../../components/money/labels.ts';
import { RecordPayment } from '../../components/money/RecordPayment.tsx';
import { PAYMENT_STATUS, statusOf } from '../../components/status.ts';
import { DataTable, Pager } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { ActorPill, Card, Empty, Figure, LoadError, PageHeader, PillButton, StatusPill, TextLink } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Direction, PaymentList, PaymentRow } from '../../lib/types/money.ts';
import type { PageProps } from '../../routes.tsx';

type Dir = Direction | 'all';
type Filter = 'all' | 'posted' | 'unallocated' | 'draft' | 'void';

const LIMIT = 50;

interface Combined {
  rows: PaymentRow[];
  total: number;
  counts: Record<Filter, number>;
}

function combine(lists: { dir: Direction; list: PaymentList }[]): Combined {
  const rows = lists.flatMap((l) => l.list.payments.map((p) => ({ ...p, direction: l.dir })));
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const counts: Record<Filter, number> = { all: 0, posted: 0, unallocated: 0, draft: 0, void: 0 };
  for (const l of lists) {
    const c = l.list.counts;
    counts.posted += c.posted ?? 0;
    counts.unallocated += c.unallocated ?? 0;
    counts.draft += c.draft ?? 0;
    counts.void += c.void ?? 0;
  }
  counts.all = counts.posted + counts.draft + counts.void;
  return { rows, total: lists.reduce((s, l) => s + l.list.total, 0), counts };
}

interface Month {
  received: number;
  paid: number;
  credit: number;
  creditCount: number;
}

export function PaymentsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const base = baseCurrency(me);
  const dirQ = query.get('direction');
  const dir: Dir = dirQ === 'in' || dirQ === 'out' ? dirQ : 'all';
  const filterQ = query.get('status') as Filter | null;
  const filter: Filter = filterQ !== null && ['posted', 'unallocated', 'draft', 'void'].includes(filterQ) ? filterQ : 'all';
  const [q, setQ] = useState(query.get('q') ?? '');
  const dq = useDebounced(q, 250);
  const [offset, setOffset] = useState(0);
  const newQ = query.get('new');
  const canIn = can(me, 'banking', 'edit') || can(me, 'sales', 'full');
  const canOut = can(me, 'banking', 'edit') || can(me, 'purchasing', 'full');
  const canSeeIn = can(me, 'banking') || can(me, 'sales');
  const canSeeOut = can(me, 'banking') || can(me, 'purchasing');
  const dirs: Direction[] = (dir === 'all' ? (['in', 'out'] as Direction[]) : [dir]).filter((d) => (d === 'in' ? canSeeIn : canSeeOut));

  const [fsDir, setFsDir] = useState<Direction>('in');
  const fs = useFullScreen(() => {
    if (query.get('new') !== null && window.location.hash.startsWith('#/payments')) replaceQuery('payments', { direction: dirQ ?? undefined, status: filterQ ?? undefined });
  });
  const opened = useRef(false);
  useEffect(() => {
    if ((newQ === 'in' || newQ === 'out') && !opened.current && !fs.isOpen) {
      opened.current = true;
      setFsDir(newQ);
      fs.open(null);
    }
    if (newQ === null) opened.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newQ]);

  useEffect(() => setOffset(0), [dir, filter, dq]);

  const list = useLive(
    async () => {
      const lists = await Promise.all(
        dirs.map(async (d) => ({
          dir: d,
          list: await op<PaymentList>('payments.list', { direction: d, status: filter === 'all' ? undefined : filter, q: dq === '' ? undefined : dq, limit: dirs.length > 1 ? 100 : LIMIT, offset: dirs.length > 1 ? 0 : offset }, { quiet: true }),
        })),
      );
      return combine(lists);
    },
    READS.money,
    [dirs.join(','), filter, dq, offset],
  );

  // The month at a glance: received, paid, and money not yet applied.
  const month = useLive(
    async (): Promise<Month> => {
      const from = `${today().slice(0, 7)}-01`;
      const [inM, outM, credit] = await Promise.all([
        canSeeIn ? op<PaymentList>('payments.list', { direction: 'in', status: 'posted', from, limit: 1 }, { quiet: true }) : null,
        canSeeOut ? op<PaymentList>('payments.list', { direction: 'out', status: 'posted', from, limit: 1 }, { quiet: true }) : null,
        canSeeIn ? op<PaymentList>('payments.list', { direction: 'in', status: 'unallocated', limit: 500 }, { quiet: true }) : null,
      ]);
      const open = (credit?.payments ?? []).filter((p) => p.currency === base);
      return { received: inM?.total_base ?? 0, paid: outM?.total_base ?? 0, credit: open.reduce((s, p) => s + p.unallocated, 0), creditCount: credit?.payments.length ?? 0 };
    },
    READS.money,
    [base, canSeeIn, canSeeOut],
  );

  const data = list.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const m = month.data;

  const setDir = (d: Dir): void => replaceQuery('payments', { direction: d === 'all' ? undefined : d, status: filter === 'all' ? undefined : filter });
  const setFilter = (f: Filter): void => replaceQuery('payments', { direction: dir === 'all' ? undefined : dir, status: f === 'all' ? undefined : f });
  const openNew = (d: Direction, el: Element | null): void => {
    setFsDir(d);
    fs.open(el);
  };

  const columns: Column<PaymentRow>[] = [
    {
      key: 'number',
      label: 'Payment',
      width: 'minmax(140px, 1fr)',
      sort: (r) => r.number,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <DirIcon dir={r.direction ?? 'in'} />
          <span className="min-w-0">
            <span className="num block truncate font-bold">{r.number !== '' ? r.number : 'Draft'}</span>
            {r.prepared_actor === 'agent' && <ActorPill actor="agent" />}
          </span>
        </span>
      ),
    },
    {
      key: 'party',
      label: 'From or to',
      width: 'minmax(160px, 1.8fr)',
      sort: (r) => r.party.name,
      render: (r) => (
        <span className="flex min-w-0 flex-col items-start">
          <TextLink onClick={() => navigate('party', { id: r.party.id, role: r.direction === 'out' ? 'supplier' : 'customer' })} className="max-w-full">
            <span className="truncate">{r.party.name}</span>
          </TextLink>
          <span className="max-w-full truncate text-[12px] text-[var(--erp-muted)]">
            {r.bank}
            {r.method !== '' ? ` · ${methodLabel(r.method)}` : ''}
          </span>
        </span>
      ),
    },
    { key: 'date', label: 'Date', width: '120px', sort: (r) => r.date, render: (r) => <span className="text-[13px] text-[var(--erp-ink-2)]">{dayLabel(r.date)}</span> },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      width: '140px',
      sort: (r) => r.amount_base,
      render: (r) => (
        <span className={cn('font-bold', r.state === 'void' ? 'text-[var(--erp-muted)] line-through' : r.direction === 'in' ? 'text-[var(--erp-green-text)]' : '')}>
          {r.direction === 'in' ? '+' : '−'}
          {money(r.amount, r.currency)}
        </span>
      ),
    },
    {
      key: 'applied',
      label: 'Applied',
      width: '130px',
      hide: 'md',
      render: (r) => {
        if (r.state !== 'posted') return <span className="text-[13px] text-[var(--erp-muted)]">Not posted</span>;
        if (r.unallocated <= 0) return <span className="text-[13px] text-[var(--erp-muted)]">All applied</span>;
        const share = r.amount > 0 ? (r.amount - r.unallocated) / r.amount : 0;
        return (
          <span className="flex w-full flex-col gap-1">
            <span className="text-[12px] font-semibold text-[var(--erp-amber-text)]">{money(r.unallocated, r.currency)} left</span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--erp-line)]">
              <span className="block h-full rounded-full bg-[var(--erp-amber)]" style={{ width: `${Math.max(4, share * 100)}%` }} />
            </span>
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '120px',
      align: 'right',
      render: (r) => {
        const s = r.state === 'posted' && r.unallocated > 0 ? statusOf(PAYMENT_STATUS, 'unallocated') : statusOf(PAYMENT_STATUS, r.state);
        return (
          <StatusPill tone={s.tone} size="sm">
            {s.label}
          </StatusPill>
        );
      },
    },
  ];

  const counts = data?.counts;
  const net = m !== null ? m.received - m.paid : 0;
  const both = m !== null ? m.received + m.paid : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Payments"
        subtitle="Money in from customers and out to suppliers"
        actions={
          <>
            {canOut && (
              <PillButton variant="light" icon={ArrowUpRight} onClick={(e) => openNew('out', e.currentTarget)}>
                Pay a supplier
              </PillButton>
            )}
            {canIn && (
              <PillButton icon={Plus} dot onClick={(e) => openNew('in', e.currentTarget)}>
                Record money in
              </PillButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card tone="dark" className="@min-[900px]:col-span-8" delay={1}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold text-[var(--erp-on-dark-muted)]">This month, so far</p>
              <p className={cn('num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]', net < 0 && 'text-[var(--erp-red-on-dark)]')}>
                {m === null ? '...' : `${net >= 0 ? '+' : '−'}${money(Math.abs(net), base)}`}
              </p>
              <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">Received minus paid out</p>
            </div>
            <span className="flex size-11 items-center justify-center rounded-full bg-[var(--erp-dark-2)] text-[var(--erp-accent)]">
              <ArrowLeftRight size={18} aria-hidden />
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDir('in')} className="rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
              <span className="flex items-center gap-1.5 text-[12px] text-[var(--erp-on-dark-muted)]">
                <span className="size-2 rounded-full bg-[var(--erp-accent)]" aria-hidden /> Received
              </span>
              <span className="num block truncate text-[15px] font-bold">{m === null ? '...' : money(m.received, base)}</span>
            </button>
            <button type="button" onClick={() => setDir('out')} className="rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
              <span className="flex items-center gap-1.5 text-[12px] text-[var(--erp-on-dark-muted)]">
                <span className="size-2 rounded-full bg-[var(--erp-on-dark)]" aria-hidden /> Paid out
              </span>
              <span className="num block truncate text-[15px] font-bold">{m === null ? '...' : money(m.paid, base)}</span>
            </button>
          </div>
          <div className="mt-4 flex h-2.5 w-full gap-1 overflow-hidden" aria-hidden>
            {both > 0 ? (
              <>
                <span className="erp-grow-x h-full rounded-full bg-[var(--erp-accent)]" style={{ width: `${((m?.received ?? 0) / both) * 100}%`, minWidth: (m?.received ?? 0) > 0 ? 6 : 0 }} />
                <span className="erp-grow-x h-full rounded-full bg-[var(--erp-on-dark)]" style={{ width: `${((m?.paid ?? 0) / both) * 100}%`, minWidth: (m?.paid ?? 0) > 0 ? 6 : 0 }} />
              </>
            ) : (
              <span className="h-full w-full rounded-full bg-[var(--erp-dark-2)]" />
            )}
          </div>
        </Card>
        <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
          <Figure
            label="Paid to you, not applied yet"
            value={m === null ? '...' : money(m.credit, base)}
            sub={m === null ? undefined : m.creditCount === 0 ? 'Every payment is matched to its invoices' : `${m.creditCount} ${m.creditCount === 1 ? 'payment waits' : 'payments wait'} to be applied (credit on the customer)`}
          />
          {m !== null && m.creditCount > 0 && (
            <PillButton variant="light" size="sm" className="mt-4" onClick={() => replaceQuery('payments', { direction: 'in', status: 'unallocated' })}>
              Show them
            </PillButton>
          )}
          {m !== null && m.creditCount === 0 && can(me, 'sales', 'edit') && (
            <div className="mt-4">
              <AskAgent kind="collections_requested" label="Chase what is owed" variant="light" size="sm" align="start" />
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-3 @min-[900px]:flex-row @min-[900px]:items-center @min-[900px]:justify-between">
        <div className="flex min-w-0 flex-col gap-3 @min-[480px]:flex-row @min-[480px]:items-center">
          <Segmented
            ariaLabel="Direction"
            onShell
            value={dir}
            onChange={setDir}
            options={[
              { value: 'all', label: 'In and out' },
              { value: 'in', label: 'Money in', icon: ArrowDownLeft },
              { value: 'out', label: 'Money out', icon: ArrowUpRight },
            ]}
          />
          <Chips
            ariaLabel="Filter by state"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: counts?.all },
              { value: 'unallocated', label: 'Not applied', count: counts?.unallocated },
              { value: 'draft', label: 'Drafts', count: counts?.draft },
              { value: 'void', label: 'Void', count: counts?.void },
            ]}
          />
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Search number, reference, name" ariaLabel="Search payments" className="w-full @min-[900px]:w-72" />
      </div>

      {list.error !== null && data === null ? (
        <LoadError message={list.error} onRetry={list.reload} />
      ) : (
        <Card delay={2}>
          <DataTable
            ariaLabel="Payments"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.loading}
            onOpen={(r) => navigate('payment', { id: r.id })}
            rowTone={(r) => (r.state === 'void' ? 'muted' : undefined)}
            mobile={(r) => ({
              lead: <DirIcon dir={r.direction ?? 'in'} />,
              title: r.party.name,
              sub: `${r.number !== '' ? r.number : 'Draft'} · ${dayLabel(r.date)}${r.unallocated > 0 && r.state === 'posted' ? ' · not all applied' : ''}`,
              right: (
                <span className={cn(r.direction === 'in' && r.state !== 'void' && 'text-[var(--erp-green-text)]', r.state === 'void' && 'line-through')}>
                  {r.direction === 'in' ? '+' : '−'}
                  {money(r.amount, r.currency)}
                </span>
              ),
              rightSub: statusOf(PAYMENT_STATUS, r.state === 'posted' && r.unallocated > 0 ? 'unallocated' : r.state).label,
            })}
            empty={
              <Empty icon={Wallet} title={dq !== '' || filter !== 'all' ? 'No payments match' : 'No payments yet'} action={canIn && dq === '' && filter === 'all' ? <PillButton icon={Plus} dot onClick={(e) => openNew('in', e.currentTarget)}>Record money in</PillButton> : undefined}>
                {dq !== '' || filter !== 'all' ? 'Try another search or filter.' : 'Money customers pay you and money you pay suppliers shows up here.'}
              </Empty>
            }
          />
          {dirs.length === 1 && data !== null && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
          {dirs.length > 1 && data !== null && data.total > rows.length && (
            <p className="mt-4 text-center text-[12px] text-[var(--erp-muted)]">The latest {rows.length} of {data.total}</p>
          )}
        </Card>
      )}

      {fs.node(<RecordPayment initialDirection={fsDir} initialParty={query.get('party') ?? undefined} initialDoc={query.get('doc') ?? undefined} onClose={fs.close} />, { title: 'Record a payment' })}
    </div>
  );
}
