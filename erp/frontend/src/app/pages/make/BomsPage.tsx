/**
 * Bills of materials: what each made item is built from, with the cost of
 * one unit (components at average cost plus labor and overhead). Search,
 * show the ones in use or not, and add a new one in a full screen.
 */
import { useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { Chips, SearchBox, useDebounced } from '../../components/controls.tsx';
import { useNewBom } from '../../components/make/parts.tsx';
import { ItemThumb } from '../../components/stock/icons.tsx';
import { quietQuery } from '../../components/stock/url.ts';
import { DataTable } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Card, Empty, LoadError, PageHeader, PillButton, StatusPill, TextLink } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { plural, price, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { Bom, BomList } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

type Show = 'all' | 'active' | 'inactive';

export function BomsPage({ query }: PageProps): React.JSX.Element {
  const [text, setText] = useState(query.get('q') ?? '');
  const q = useDebounced(text.trim(), 250);
  const start = query.get('show');
  const [show, setShow] = useState<Show>(start === 'active' || start === 'inactive' ? start : 'all');
  const live = useLive(() => op<BomList>('boms.list', { q: q === '' ? undefined : q }, { quiet: true }), ['boms', 'bom_lines', 'builds', ...READS.stock], [q]);
  const data = live.data;
  const create = useNewBom((id) => navigate('bom', { id }));

  const rows = (data?.boms ?? []).filter((b) => show === 'all' || (show === 'active' ? b.active : !b.active));
  const setFilters = (s: Show, t: string): void => quietQuery('boms', { q: t, show: s === 'all' ? '' : s });

  const columns: Column<Bom>[] = [
    {
      key: 'item',
      label: 'Makes',
      width: 'minmax(220px, 2.2fr)',
      sort: (r) => (r.item?.name ?? r.name).toLowerCase(),
      render: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <ItemThumb photo={null} icon="layers" size={40} rounded="rounded-[12px]" />
          <span className="min-w-0">
            <span className="block truncate font-bold">{r.item?.name ?? r.name}</span>
            <span className="block truncate text-[12px] text-[var(--erp-muted)]">{r.name !== r.item?.name ? r.name : (r.item?.sku ?? '')}</span>
          </span>
        </span>
      ),
    },
    { key: 'lines', label: 'Components', align: 'right', width: '104px', sort: (r) => r.lines_count, render: (r) => r.lines_count },
    { key: 'batch', label: 'Batch', align: 'right', width: '96px', hide: 'lg', render: (r) => `${qty(r.output_qty)} ${r.item?.unit ?? ''}` },
    { key: 'comp', label: 'Components cost', align: 'right', width: '136px', hide: 'md', sort: (r) => r.component_unit_cost_e4, render: (r) => price(r.component_unit_cost, r.currency) },
    { key: 'extra', label: 'Labor and overhead', align: 'right', width: '150px', hide: 'xl', sort: (r) => r.extra_cost_e4, render: (r) => price(r.extra_cost, r.currency) },
    { key: 'unit', label: 'Unit cost', align: 'right', width: '120px', sort: (r) => r.unit_cost_e4, render: (r) => <span className="font-bold">{price(r.unit_cost, r.currency)}</span> },
    {
      key: 'state',
      label: 'Status',
      width: '112px',
      hide: 'sm',
      render: (r) => (
        <StatusPill tone={r.active ? 'good' : 'neutral'} size="sm">
          {r.active ? 'In use' : 'Not in use'}
        </StatusPill>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Bills of materials"
        subtitle={data !== null ? plural(data.counts.all, 'bill of materials', 'bills of materials') : undefined}
        actions={
          data?.can.add === true ? (
            <PillButton icon={Plus} dot onClick={(e) => create.open(e.currentTarget)}>
              New bill of materials
            </PillButton>
          ) : undefined
        }
      />
      <div className="erp-rise erp-d1 mb-5 flex flex-wrap items-center gap-3">
        <Chips
          ariaLabel="Show"
          value={show}
          onChange={(s) => {
            setShow(s);
            setFilters(s, q);
          }}
          options={[
            { value: 'all', label: 'All', ...(data !== null ? { count: data.counts.all } : {}) },
            { value: 'active', label: 'In use', ...(data !== null ? { count: data.counts.active } : {}) },
            { value: 'inactive', label: 'Not in use', ...(data !== null ? { count: data.counts.inactive } : {}) },
          ]}
        />
        <SearchBox
          value={text}
          onChange={(v) => {
            setText(v);
            setFilters(show, v.trim());
          }}
          placeholder="Search by item or name"
          ariaLabel="Search bills of materials"
          className="min-w-[14rem] flex-1"
        />
      </div>
      {live.error !== null && data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : (
        <Card className="!p-3 @min-[640px]:!p-4" delay={2}>
          <DataTable
            ariaLabel="Bills of materials"
            rows={rows}
            loading={data === null}
            columns={columns}
            rowKey={(r) => r.id}
            onOpen={(r) => navigate('bom', { id: r.id })}
            rowTone={(r) => (r.active ? undefined : 'muted')}
            mobile={(r) => ({
              lead: <ItemThumb photo={null} icon="layers" size={40} rounded="rounded-[12px]" tone="card" />,
              title: r.item?.name ?? r.name,
              sub: `${plural(r.lines_count, 'component')}${r.active ? '' : ' · not in use'}`,
              right: price(r.unit_cost, r.currency),
              rightSub: 'per unit',
            })}
            empty={
              <Empty
                icon={Layers}
                title={q !== '' || show !== 'all' ? 'Nothing matches' : 'No bills of materials yet'}
                action={
                  q !== '' || show !== 'all' ? (
                    <TextLink
                      onClick={() => {
                        setText('');
                        setShow('all');
                        setFilters('all', '');
                      }}
                    >
                      Clear the filters
                    </TextLink>
                  ) : data?.can.add === true ? (
                    <PillButton icon={Plus} dot onClick={(e) => create.open(e.currentTarget)}>
                      New bill of materials
                    </PillButton>
                  ) : undefined
                }
              >
                A bill of materials lists the stock items one made item is built from, plus labor and overhead per unit.
              </Empty>
            }
          />
        </Card>
      )}
      {create.node}
    </div>
  );
}
