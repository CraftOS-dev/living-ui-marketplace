/**
 * The cash drawer: this register's open session (its live X report, cash
 * paid in and out, drawer opens without a sale) with the actions to open,
 * pay in, pay out and close it; every register's state; and past sessions
 * with their Z reports, which print and can be sent to your AI agent for a
 * review.
 */
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Printer, Sparkles, Vault, Wallet } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { duration, when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { printHtml, zReportHtml } from '../lib/print.ts';
import { navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import type { Shift } from '../lib/types.ts';
import { DateRange, Kpi, presetRange } from '../components/common.tsx';
import type { Range } from '../components/common.tsx';
import { CashMoveDialog, CloseDrawerDialog, OpenDrawerDialog, ShiftSummary } from '../components/DrawerDialogs.tsx';
import { Badge, Button, Empty, Modal, PageHeader, Panel } from '../components/ui.tsx';

const MOVE: Record<string, string> = { pay_in: 'Paid in', pay_out: 'Paid out', no_sale: 'Opened without a sale' };

function Moves({ shift }: { shift: Shift }): React.JSX.Element {
  const { money } = useStore();
  const moves = shift.moves ?? [];
  if (moves.length === 0) return <p className="py-4 text-center text-[12px] text-[var(--ps-muted)]">No cash paid in or out</p>;
  return (
    <ul className="divide-y divide-[var(--ps-hair)]">
      {moves.map((m) => (
        <li key={m.id} className="flex items-baseline gap-3 py-1.5 text-[12px]">
          <span className="w-28 shrink-0 text-[var(--ps-muted)]">{when(m.created)}</span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{MOVE[m.kind] ?? m.kind}</span>
            {m.reason !== '' ? ': ' + m.reason : ''}
            <span className="text-[var(--ps-muted)]">
              {' · ' + m.staff}
              {m.approved_by !== '' ? ', approved by ' + m.approved_by : ''}
            </span>
          </span>
          {m.kind !== 'no_sale' && <span className={cn('num shrink-0 font-semibold', m.kind === 'pay_out' && 'text-[var(--ps-red-text)]')}>{money.fmt(m.kind === 'pay_out' ? -m.amount : m.amount)}</span>}
        </li>
      ))}
    </ul>
  );
}

function ShiftDialog({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { money, settings } = useStore();
  const d = useLive(() => (id === '' ? Promise.resolve(null) : api.shift(id)), ['shifts', 'cash_moves'], [id]);
  const [asking, setAsking] = useState(false);
  const sh = d.data?.shift ?? null;
  const review = async (): Promise<void> => {
    if (sh === null) return;
    setAsking(true);
    try {
      const r = await api.ask('shift_review', { shift: sh.id });
      toast.success(r.asked ? 'Your AI agent is reviewing the session' : r.message);
    } catch {
      // Shown by the transport.
    } finally {
      setAsking(false);
    }
  };
  return (
    <Modal
      open={id !== ''}
      onClose={onClose}
      title={sh !== null ? sh.register.name + ', session ' + sh.number : 'Drawer session'}
      description={sh !== null ? 'Opened ' + when(sh.opened_at) + ' by ' + sh.opened_by + (sh.status === 'closed' ? ', closed ' + when(sh.closed_at) + ' by ' + sh.closed_by : '') : undefined}
      xl
      footer={
        sh !== null ? (
          <>
            {sh.status === 'closed' && (
              <Button icon={Sparkles} loading={asking} onClick={() => void review()}>
                Ask your AI agent to review
              </Button>
            )}
            <Button icon={Printer} onClick={() => void printHtml(zReportHtml(sh, money, settings?.business_name ?? ''))}>
              Print
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : undefined
      }
    >
      {sh !== null && (
        <div className="flex flex-col gap-4">
          <ShiftSummary shift={sh} money={money} />
          <section>
            <h3 className="mb-1 text-[12px] font-bold text-[var(--ps-ink-2)]">Cash in and out</h3>
            <Moves shift={sh} />
          </section>
          {sh.note !== '' && <p className="rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 text-[12px]">{sh.note}</p>}
        </div>
      )}
    </Modal>
  );
}

export function DrawerPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { money, settings } = useStore();
  const { register } = useSession();
  const cur = useLive(() => api.currentShift(), ['shifts', 'payments', 'cash_moves', 'orders'], [], 400);
  const regs = useLive(() => api.registers(), ['registers', 'shifts'], []);
  const [range, setRange] = useState<Range>(presetRange('30d'));
  const past = useLive(() => api.shifts({ from: range.from, to: range.to, limit: 200 }), ['shifts'], [range.from, range.to]);
  const [dialog, setDialog] = useState<'open' | 'close' | null>(null);
  const [cash, setCash] = useState<'pay_in' | 'pay_out' | 'no_sale' | null>(null);
  const [shown, setShown] = useState(query.get('id') ?? '');
  const sh = cur.data?.shift ?? null;
  const r = sh?.report;
  const minutes = sh !== null ? Math.max(0, Math.round((Date.now() - new Date(sh.opened_at.replace(' ', 'T')).getTime()) / 60000)) : 0;

  return (
    <div>
      <PageHeader
        title="Cash drawer"
        subtitle={register !== null ? register.name : undefined}
        actions={
          sh !== null ? (
            <>
              <Button icon={Vault} onClick={() => setCash('no_sale')}>
                No sale
              </Button>
              <Button icon={ArrowDownToLine} onClick={() => setCash('pay_in')}>
                Pay in
              </Button>
              <Button icon={ArrowUpFromLine} onClick={() => setCash('pay_out')}>
                Pay out
              </Button>
              <Button icon={Printer} onClick={() => void printHtml(zReportHtml(sh, money, settings?.business_name ?? ''))}>
                X report
              </Button>
              <Button variant="primary" icon={Wallet} onClick={() => setDialog('close')}>
                Close the drawer
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={Wallet} onClick={() => setDialog('open')}>
              Open the drawer
            </Button>
          )
        }
      />

      {sh === null ? (
        <Panel className="mb-4">
          <Empty icon={Wallet} title="The drawer is closed" action={<Button variant="primary" onClick={() => setDialog('open')}>Open the drawer</Button>}>
            {cur.data?.last_closed !== null && cur.data?.last_closed !== undefined ? 'Last closed ' + when(cur.data.last_closed.closed_at) + ' with ' + money.fmt(cur.data.last_closed.counted) + ' in it.' : 'Count the float to start taking cash.'}
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Should be in the drawer" value={r !== undefined ? money.fmt(r.cash.expected) : ''} tone="dark" note={'Started with ' + money.fmt(sh.opening_float)} />
            <Kpi label="Net sales" value={r !== undefined ? money.fmt(r.summary.net_sales) : ''} note={r !== undefined ? r.summary.sales + ' sales' : undefined} />
            <Kpi label="Cash taken" value={r !== undefined ? money.fmt(r.cash.cash_sales - r.cash.cash_refunds) : ''} tone="sand" />
            <Kpi label="Open for" value={duration(minutes)} note={'Since ' + when(sh.opened_at) + ', ' + sh.opened_by} />
          </div>
          <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_360px]">
            <Panel title="This session so far">
              <ShiftSummary shift={sh} money={money} />
            </Panel>
            <Panel title="Cash in and out">
              <Moves shift={sh} />
            </Panel>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title="Past sessions" padded={false} actions={<DateRange value={range} onChange={setRange} />}>
          {(past.data?.shifts ?? []).length === 0 ? (
            <p className="py-8 text-center text-[12px] text-[var(--ps-muted)]">No sessions in these days</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Opened</th>
                    <th className="hidden md:table-cell">Closed</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Counted</th>
                    <th className="text-right">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {(past.data?.shifts ?? []).map((x) => (
                    <tr key={x.id} className="cursor-pointer" onClick={() => setShown(x.id)}>
                      <td className="font-semibold">
                        {x.register.name} &middot; {x.number}
                      </td>
                      <td className="text-[var(--ps-ink-2)]">
                        {when(x.opened_at)}
                        <span className="block text-[12px] text-[var(--ps-muted)]">{x.opened_by}</span>
                      </td>
                      <td className="hidden text-[var(--ps-ink-2)] md:table-cell">
                        {x.status === 'open' ? <Badge tone="good">Open</Badge> : when(x.closed_at)}
                        {x.status === 'closed' && <span className="block text-[12px] text-[var(--ps-muted)]">{x.closed_by}</span>}
                      </td>
                      <td className="num text-right">{x.status === 'closed' ? money.fmt(x.expected) : ''}</td>
                      <td className="num text-right">{x.status === 'closed' ? money.fmt(x.counted) : ''}</td>
                      <td className={cn('num text-right font-semibold', x.difference < 0 && 'text-[var(--ps-red-text)]', x.difference > 0 && 'text-[var(--ps-amber-text)]')}>{x.status === 'closed' ? (x.difference === 0 ? 'Even' : money.signed(x.difference)) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Registers" padded={false} actions={<Button size="sm" variant="ghost" onClick={() => navigate('settings', { tab: 'registers' })}>Manage</Button>}>
          <ul className="divide-y divide-[var(--ps-hair)]">
            {(regs.data?.registers ?? []).map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">
                    {g.name}
                    {register !== null && g.id === register.id ? <span className="font-normal text-[var(--ps-muted)]"> (this one)</span> : null}
                  </span>
                  <span className="block text-[12px] text-[var(--ps-muted)]">{g.shift !== null ? 'Open since ' + when(g.shift.opened_at) : g.active ? 'Closed' : 'Turned off'}</span>
                </span>
                {g.shift !== null ? <Badge tone="good">Open</Badge> : <Badge tone="neutral">Closed</Badge>}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <OpenDrawerDialog open={dialog === 'open'} onClose={() => setDialog(null)} />
      <CloseDrawerDialog open={dialog === 'close'} onClose={() => setDialog(null)} />
      <CashMoveDialog kind={cash} onClose={() => setCash(null)} />
      <ShiftDialog id={shown} onClose={() => setShown('')} />
    </div>
  );
}
