/**
 * Reserves: per holding the follow-on needed to hold the target ownership,
 * the reserve allocated and what was deployed, as bars side by side; the
 * fund's capital still available. A row opens its plan: target, rounds,
 * allocation and next-round assumptions, each with a source.
 */
import { useState } from 'react';
import { Plus, PiggyBank, Trash2 } from 'lucide-react';
import { Avatar, Button, DataTable, Empty, Field, IconButton, Input, LoadError, MoneyInput, Panel, PctInput, Segmented, Sheet, SheetHeader, Skeleton, StatTile } from '../ui.tsx';
import { BarChart, Legend } from '../charts.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { majorParam, money, pct } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { FUND_READS, HiddenHoldings, major } from './common.tsx';
import type { FundView, ReserveRow, Reserves } from './types.ts';

interface Round {
  raise: number | null;
  post: number | null;
  source: string;
}

function PlanSheet({ fund, row, onClose }: { fund: FundView; row: ReserveRow; onClose: () => void }): React.JSX.Element {
  const cur = fund.currency;
  const [target, setTarget] = useState<number | null>(row.target_ppm ?? row.ownership_ppm);
  const [allocated, setAllocated] = useState<number | null>(row.allocated_minor);
  const [rounds, setRounds] = useState<Round[]>(row.assumptions.length > 0 ? row.assumptions.map((a) => ({ raise: a.raise_minor, post: a.post_money_minor, source: a.source })) : [{ raise: null, post: null, source: '' }]);
  const [busy, setBusy] = useState(false);
  const ok = rounds.every((r) => r.raise !== null && r.post !== null && r.source.trim() !== '');
  const save = async (): Promise<void> => {
    setBusy(true);
    const out = await act(
      [],
      () =>
        op('reserves.plan-save', {
          fund: fund.id,
          holding: row.holding,
          target: target === null ? undefined : String(target / 10000),
          rounds: String(rounds.length),
          allocated: majorParam(allocated ?? 0, cur),
          assumptions: JSON.stringify(rounds.map((r, i) => ({ round: i + 1, raise: majorParam(r.raise, cur), post_money: majorParam(r.post, cur), source: r.source.trim() }))),
        }),
      ['reserves'],
    );
    setBusy(false);
    if (out !== null) onClose();
  };
  const set = (i: number, p: Partial<Round>): void => setRounds(rounds.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Sheet open onClose={onClose} label={row.name} width={560}>
      <SheetHeader title={row.name} onClose={onClose} />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Target" tip="Ownership to hold through the next rounds.">
            <PctInput value={target} onChange={setTarget} label="Target" />
          </Field>
          <Field label="Allocated">
            <MoneyInput value={allocated} onChange={setAllocated} currency={cur} label="Allocated" />
          </Field>
        </div>
        {rounds.map((r, i) => (
          <div key={i} className="vo-panel flex min-w-0 flex-col gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="vo-label flex-1">{'Round ' + (i + 1)}</span>
              {rounds.length > 1 && <IconButton icon={Trash2} label="Remove round" size={28} tone="danger" onClick={() => setRounds(rounds.filter((_, j) => j !== i))} />}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Raise">
                <MoneyInput value={r.raise} onChange={(v) => set(i, { raise: v })} currency={cur} label="Raise" />
              </Field>
              <Field label="Post-money">
                <MoneyInput value={r.post} onChange={(v) => set(i, { post: v })} currency={cur} label="Post-money" />
              </Field>
            </div>
            <Field label="Source" tip="A file, a link, or whose judgment it is.">
              <Input value={r.source} onChange={(e) => set(i, { source: e.target.value })} aria-label="Source" placeholder="Board deck, Q3" />
            </Field>
          </div>
        ))}
        {rounds.length < 4 && (
          <Button size="sm" icon={Plus} className="self-start" onClick={() => setRounds([...rounds, { raise: null, post: null, source: '' }])}>
            Round
          </Button>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}

export function ReservesTab({ fund }: { fund: FundView }): React.JSX.Element {
  const me = useMe();
  const live = useOp<Reserves>('reserves.get', { fund: fund.id }, FUND_READS, { name: 'reserves.get' });
  const [open, setOpen] = useState<ReserveRow | null>(null);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const cur = fund.currency;
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-60" />;
  const d = live.data;
  const rows = d.holdings;
  const planned = rows.filter((r) => r.needed_minor !== null || r.allocated_minor > 0 || r.deployed_minor > 0);
  const edit = can(me, 'funds', 'edit');
  if (rows.length === 0) return <Empty icon={PiggyBank} title="No holdings yet" />;
  return (
    <>
      <Panel
        aside={
          <span className="flex items-center gap-2">
            <HiddenHoldings n={d.hidden} />
            <Segmented size="sm" label="View" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
          </span>
        }
      >
        <StatTile bare className="mb-4" label="Available" value={money(d.totals.available_minor, cur, { compact: true })} tip="Callable capital not held in reserve." />
        {view === 'chart' ? (
          planned.length === 0 ? (
            <Empty icon={PiggyBank} title="No reserve plans" action={edit && rows[0] !== undefined ? <Button icon={Plus} onClick={() => setOpen(rows[0] ?? null)}>Plan</Button> : undefined} />
          ) : (
            <>
              <BarChart
                label="Reserves by holding"
                labels={planned.map((r) => r.name)}
                height={200}
                series={[
                  { key: 'needed', label: 'Needed', values: planned.map((r) => (r.needed_minor === null ? null : major(r.needed_minor, cur))), tone: 'muted' },
                  { key: 'allocated', label: 'Allocated', values: planned.map((r) => major(r.allocated_minor, cur)), tone: 'a' },
                  { key: 'deployed', label: 'Deployed', values: planned.map((r) => major(r.deployed_minor, cur)), tone: 'b' },
                ]}
                format={(v) => money(Math.round(v * 100), cur, { compact: true })}
                yFormat={(v) => money(Math.round(v * 100), cur, { compact: true, bare: true })}
              />
              <Legend className="mt-2" items={[{ label: 'Needed', tone: 'muted' }, { label: 'Allocated', tone: 'a' }, { label: 'Deployed', tone: 'b' }]} />
            </>
          )
        ) : (
          <DataTable<ReserveRow>
            label="Reserves"
            rows={rows}
            rowKey={(r) => r.holding}
            onRowClick={edit ? (r) => setOpen(r) : undefined}
            stickyTop={0}
            columns={[
              { key: 'name', label: 'Holding', width: 'minmax(170px,2fr)', fixed: true, phone: 'title', render: (r) => (<span className="flex min-w-0 items-center gap-2"><Avatar name={r.name} size={22} square /><span className="vo-wrap min-w-0 truncate">{r.name}</span></span>) },
              { key: 'own', label: 'Own', align: 'right', mono: true, phone: 'hide', render: (r) => pct(r.ownership_ppm, 1) },
              { key: 'target', label: 'Target', align: 'right', mono: true, phone: 'hide', render: (r) => (r.target_ppm === null ? '' : pct(r.target_ppm, 1)) },
              { key: 'needed', label: 'Needed', align: 'right', mono: true, phone: 'end', render: (r) => (r.needed_minor === null ? '' : money(r.needed_minor, cur, { compact: true, bare: true })) },
              { key: 'allocated', label: 'Allocated', align: 'right', mono: true, phone: 'sub', render: (r) => money(r.allocated_minor, cur, { compact: true, bare: true }) },
              { key: 'deployed', label: 'Deployed', align: 'right', mono: true, phone: 'hide', render: (r) => money(r.deployed_minor, cur, { compact: true, bare: true }) },
              { key: 'short', label: 'Shortfall', align: 'right', mono: true, phone: 'hide', render: (r) => (r.shortfall_minor !== null && r.shortfall_minor > 0 ? <span className="text-[var(--vo-bad)]">{money(r.shortfall_minor, cur, { compact: true, bare: true })}</span> : '') },
            ]}
          />
        )}
      </Panel>
      {open !== null && <PlanSheet fund={fund} row={open} onClose={() => setOpen(null)} />}
    </>
  );
}
