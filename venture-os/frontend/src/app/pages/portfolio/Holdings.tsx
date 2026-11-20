/**
 * Holdings of a company: per fund, the figures (Invested, Value, MOIC,
 * Ownership, Pro rata), ownership over rounds as a small line, the
 * securities, the rounds with their summary cap tables, and pro rata for a
 * next round (one amount, the engine answers).
 */
import { useState } from 'react';
import { Layers } from 'lucide-react';
import { DataTable, Empty, FigureStrip, LoadError, MoneyInput, Panel, Skeleton, Tag, Tip } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { LineChart } from '../../components/charts.tsx';
import { op } from '../../lib/api.ts';
import { fmtDay, majorParam, money, multiple, num, pct } from '../../lib/format.ts';
import { useLive, useOp } from '../../lib/live.ts';
import type { CompanyHoldings, Holding, Round, Security } from './types.ts';

export const HOLDING_READS = ['holdings', 'securities', 'ownership', 'rounds'];

const KIND: Record<string, string> = { safe_cap: 'SAFE (cap)', safe_discount: 'SAFE (discount)', safe_mfn: 'SAFE (MFN)', note: 'Note', priced: 'Shares', common: 'Common' };

function secColumns(currency: string, rows: Security[]): Column<Security>[] {
  const cols: Column<Security>[] = [
    { key: 'kind', label: 'Security', width: 'minmax(140px,1.4fr)', fixed: true, phone: 'title', render: (s) => <span className="truncate">{s.class !== '' ? s.class : (KIND[s.kind] ?? s.kind)}</span> },
    { key: 'day', label: 'Day', width: '96px', mono: true, render: (s) => fmtDay(s.day) },
    { key: 'cost', label: 'Cost', width: '96px', align: 'right', mono: true, render: (s) => (s.cost_minor > 0 ? money(s.cost_minor, currency, { compact: true }) : '') },
  ];
  if (rows.some((s) => s.shares !== null)) cols.push({ key: 'shares', label: 'Shares', width: '96px', align: 'right', mono: true, render: (s) => (s.shares !== null ? num(s.shares) : '') });
  if (rows.some((s) => s.cap_minor !== null)) cols.push({ key: 'cap', label: 'Cap', width: '84px', align: 'right', mono: true, phone: 'hide', render: (s) => (s.cap_minor !== null ? money(s.cap_minor, currency, { compact: true }) : '') });
  if (rows.some((s) => s.status === 'converted')) cols.push({ key: 'status', label: 'Status', width: '96px', render: (s) => (s.status === 'converted' ? <Tag tone="faint">Converted</Tag> : <Tag tone="good">Held</Tag>) });
  return cols;
}

const ROUND_COLUMNS: Column<Round>[] = [
  { key: 'label', label: 'Round', width: 'minmax(120px,1fr)', fixed: true, phone: 'title', render: (r) => <span className="truncate font-medium">{r.label}</span> },
  { key: 'day', label: 'Day', width: '100px', mono: true, render: (r) => fmtDay(r.day) },
  { key: 'raise', label: 'Raise', width: '100px', align: 'right', mono: true, render: (r) => (r.raised_minor !== null ? money(r.raised_minor, r.currency, { compact: true }) : '') },
  { key: 'post', label: 'Post-money', width: '110px', align: 'right', mono: true, render: (r) => (r.post_money_minor !== null ? money(r.post_money_minor, r.currency, { compact: true }) : '') },
  { key: 'price', label: 'Price', width: '100px', align: 'right', mono: true, phone: 'hide', render: (r) => (r.price_e8 !== null ? num(r.price_e8 / 1e8, 4) : '') },
  {
    key: 'cap',
    label: <Tip text="Summary cap table after the round.">Cap table</Tip>,
    width: '160px',
    phone: 'hide',
    render: (r) =>
      r.cap_table.length > 0 ? (
        <span className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--vo-sunk)]" aria-label="Cap table">
          {r.cap_table.map((c, i) => (
            <span key={c.holder + i} title={c.holder + ' ' + pct(c.ppm, 1)} className="h-full" style={{ width: ((c.ppm ?? 0) / 10000).toFixed(2) + '%', background: i % 2 === 0 ? 'var(--vo-a)' : 'var(--vo-b)', opacity: 1 - (i % 4) * 0.18 }} />
          ))}
        </span>
      ) : null,
  },
];

/** Only the round columns that hold a value in some round. */
function roundColumns(rounds: Round[]): Column<Round>[] {
  const has: Record<string, boolean> = { label: true, day: true, raise: rounds.some((r) => r.raised_minor !== null), post: rounds.some((r) => r.post_money_minor !== null), price: rounds.some((r) => r.price_e8 !== null), cap: rounds.some((r) => r.cap_table.length > 0) };
  return ROUND_COLUMNS.filter((c) => has[c.key] === true);
}

function ProRata({ h }: { h: Holding }): React.JSX.Element | null {
  const [raise, setRaise] = useState<number | null>(null);
  const [post, setPost] = useState<number | null>(null);
  const key = JSON.stringify([raise, post]);
  const live = useLive<{ amount_minor?: number; ownership_if_skip_ppm?: number } | null>(
    (signal) => (raise === null ? Promise.resolve(null) : op('prorata.preview', { holding: h.id, raise: majorParam(raise, h.currency), post_money: post !== null ? majorParam(post, h.currency) : undefined }, { quiet: true, signal })),
    [],
    [h.id, key],
  );
  if (h.ownership_ppm === null) return null;
  const r = live.data;
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1 text-[12px] text-[var(--vo-muted)]">
        Next round
        <MoneyInput value={raise} onChange={setRaise} currency={h.currency} className="w-40" label="Next round new money" />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[var(--vo-muted)]">
        Post-money
        <MoneyInput value={post} onChange={setPost} currency={h.currency} className="w-40" label="Next round post-money" />
      </label>
      {r !== null && r !== undefined && (
        <div className="flex gap-8">
          {r.amount_minor !== undefined && (
            <div>
              <div className="text-[12px] text-[var(--vo-muted)]">Pro rata</div>
              <div className="vo-mono vo-num text-[15px]">{money(r.amount_minor, h.currency, { compact: true })}</div>
            </div>
          )}
          {r.ownership_if_skip_ppm !== undefined && (
            <div>
              <div className="text-[12px] text-[var(--vo-muted)]">If skipped</div>
              <div className="vo-mono vo-num text-[15px]">{pct(r.ownership_if_skip_ppm, 2)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HoldingBlock({ h, rounds, multi }: { h: Holding; rounds: Round[]; multi: boolean }): React.JSX.Element {
  const own = h.ownership ?? [];
  const figs = [
    { label: 'Invested', value: money(h.cost_minor, h.currency, { compact: true }) },
    { label: 'Value', value: money(h.value_minor, h.currency, { compact: true }), tip: h.value_basis === 'mark' ? 'Approved mark.' : h.value_basis === 'cost' ? 'Held at cost (no approved mark).' : 'Exited.' },
    { label: 'MOIC', value: h.moic_e8 !== null ? multiple(h.moic_e8) : null },
    { label: 'Ownership', value: h.ownership_ppm !== null ? pct(h.ownership_ppm, 2) : null, tip: h.ownership_ppm === null ? 'Set when the SAFE or note converts.' : 'Fully diluted.' },
  ];
  if (h.prorata !== undefined && h.prorata.right) figs.push({ label: 'Pro rata', value: h.prorata.amount_minor !== null ? money(h.prorata.amount_minor, h.currency, { compact: true }) : 'Yes', tip: h.prorata.round !== null ? 'Ownership times the ' + h.prorata.round.label + ' new money.' : 'The share of the next round the right covers.' });
  return (
    <div className="flex flex-col gap-6">
      {multi && h.fund !== null && <Tag>{h.fund.name}</Tag>}
      <FigureStrip items={figs} />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel flush label="Securities">
          <DataTable label="Securities" columns={secColumns(h.currency, h.securities ?? [])} rows={h.securities ?? []} rowKey={(s) => s.id} stickyTop={0} />
        </Panel>
        {own.length > 1 ? (
          <Panel label="Ownership">
            <LineChart labels={own.map((o) => fmtDay(o.day))} series={[{ key: 'own', label: 'Ownership', values: own.map((o) => o.ppm / 10000), tone: 'a' }]} height={150} format={(v) => num(v, 2) + '%'} yFormat={(v) => num(v, 1) + '%'} label="Ownership" />
          </Panel>
        ) : (
          <Panel label="Pro rata">
            <ProRata h={h} />
          </Panel>
        )}
      </div>
      {own.length > 1 && (
        <Panel label="Pro rata">
          <ProRata h={h} />
        </Panel>
      )}
      {rounds.length > 0 && (
        <Panel flush label="Rounds">
          <DataTable label="Rounds" columns={roundColumns(rounds)} rows={rounds} rowKey={(r) => r.id} stickyTop={0} />
        </Panel>
      )}
    </div>
  );
}

export function Holdings({ company }: { company: string }): React.JSX.Element {
  const live = useOp<CompanyHoldings>('holdings.company', { company }, HOLDING_READS, { name: 'holdings.company' });
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-64 w-full" />;
  const d = live.data;
  if (d.holdings.length === 0) return <Empty icon={Layers} title="No holding" />;
  return (
    <div className="flex flex-col gap-10">
      {d.holdings.map((h) => (
        <HoldingBlock key={h.id} h={h} rounds={d.rounds} multi={d.holdings.length > 1} />
      ))}
    </div>
  );
}
