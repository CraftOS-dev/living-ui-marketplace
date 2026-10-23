/**
 * Builds (production orders): planned, done and void, with what each makes,
 * where, and what it cost. "New build" (and ?new=1, with ?bom= or ?item=)
 * opens the planning screen.
 */
import { useEffect, useState } from 'react';
import { Factory, Plus } from 'lucide-react';
import { Chips } from '../../components/controls.tsx';
import type { ChipOption } from '../../components/controls.tsx';
import { useNewBuild } from '../../components/make/NewBuild.tsx';
import { buildStatus } from '../../components/make/parts.tsx';
import { tableDay } from '../../components/stock/parts.tsx';
import { dropFlag, quietQuery } from '../../components/stock/url.ts';
import { DataTable, Pager } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { ActorPill, Card, Empty, LoadError, PageHeader, PillButton, StatusPill } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { money, plural, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { Build, BuildList, BuildStatus } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

const LIMIT = 50;
type Filter = 'all' | BuildStatus;

export function BuildsPage({ query }: PageProps): React.JSX.Element {
  const start = query.get('status');
  const [filter, setFilter] = useState<Filter>(start === 'draft' || start === 'done' || start === 'void' ? start : 'all');
  const [offset, setOffset] = useState(0);
  const wantsNew = query.get('new') !== null;
  const presetBom = query.get('bom') ?? undefined;
  const presetItem = query.get('item') ?? undefined;
  const live = useLive(() => op<BuildList>('builds.list', { status: filter === 'all' ? undefined : filter, limit: LIMIT, offset }, { quiet: true }), ['builds', 'boms', ...READS.stock], [filter, offset]);
  const data = live.data;
  const canCreate = data?.can.create ?? false;
  const planner = useNewBuild({
    onCreated: (b) => navigate('build', { id: b.id }),
    onClosed: () => {
      dropFlag('builds', 'new');
    },
  });

  useEffect(() => {
    if (wantsNew && data !== null && canCreate) planner.open(null, { bom: presetBom, item: presetItem });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew, data === null]);

  useEffect(() => {
    setOffset(0);
    quietQuery('builds', { status: filter === 'all' ? '' : filter, new: wantsNew ? '1' : '', bom: wantsNew ? presetBom : undefined, item: wantsNew ? presetItem : undefined });
  }, [filter, wantsNew, presetBom, presetItem]);

  const c = data?.counts;
  const chips: ChipOption<Filter>[] = [
    { value: 'all', label: 'All', ...(c !== undefined ? { count: c.draft + c.done + c.void } : {}) },
    { value: 'draft', label: 'Planned', ...(c !== undefined ? { count: c.draft } : {}) },
    { value: 'done', label: 'Done', ...(c !== undefined ? { count: c.done } : {}) },
    { value: 'void', label: 'Void', ...(c !== undefined ? { count: c.void } : {}) },
  ];

  const columns: Column<Build>[] = [
    {
      key: 'number',
      label: 'Build',
      width: '140px',
      sort: (r) => r.number,
      render: (r) => (
        <span className="min-w-0">
          <span className="num block truncate font-bold">{r.number}</span>
          <span className="block truncate text-[12px] text-[var(--erp-muted)]">{tableDay(r.date)}</span>
        </span>
      ),
    },
    {
      key: 'item',
      label: 'Makes',
      width: 'minmax(200px, 2fr)',
      sort: (r) => (r.item?.name ?? '').toLowerCase(),
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-semibold">{r.item?.name ?? r.bom?.name ?? ''}</span>
          {r.actor === 'agent' && <ActorPill actor="agent" />}
        </span>
      ),
    },
    {
      key: 'qty',
      label: 'Quantity',
      align: 'right',
      width: '112px',
      sort: (r) => r.qty,
      render: (r) => (
        <span>
          <span className="font-bold">{qty(r.qty)}</span> <span className="text-[12px] text-[var(--erp-muted)]">{r.item?.unit ?? ''}</span>
        </span>
      ),
    },
    { key: 'wh', label: 'Warehouse', hide: 'lg', render: (r) => <span className="truncate text-[13px]">{r.warehouse?.name ?? ''}</span> },
    { key: 'value', label: 'Value', align: 'right', width: '120px', sort: (r) => r.cost, render: (r) => (r.status === 'draft' ? <span className="text-[var(--erp-muted)]">-</span> : money(r.cost, r.currency)) },
    {
      key: 'status',
      label: 'Status',
      width: '104px',
      hide: 'sm',
      render: (r) => {
        const st = buildStatus(r.status);
        return (
          <StatusPill tone={st.tone} size="sm">
            {st.label}
          </StatusPill>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Builds"
        subtitle={c !== undefined ? `${plural(c.draft, 'planned build')} · ${plural(c.done, 'done', 'done')}` : undefined}
        actions={
          canCreate ? (
            <PillButton icon={Plus} dot onClick={(e) => planner.open(e.currentTarget)}>
              New build
            </PillButton>
          ) : undefined
        }
      />
      <Chips ariaLabel="Status" value={filter} onChange={setFilter} options={chips} className="erp-rise erp-d1 mb-5" />
      {live.error !== null && data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : (
        <Card className="!p-3 @min-[640px]:!p-4" delay={2}>
          <DataTable
            ariaLabel="Builds"
            rows={data?.builds ?? []}
            loading={data === null}
            columns={columns}
            rowKey={(r) => r.id}
            onOpen={(r) => navigate('build', { id: r.id })}
            rowTone={(r) => (r.status === 'void' ? 'muted' : undefined)}
            mobile={(r) => ({
              lead: (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)]">
                  <Factory size={15} aria-hidden />
                </span>
              ),
              title: r.item?.name ?? r.bom?.name ?? r.number,
              sub: `${r.number} · ${dayLabel(r.date)} · ${buildStatus(r.status).label}`,
              right: `${qty(r.qty)} ${r.item?.unit ?? ''}`,
              rightSub: r.status === 'draft' ? r.warehouse?.name : money(r.cost, r.currency),
            })}
            empty={
              <Empty icon={Factory} title={filter === 'all' ? 'No builds yet' : `No ${buildStatus(filter).label.toLowerCase()} builds`} action={canCreate ? <PillButton icon={Plus} dot onClick={(e) => planner.open(e.currentTarget)}>New build</PillButton> : undefined}>
                A build turns components into a finished item: it uses them at average cost and adds the item with labor and overhead.
              </Empty>
            }
          />
          {data !== null && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
        </Card>
      )}
      {planner.node}
    </div>
  );
}
