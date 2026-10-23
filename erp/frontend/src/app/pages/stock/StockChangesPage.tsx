/**
 * Stock changes: every adjustment, count and transfer as one numbered record
 * with its value and who made it (a person or your AI agent). "New stock
 * change" (and ?new=1 from the sidebar) opens the stock change screen.
 */
import { useEffect, useState } from 'react';
import { ArrowLeftRight, ClipboardCheck, ClipboardList, Plus, SlidersHorizontal } from 'lucide-react';
import { Chips } from '../../components/controls.tsx';
import type { ChipOption } from '../../components/controls.tsx';
import { CHANGE_KIND, REASON_LABEL, tableDay } from '../../components/stock/parts.tsx';
import { RecordProposals } from '../../components/stock/RecordProposals.tsx';
import { useStockChange } from '../../components/stock/StockChangeScreen.tsx';
import type { ChangeMode } from '../../components/stock/StockChangeScreen.tsx';
import { dropFlag, quietQuery } from '../../components/stock/url.ts';
import { DataTable, Pager } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { ActorPill, Card, Empty, LoadError, PageHeader, PillButton, StatusPill } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { money, plural } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { ChangeKind, StockChange, StockChangeList } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

const LIMIT = 50;
type Filter = 'all' | ChangeKind;

const KIND_ICON = { adjust: SlidersHorizontal, count: ClipboardCheck, transfer: ArrowLeftRight } as const;

export function StockChangesPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const canChange = can(me, 'inventory', 'edit');
  const start = query.get('kind');
  const [filter, setFilter] = useState<Filter>(start === 'adjust' || start === 'count' || start === 'transfer' ? start : 'all');
  const [offset, setOffset] = useState(0);
  const wantsNew = query.get('new') !== null;
  const mode = query.get('mode');
  const change = useStockChange({
    onSaved: (c) => navigate('stock-change', { id: c.id }),
    onClosed: () => {
      dropFlag('stock-changes', 'new');
    },
  });

  useEffect(() => {
    if (wantsNew && canChange) change.open(null, mode === 'in' || mode === 'out' || mode === 'count' || mode === 'transfer' ? { mode: mode as ChangeMode } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew]);

  useEffect(() => {
    setOffset(0);
    quietQuery('stock-changes', { kind: filter === 'all' ? '' : filter, new: wantsNew ? '1' : '', mode: wantsNew && mode !== null ? mode : '' });
  }, [filter, wantsNew, mode]);

  const counts = useLive(
    async () => {
      const [all, adjust, count, transfer] = await Promise.all(
        (['', 'adjust', 'count', 'transfer'] as const).map((k) => op<StockChangeList>('stock.changes', { kind: k === '' ? undefined : k, limit: 1 }, { quiet: true })),
      );
      return { all: all?.total ?? 0, adjust: adjust?.total ?? 0, count: count?.total ?? 0, transfer: transfer?.total ?? 0 };
    },
    ['stock_changes'],
    [],
  );
  const list = useLive(() => op<StockChangeList>('stock.changes', { kind: filter === 'all' ? undefined : filter, limit: LIMIT, offset }, { quiet: true }), [...READS.stock], [filter, offset]);
  const data = list.data;
  const c = counts.data;
  const chips: ChipOption<Filter>[] = [
    { value: 'all', label: 'All', ...(c !== null ? { count: c.all } : {}) },
    { value: 'adjust', label: 'Adjustments', icon: SlidersHorizontal, ...(c !== null ? { count: c.adjust } : {}) },
    { value: 'count', label: 'Counts', icon: ClipboardCheck, ...(c !== null ? { count: c.count } : {}) },
    { value: 'transfer', label: 'Transfers', icon: ArrowLeftRight, ...(c !== null ? { count: c.transfer } : {}) },
  ];
  const currency = data?.currency ?? me.company.currency;

  const columns: Column<StockChange>[] = [
    {
      key: 'number',
      label: 'Change',
      width: 'minmax(150px, 1.2fr)',
      sort: (r) => r.number,
      render: (r) => {
        const Icon = KIND_ICON[r.kind] ?? SlidersHorizontal;
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-row)]">
              <Icon size={15} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="num block truncate font-bold">{r.number}</span>
              <span className="block truncate text-[12px] text-[var(--erp-muted)]">{CHANGE_KIND[r.kind] ?? r.kind}</span>
            </span>
          </span>
        );
      },
    },
    { key: 'date', label: 'Date', width: '96px', sort: (r) => r.date, render: (r) => <span className="text-[13px]">{tableDay(r.date)}</span> },
    { key: 'where', label: 'Warehouse', width: 'minmax(160px, 1.4fr)', hide: 'md', render: (r) => <span className="truncate text-[13px]">{where(r)}</span> },
    { key: 'reason', label: 'Why', hide: 'xl', render: (r) => <span className="truncate text-[13px] text-[var(--erp-ink-2)]">{r.kind === 'transfer' ? 'Moved' : (REASON_LABEL[r.reason] ?? r.reason)}</span> },
    { key: 'lines', label: 'Items', align: 'right', width: '64px', hide: 'lg', sort: (r) => r.lines_count, render: (r) => r.lines_count },
    { key: 'who', label: 'By', width: '136px', hide: 'lg', render: (r) => (r.actor === 'agent' ? <ActorPill actor="agent" /> : <span className="truncate text-[13px] text-[var(--erp-ink-2)]">{r.who}</span>) },
    { key: 'value', label: 'Value', align: 'right', width: '112px', sort: (r) => r.value, render: (r) => (r.kind === 'transfer' ? <span className="text-[var(--erp-muted)]">-</span> : <span className="font-semibold">{money(r.value, currency)}</span>) },
    {
      key: 'state',
      label: 'Status',
      width: '92px',
      hide: 'sm',
      render: (r) => (
        <StatusPill tone={r.state === 'void' ? 'neutral' : 'good'} size="sm">
          {r.state === 'void' ? 'Void' : 'Posted'}
        </StatusPill>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Stock changes"
        subtitle={c !== null ? plural(c.all, 'change') : undefined}
        actions={
          canChange ? (
            <>
              <PillButton variant="light" icon={ClipboardCheck} onClick={(e) => change.open(e.currentTarget, { mode: 'count' })}>
                Count stock
              </PillButton>
              <PillButton icon={Plus} dot onClick={(e) => change.open(e.currentTarget)}>
                New stock change
              </PillButton>
            </>
          ) : undefined
        }
      />
      <RecordProposals match={(p) => p.op === 'stock.change'} title="Stock changes your AI agent proposes" watch={['stock_changes']} className="mb-5" />
      <Chips ariaLabel="Kind of change" value={filter} onChange={setFilter} options={chips} className="erp-rise erp-d1 mb-5" />
      {list.error !== null && data === null ? (
        <LoadError message={list.error} onRetry={list.reload} />
      ) : (
        <Card className="!p-3 @min-[640px]:!p-4" delay={2}>
          <DataTable
            ariaLabel="Stock changes"
            rows={data?.changes ?? []}
            loading={data === null}
            columns={columns}
            rowKey={(r) => r.id}
            onOpen={(r) => navigate('stock-change', { id: r.id })}
            rowTone={(r) => (r.state === 'void' ? 'muted' : undefined)}
            mobile={(r) => {
              const Icon = KIND_ICON[r.kind] ?? SlidersHorizontal;
              return {
                lead: (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)]">
                    <Icon size={15} aria-hidden />
                  </span>
                ),
                title: `${r.number} · ${CHANGE_KIND[r.kind] ?? r.kind}`,
                sub: `${dayLabel(r.date)} · ${where(r)}${r.actor === 'agent' ? ' · your AI agent' : ''}`,
                right: r.kind === 'transfer' ? plural(r.lines_count, 'item') : money(r.value, currency),
                rightSub: r.state === 'void' ? 'Void' : r.kind === 'transfer' ? 'Moved' : plural(r.lines_count, 'item'),
              };
            }}
            empty={
              <Empty
                icon={ClipboardList}
                title={filter === 'all' ? 'No stock changes yet' : `No ${CHANGE_KIND[filter].toLowerCase()}s yet`}
                action={
                  canChange ? (
                    <PillButton icon={Plus} dot onClick={(e) => change.open(e.currentTarget, filter !== 'all' ? { mode: filter === 'adjust' ? 'in' : filter } : {})}>
                      New stock change
                    </PillButton>
                  ) : undefined
                }
              >
                Adjustments, counts and transfers each get a number and an entry in the books.
              </Empty>
            }
          />
          {data !== null && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
        </Card>
      )}
      {change.node}
    </div>
  );
}

function where(r: StockChange): string {
  const from = r.warehouse?.name ?? '';
  if (r.kind === 'transfer') return `${from} to ${r.to_warehouse?.name ?? ''}`;
  return from;
}
