/**
 * Stock on hand: every item by warehouse with its value at average cost.
 * Pick one warehouse or see them side by side; the total is checked against
 * the inventory account in the books (a difference shows plainly). Search,
 * and export what is on screen as a CSV.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, PackageSearch } from 'lucide-react';
import { SplitBar } from '../../components/charts.tsx';
import { SearchBox, Segmented, useDebounced } from '../../components/controls.tsx';
import { useStockChange } from '../../components/stock/StockChangeScreen.tsx';
import { quietQuery } from '../../components/stock/url.ts';
import { DataTable, TotalsRow } from '../../components/table.tsx';
import type { Column } from '../../components/table.tsx';
import { Card, Empty, LoadError, Notice, PageHeader, PillButton, PillSelect, Skeleton, TextLink } from '../../components/ui.tsx';
import { op, saveText } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { minorToText, money, plural, qty } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { navigate } from '../../lib/router.ts';
import type { LevelList, StockReport, WarehouseList } from '../../lib/types/stock.ts';
import type { PageProps } from '../../routes.tsx';

/** Parts of a bar drawn on the dark card (the chart palette is made for light cards). */
const ON_DARK_FILLS = ['var(--erp-accent)', 'var(--erp-on-dark)', 'var(--erp-on-dark-muted)', 'var(--erp-seg-2)'];

interface Row {
  id: string;
  sku: string;
  name: string;
  unit: string;
  by: Record<string, number>;
  qty: number;
  value: number;
}

export function StockPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const [warehouse, setWarehouse] = useState(query.get('warehouse') ?? '');
  const [text, setText] = useState(query.get('q') ?? '');
  const q = useDebounced(text.trim(), 250);
  const change = useStockChange();

  const whs = useLive(() => op<WarehouseList>('warehouses.list', {}, { quiet: true }), ['warehouses', 'stock', 'valuation'], []);
  const levels = useLive(() => op<LevelList>('stock.levels', { warehouse: warehouse === '' ? undefined : warehouse, q: q === '' ? undefined : q, limit: 1000 }, { quiet: true }), READS.stock, [warehouse, q]);
  const seeReport = can(me, 'reports', 'view') && can(me, 'accounting', 'view');
  const report = useLive(async () => (seeReport ? op<StockReport>('reports.stock', {}, { quiet: true }).catch(() => null) : null), [...READS.stock, ...READS.books], [seeReport]);

  const setFilter = (w: string, t: string): void => quietQuery('stock', { warehouse: w, q: t });

  const list = (whs.data?.warehouses ?? []).filter((w) => !w.archived || w.items > 0);
  const currency = levels.data?.currency ?? whs.data?.currency ?? me.company.currency;
  const pivot = warehouse === '' && list.length > 1 && list.length <= 4;

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    for (const l of levels.data?.levels ?? []) {
      const r = map.get(l.item.id) ?? { id: l.item.id, sku: l.item.sku, name: l.item.name, unit: l.item.unit, by: {}, qty: 0, value: 0 };
      r.by[l.warehouse.id] = (r.by[l.warehouse.id] ?? 0) + l.qty;
      r.qty = Math.round((r.qty + l.qty) * 1000) / 1000;
      r.value += l.value;
      map.set(l.item.id, r);
    }
    return [...map.values()];
  }, [levels.data]);

  const totalValue = levels.data?.value ?? 0;
  const units = rows.reduce((s, r) => s + r.qty, 0);

  const exportCsv = (): void => {
    const lines = [['SKU', 'Item', 'Warehouse', 'On hand', 'Unit', `Value (${currency})`].join(',')];
    for (const l of levels.data?.levels ?? []) {
      lines.push([l.item.sku, l.item.name, l.warehouse.name, String(l.qty), l.item.unit, minorToText(l.value, currency)].map(csvCell).join(','));
    }
    const wh = list.find((w) => w.id === warehouse);
    saveText(lines.join('\n') + '\n', `stock-on-hand${wh !== undefined ? `-${wh.code}` : ''}-${today()}.csv`);
  };

  const columns: Column<Row>[] = [
    {
      key: 'item',
      label: 'Item',
      width: 'minmax(200px, 2.4fr)',
      sort: (r) => r.name.toLowerCase(),
      render: (r) => (
        <span className="min-w-0">
          <span className="block truncate font-bold">{r.name}</span>
          <span className="num block truncate text-[12px] text-[var(--erp-muted)]">{r.sku}</span>
        </span>
      ),
    },
    ...(pivot
      ? list.map<Column<Row>>((w) => ({
          key: `wh-${w.id}`,
          label: w.code !== '' ? w.code : w.name,
          align: 'right',
          width: '96px',
          hide: 'md',
          sort: (r) => r.by[w.id] ?? 0,
          render: (r) => (r.by[w.id] !== undefined ? qty(r.by[w.id] ?? 0) : <span className="text-[var(--erp-muted)]">-</span>),
        }))
      : []),
    {
      key: 'qty',
      label: pivot ? 'Total' : 'On hand',
      align: 'right',
      width: '120px',
      sort: (r) => r.qty,
      render: (r) => (
        <span>
          <span className="font-bold">{qty(r.qty)}</span> <span className="text-[12px] text-[var(--erp-muted)]">{r.unit}</span>
        </span>
      ),
    },
    { key: 'avg', label: 'Average cost', align: 'right', width: '120px', hide: 'lg', render: (r) => (r.qty > 0 ? money(Math.round(r.value / r.qty), currency) : '') },
    { key: 'value', label: 'Value', align: 'right', width: '128px', sort: (r) => r.value, render: (r) => <span className="font-semibold">{money(r.value, currency)}</span> },
  ];

  const pick = (w: string): void => {
    setWarehouse(w);
    setFilter(w, q);
  };
  const byWarehouse = list.map((w, i) => ({ key: w.id, label: w.name, value: w.value, valueText: money(w.value, currency, 'short'), fill: ON_DARK_FILLS[i % ON_DARK_FILLS.length] ?? 'var(--erp-accent)', onClick: () => pick(w.id) }));
  const rep = report.data;

  return (
    <div>
      <PageHeader
        title="Stock on hand"
        subtitle={levels.data !== null ? <span className="num">{plural(rows.length, 'item')} · {money(totalValue, currency)}</span> : undefined}
        actions={
          <>
            <PillButton variant="light" icon={Download} disabled={(levels.data?.levels.length ?? 0) === 0} onClick={exportCsv}>
              Export CSV
            </PillButton>
            {can(me, 'inventory', 'edit') && (
              <PillButton icon={ClipboardCheck} dot onClick={(e) => change.open(e.currentTarget, { mode: 'count', ...(warehouse !== '' ? { warehouse } : {}) })}>
                Count stock
              </PillButton>
            )}
          </>
        }
      />

      {/* When the levels cannot load, the error below says why; the summary does not wait for them. */}
      {!(levels.data === null && levels.error !== null) && (
      <div className="mb-5 grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card tone="dark" className="@min-[900px]:col-span-7" delay={1}>
          <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{warehouse === '' ? 'Stock value, all warehouses' : `Stock value in ${list.find((w) => w.id === warehouse)?.name ?? ''}`}</p>
          {levels.data === null ? (
            <Skeleton className="mt-2 h-8 w-48 bg-[var(--erp-dark-2)]" />
          ) : (
            <p className="num mt-1 text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(totalValue, currency)}</p>
          )}
          <p className="num mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">
            {plural(rows.length, 'item')} · {qty(Math.round(units))} units{q !== '' ? ' matching the search' : ''}
          </p>
          {warehouse === '' && list.length > 1 && (
            <div className="mt-5">
              <SplitBar parts={byWarehouse} dark legend={false} />
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {byWarehouse.map((p) => (
                  <button key={p.key} type="button" onClick={p.onClick} className="flex items-center gap-2 text-[12px] font-semibold text-[var(--erp-on-dark)] hover:underline">
                    <span aria-hidden className="h-2.5 w-5 rounded-full" style={{ background: p.fill }} />
                    {p.label} <span className="num text-[var(--erp-on-dark-muted)]">{p.valueText}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card tone="sand" className="@min-[900px]:col-span-5" delay={2}>
          <p className="text-[15px] font-bold">Books check</p>
          {!seeReport ? (
            <p className="mt-1 text-[13px] text-[var(--erp-ink-2)]">Stock is valued at moving average cost. Someone with access to the accounts can compare it with the books.</p>
          ) : rep === null ? (
            report.loading ? (
              <Skeleton className="mt-3 h-16" />
            ) : (
              <p className="mt-1 text-[13px] text-[var(--erp-ink-2)]">The comparison with the books is not available right now.</p>
            )
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <div className="rounded-[16px] bg-[var(--erp-card)] p-3">
                  <dt className="text-[12px] text-[var(--erp-muted)]">Stock valuation</dt>
                  <dd className="num text-[15px] font-bold">{money(rep.total, rep.currency)}</dd>
                </div>
                <div className="rounded-[16px] bg-[var(--erp-card)] p-3">
                  <dt className="text-[12px] text-[var(--erp-muted)]">Inventory account</dt>
                  <dd className="num text-[15px] font-bold">{money(rep.book, rep.currency)}</dd>
                </div>
              </dl>
              {rep.difference === 0 ? (
                <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--erp-green-text)]">
                  <CheckCircle2 size={16} aria-hidden /> Matches the books to the cent
                </p>
              ) : (
                <Notice tone="warn" icon={AlertTriangle} action={<TextLink onClick={() => navigate('report', { kind: 'stock' })}>Open report</TextLink>}>
                  The books differ by <span className="num font-bold">{money(rep.difference, rep.currency)}</span>. A manual entry on the inventory account usually explains it.
                </Notice>
              )}
            </div>
          )}
        </Card>
      </div>
      )}

      <div className="erp-rise erp-d2 mb-4 flex flex-wrap items-center gap-3">
        {list.length > 1 && list.length <= 4 ? (
          <Segmented
            ariaLabel="Warehouse"
            onShell
            value={warehouse}
            onChange={pick}
            options={[{ value: '', label: 'All' }, ...list.map((w) => ({ value: w.id, label: w.name }))]}
            className="w-full @min-[640px]:w-auto @min-[640px]:shrink-0 @min-[640px]:[&>button]:flex-none"
          />
        ) : list.length > 4 ? (
          <PillSelect ariaLabel="Warehouse" value={warehouse} onChange={pick} options={[{ value: '', label: 'All warehouses' }, ...list.map((w) => ({ value: w.id, label: w.name }))]} className="w-full @min-[480px]:w-56" />
        ) : null}
        <SearchBox
          value={text}
          onChange={(v) => {
            setText(v);
            setFilter(warehouse, v.trim());
          }}
          placeholder="Search items or SKUs"
          ariaLabel="Search stock"
          className="min-w-[14rem] flex-1"
        />
      </div>

      {levels.error !== null && levels.data === null ? (
        <LoadError message={levels.error} onRetry={levels.reload} />
      ) : (
        <Card className="!p-3 @min-[640px]:!p-4" delay={3}>
          <DataTable
            ariaLabel="Stock on hand"
            rows={rows}
            loading={levels.data === null}
            columns={columns}
            rowKey={(r) => r.id}
            onOpen={(r) => navigate('item', { id: r.id })}
            mobile={(r) => ({
              title: r.name,
              sub: pivot ? list.filter((w) => r.by[w.id] !== undefined).map((w) => `${w.code !== '' ? w.code : w.name} ${qty(r.by[w.id] ?? 0)}`).join(' · ') : r.sku,
              right: `${qty(r.qty)} ${r.unit}`,
              rightSub: money(r.value, currency),
            })}
            empty={
              <Empty icon={PackageSearch} title={q !== '' ? 'Nothing matches' : 'Nothing in stock here'}>
                {q !== '' ? 'Try another search.' : 'Stock arrives with goods receipts, builds and stock changes.'}
              </Empty>
            }
            footer={rows.length > 1 ? <TotalsRow cells={[{ label: 'Units', value: qty(Math.round(units * 1000) / 1000) }, { label: 'Value', value: money(totalValue, currency) }]} /> : undefined}
          />
          {(levels.data?.total ?? 0) > 1000 && <p className="px-3 pt-3 text-[12px] text-[var(--erp-muted)]">Showing the first 1,000 lines. Search or pick a warehouse to narrow it.</p>}
        </Card>
      )}
      {change.node}
    </div>
  );
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
