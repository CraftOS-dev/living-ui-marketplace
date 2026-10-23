/**
 * Fixed assets: what the business keeps for years, what each cost, how
 * much of it is used up so far, and what it is still worth. Register an
 * asset, or post every asset's depreciation through a month.
 */
import { useState } from 'react';
import { CalendarClock, Plus, Truck } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AssetModal, DepreciateModal } from '../../components/books/AssetForms.tsx';
import { Chips } from '../../components/controls.tsx';
import { DataTable } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Card, Empty, Figure, LoadError, PageHeader, PageSkeleton, PillButton, StatusPill } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { addMonths, monthLabel, today } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { baseCurrency, can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Asset, AssetList } from '../../lib/types/books.ts';
import type { PageProps } from '../../routes.tsx';

type Filter = 'active' | 'disposed' | 'all';

function lifeText(months: number): string {
  if (months % 12 === 0) return `${months / 12} ${months === 12 ? 'year' : 'years'}`;
  return `${months} months`;
}

export function AssetsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const base = baseCurrency(me);
  const fQ = query.get('status');
  const filter: Filter = fQ === 'disposed' || fQ === 'all' ? fQ : 'active';
  const [adding, setAdding] = useState(query.get('new') !== null);
  const [depreciating, setDepreciating] = useState(false);
  const data = useLive(() => op<AssetList>('assets.list', {}, { quiet: true }), ['assets', 'journals'], []);
  const canEdit = can(me, 'accounting', 'edit');
  const canFull = can(me, 'accounting', 'full');

  if (data.error !== null && data.data === null) return <LoadError message={data.error} onRetry={data.reload} />;
  if (data.data === null) return <PageSkeleton />;

  const all = data.data.assets;
  const active = all.filter((a) => a.status === 'active');
  const rows = filter === 'all' ? all : all.filter((a) => a.status === filter);
  const cost = data.data.cost;
  const book = data.data.book_value;
  const used = cost - book;
  const monthly = active.filter((a) => a.book_value > a.salvage).reduce((s, a) => s + a.monthly, 0);

  const columns: Column<Asset>[] = [
    {
      key: 'name',
      label: 'Asset',
      width: 'minmax(180px, 2fr)',
      sort: (a) => a.name,
      render: (a) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-bold">{a.name}</span>
          <span className="num text-[12px] text-[var(--erp-muted)]">{a.number}</span>
        </span>
      ),
    },
    { key: 'start', label: 'In use from', width: '130px', hide: 'md', sort: (a) => a.start, render: (a) => <span className="text-[13px] text-[var(--erp-ink-2)]">{monthLabel(a.start.slice(0, 7))}</span> },
    { key: 'life', label: 'Lasts', width: '100px', hide: 'lg', render: (a) => <span className="text-[13px] text-[var(--erp-ink-2)]">{lifeText(a.life_months)}</span> },
    { key: 'cost', label: 'Cost', align: 'right', width: '130px', sort: (a) => a.cost, render: (a) => money(a.cost, base) },
    {
      key: 'used',
      label: 'Used up',
      width: 'minmax(140px, 1.2fr)',
      hide: 'md',
      render: (a) => {
        const share = a.cost - a.salvage > 0 ? a.depreciated / (a.cost - a.salvage) : 0;
        return (
          <span className="flex w-full flex-col gap-1">
            <span className="num text-[12px] font-semibold text-[var(--erp-ink-2)]">
              {money(a.depreciated, base)} · {Math.round(share * 100)}%
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--erp-line)]">
              <span className="block h-full rounded-full bg-[var(--erp-ink)]" style={{ width: `${Math.max(share > 0 ? 3 : 0, Math.min(1, share) * 100)}%` }} />
            </span>
          </span>
        );
      },
    },
    { key: 'book', label: 'Worth now', align: 'right', width: '130px', sort: (a) => a.book_value, render: (a) => <span className="font-bold">{a.status === 'disposed' ? '-' : money(a.book_value, base)}</span> },
    {
      key: 'status',
      label: '',
      width: '110px',
      align: 'right',
      render: (a) =>
        a.status === 'disposed' ? (
          <StatusPill tone="neutral" size="sm">
            Disposed
          </StatusPill>
        ) : a.last_month !== '' && a.last_month < addMonths(today().slice(0, 7), -1) ? (
          <StatusPill tone="warn" size="sm">
            Behind
          </StatusPill>
        ) : (
          <StatusPill tone="good" size="sm">
            In use
          </StatusPill>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Fixed assets"
        subtitle="What the business keeps for years, and what it is still worth"
        actions={
          <>
            {canFull && active.length > 0 && (
              <PillButton variant="light" icon={CalendarClock} onClick={() => setDepreciating(true)}>
                Post depreciation
              </PillButton>
            )}
            {canEdit && (
              <PillButton icon={Plus} dot onClick={() => setAdding(true)}>
                Register asset
              </PillButton>
            )}
          </>
        }
      />

      {all.length > 0 && (
        <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
          <Card tone="dark" className="@min-[900px]:col-span-8" delay={1}>
            <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">Worth now, in the books</p>
            <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(book, base)}</p>
            <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">
              {active.length} {active.length === 1 ? 'asset' : 'assets'} in use that cost {money(cost, base)}
            </p>
            <div className="mt-5 flex h-3 w-full gap-1 overflow-hidden" aria-hidden>
              <span className="erp-grow-x h-full rounded-full bg-[var(--erp-accent)]" style={{ width: `${cost > 0 ? (book / cost) * 100 : 0}%`, minWidth: book > 0 ? 8 : 0 }} />
              <span className="erp-grow-x h-full rounded-full bg-[var(--erp-dark-2)]" style={{ width: `${cost > 0 ? (used / cost) * 100 : 100}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[var(--erp-on-dark-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-[var(--erp-accent)]" /> Still worth {money(book, base)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-[var(--erp-on-dark-muted)]" /> Used up {money(used, base)} (depreciation)
              </span>
            </div>
          </Card>
          <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
            <Figure label="Depreciation each month" value={money(monthly, base)} sub="The cost of wear, spread month by month" />
            <div className={cn('mt-4 rounded-[18px] bg-[var(--erp-card)] p-3')}>
              <span className="block text-[12px] text-[var(--erp-muted)]">Posted through</span>
              <span className="block text-[15px] font-bold">{active.length > 0 && active.every((a) => a.last_month !== '') ? monthLabel(active.map((a) => a.last_month).sort()[0] ?? '') : 'Not posted yet'}</span>
            </div>
          </Card>
        </div>
      )}

      <Chips
        ariaLabel="Status"
        value={filter}
        onChange={(f) => replaceQuery('assets', { status: f === 'active' ? undefined : f })}
        options={[
          { value: 'active', label: 'In use', count: active.length },
          { value: 'disposed', label: 'Disposed', count: all.length - active.length },
          { value: 'all', label: 'All', count: all.length },
        ]}
      />

      <Card delay={2}>
        <DataTable
          ariaLabel="Fixed assets"
          rows={rows}
          columns={columns}
          rowKey={(a) => a.id}
          onOpen={(a) => navigate('asset', { id: a.id })}
          rowTone={(a) => (a.status === 'disposed' ? 'muted' : undefined)}
          mobile={(a) => ({ title: a.name, sub: `${a.number} · ${lifeText(a.life_months)} from ${monthLabel(a.start.slice(0, 7))}`, right: money(a.book_value, base), rightSub: `of ${money(a.cost, base)}` })}
          empty={
            <Empty icon={Truck} title={filter === 'disposed' ? 'Nothing disposed of' : 'No assets yet'} action={canEdit && filter !== 'disposed' ? <PillButton icon={Plus} dot onClick={() => setAdding(true)}>Register asset</PillButton> : undefined}>
              {filter === 'disposed' ? 'Assets you sell or scrap show here.' : 'Register what the business keeps for years, and its cost is spread over its life.'}
            </Empty>
          }
        />
      </Card>

      <AssetModal
        open={adding}
        onClose={() => {
          setAdding(false);
          if (query.get('new') !== null) replaceQuery('assets', {});
        }}
        onDone={(a) => navigate('asset', { id: a.id })}
      />
      <DepreciateModal open={depreciating} onClose={() => setDepreciating(false)} onDone={data.reload} />
    </div>
  );
}
